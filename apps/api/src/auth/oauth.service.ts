import { createHash, randomBytes } from 'node:crypto';
import { BadRequestException, Inject, Injectable, Optional } from '@nestjs/common';
import { BlockedIdentitiesService } from '../admin/blocked-identities.service.js';
import { FeatureFlagsService } from '../admin/feature-flags.service.js';
import { and, eq } from 'drizzle-orm';
import { type Db, schema } from '@blokum/db';
import type { ApiConfig } from '../config.js';
import { API_CONFIG, DB, OAUTH_STATE_STORE } from '../tokens.js';
import type { OAuthStateStore } from './oauth-state.js';
import type { RequestUser } from './session.service.js';
import { SessionService } from './session.service.js';
import { AdminMfaService } from './admin-mfa.service.js';
import { AuditLogService } from './audit-log.service.js';

/** A-01: supported OAuth providers. */
export type OAuthProvider = 'vk' | 'yandex';

interface ProviderConfig {
  clientId: string;
  authorizationUrl: string;
  tokenUrl: string;
  profileUrl: string;
  scope: string;
  /** What the provider's API expects before the token: Yandex ID wants «OAuth», the dev emulator «Bearer». */
  authScheme: 'OAuth' | 'Bearer';
}

interface VkProfile {
  response: Array<{ id: number; first_name: string; last_name: string }>;
}

interface VkIdProfile {
  user?: { user_id: string | number; first_name?: string; last_name?: string };
}

interface YandexProfile {
  id: string;
  display_name: string;
  login: string;
}

function generateCodeVerifier(): string {
  return randomBytes(32).toString('base64url');
}

function computeCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

function generateId(): string {
  return createHash('sha256').update(Math.random().toString() + Date.now()).digest('hex').slice(0, 24);
}

function generateState(): string {
  return randomBytes(24).toString('hex');
}

@Injectable()
export class OAuthService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    @Inject(OAUTH_STATE_STORE) private readonly stateStore: OAuthStateStore,
    private readonly sessions: SessionService,
    private readonly mfa: AdminMfaService,
    private readonly audit: AuditLogService,
    @Optional() private readonly flags?: FeatureFlagsService,
    @Optional() private readonly blocked?: BlockedIdentitiesService,
  ) {}

  /** A-01: builds the authorization URL and stores state+PKCE for the callback. */
  async initFlow(provider: OAuthProvider): Promise<string> {
    const cfg = this.providerConfig(provider);
    const state = generateState();
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = computeCodeChallenge(codeVerifier);
    const redirectUri = this.callbackUri(provider);

    await this.stateStore.save(state, { provider, codeVerifier, redirectUri });

    const params = new URLSearchParams({
      client_id: cfg.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: cfg.scope,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });
    return `${cfg.authorizationUrl}?${params.toString()}`;
  }

  /** A-01: exchanges code for token, fetches profile, finds or creates user, returns session token. */
  async processCallback(provider: OAuthProvider, code: string, state: string, ip: string, ua: string, deviceId?: string): Promise<{ token: string; user: RequestUser } | { mfa: string; user: RequestUser }> {
    const stateData = await this.stateStore.get(state);
    if (!stateData || stateData.provider !== provider) {
      throw new BadRequestException({ error: { code: 'INVALID_OAUTH_STATE', message: 'Неверный или устаревший параметр state' } });
    }
    await this.stateStore.delete(state);

    const cfg = this.providerConfig(provider);
    const live = this.config.oauthLive;

    // The provider's answer is read defensively: a network error or a slow provider is «the login failed», never a 500.
    const call = async (url: string, init: RequestInit): Promise<Response> => {
      try {
        return await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
      } catch {
        throw new BadRequestException({ error: { code: 'OAUTH_TOKEN_FAILED', message: 'Провайдер не ответил' } });
      }
    };
    const form = (values: Record<string, string>): string => new URLSearchParams(values).toString();

    const tokenParams: Record<string, string> = {
      grant_type: 'authorization_code',
      client_id: cfg.clientId,
      code,
      redirect_uri: stateData.redirectUri,
      code_verifier: stateData.codeVerifier,
    };
    // VK ID wants the device and the state back; Yandex ID needs neither (PKCE replaces the secret key).
    if (live && provider === 'vk') {
      if (!deviceId) throw new BadRequestException({ error: { code: 'OAUTH_TOKEN_FAILED', message: 'VK ID не вернул device_id' } });
      tokenParams.device_id = deviceId;
      tokenParams.state = state;
    }
    const tokenRes = await call(cfg.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...(live ? {} : { 'X-Blokum-CSRF': '1' }) },
      body: form(tokenParams),
    });
    if (!tokenRes.ok) {
      throw new BadRequestException({ error: { code: 'OAUTH_TOKEN_FAILED', message: 'Не удалось получить токен от провайдера' } });
    }
    const tokenBody = await tokenRes.json() as { access_token?: string };
    const accessToken = tokenBody.access_token;
    if (!accessToken) {
      throw new BadRequestException({ error: { code: 'OAUTH_TOKEN_FAILED', message: 'Провайдер не вернул access_token' } });
    }

    const profileRes = live && provider === 'vk'
      ? await call(cfg.profileUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form({ client_id: cfg.clientId, access_token: accessToken }) })
      : await call(cfg.profileUrl, { headers: { Authorization: `${cfg.authScheme} ${accessToken}` } });
    if (!profileRes.ok) {
      throw new BadRequestException({ error: { code: 'OAUTH_PROFILE_FAILED', message: 'Не удалось получить профиль пользователя' } });
    }
    const profileBody = await profileRes.json();
    const { providerUserId, displayName } = this.extractProfile(provider, profileBody);
    if (!providerUserId) {
      throw new BadRequestException({ error: { code: 'OAUTH_PROFILE_FAILED', message: 'Провайдер не вернул идентификатор пользователя' } });
    }

    // TS-31, TS-32: a VK / Яндекс account of a blocked person neither logs in nor registers a new account.
    await this.blocked?.assertFree(provider === 'vk' ? 'VK' : 'YANDEX', providerUserId, 'LOGIN', ip);
    const user = await this.findOrCreateUser(provider, providerUserId, displayName);
    // AD-01: an administrator or a moderator needs the second factor; no session before it.
    if (user.status === 'ACTIVE' && this.mfa.required(user)) return { mfa: this.mfa.begin(user.id), user };
    const token = await this.sessions.create(user.id, { ip, ua });
    return { token, user };
  }

  /** A-01: §2.5 links a provider identity to an existing user (account binding). */
  async linkIdentity(userId: string, provider: OAuthProvider, providerUserId: string): Promise<void> {
    // TS-32: binding the identifier of a blocked account to another account is the same return, by a side door.
    await this.blocked?.assertFree(provider === 'vk' ? 'VK' : 'YANDEX', providerUserId, 'LINK');
    const existing = await this.db
      .select()
      .from(schema.authIdentities)
      .where(eq(schema.authIdentities.userId, userId))
      .limit(1);
    if (existing[0]) return; // already linked
    await this.db.insert(schema.authIdentities).values({
      id: generateId(),
      userId,
      provider: provider.toUpperCase() as 'VK' | 'YANDEX',
      providerUserId,
    });
  }

  /** A-01: §2.5 unlinks a provider identity; requires at least one other identity to remain. */
  async unlinkIdentity(userId: string, provider: OAuthProvider): Promise<void> {
    const all = await this.db.select().from(schema.authIdentities).where(eq(schema.authIdentities.userId, userId));
    if (all.length <= 1) {
      throw new BadRequestException({ error: { code: 'CANNOT_UNLINK_LAST_IDENTITY', message: 'Нельзя отвязать последний способ входа' } });
    }
    const providerEnum = provider.toUpperCase() as 'VK' | 'YANDEX';
    await this.db
      .delete(schema.authIdentities)
      .where(and(eq(schema.authIdentities.userId, userId), eq(schema.authIdentities.provider, providerEnum)));
  }

  private callbackUri(provider: OAuthProvider): string {
    return `${this.config.oauthBaseUrl}/auth/oauth/${provider}/callback`;
  }

  /** Whether the login through this provider can be offered: in production only with the owner's keys. */
  isEnabled(provider: OAuthProvider): boolean {
    if (!this.config.oauthLive) return true;
    return (provider === 'vk' ? this.config.vkClientId : this.config.yandexClientId) !== '';
  }

  private providerConfig(provider: OAuthProvider): ProviderConfig {
    if (!this.isEnabled(provider)) {
      throw new BadRequestException({ error: { code: 'OAUTH_PROVIDER_DISABLED', message: 'Вход через этот сервис пока не подключён' } });
    }
    if (this.config.oauthLive) {
      // Real services (the addresses are from the providers' own documentation).
      if (provider === 'vk') {
        return {
          clientId: this.config.vkClientId,
          authorizationUrl: 'https://id.vk.ru/authorize',
          tokenUrl: 'https://id.vk.ru/oauth2/auth',
          profileUrl: 'https://id.vk.ru/oauth2/user_info',
          scope: 'vkid.personal_info',
          authScheme: 'Bearer',
        };
      }
      return {
        clientId: this.config.yandexClientId,
        authorizationUrl: 'https://oauth.yandex.ru/authorize',
        tokenUrl: 'https://oauth.yandex.ru/token',
        profileUrl: 'https://login.yandex.ru/info?format=json',
        scope: 'login:info',
        authScheme: 'OAuth',
      };
    }
    const base = this.config.oauthBaseUrl;
    if (provider === 'vk') {
      return {
        clientId: this.config.vkClientId,
        authorizationUrl: `${base}/dev/oauth/vk/authorize`,
        tokenUrl: `${base}/dev/oauth/vk/token`,
        profileUrl: `${base}/dev/oauth/vk/me`,
        scope: 'email',
        authScheme: 'Bearer',
      };
    }
    return {
      clientId: this.config.yandexClientId,
      authorizationUrl: `${base}/dev/oauth/yandex/authorize`,
      tokenUrl: `${base}/dev/oauth/yandex/token`,
      profileUrl: `${base}/dev/oauth/yandex/me`,
      scope: 'login:email login:info',
      authScheme: 'Bearer',
    };
  }

  private extractProfile(provider: OAuthProvider, body: unknown): { providerUserId: string; displayName: string } {
    if (provider === 'vk') {
      // The emulator answers `{ response: [..] }`, VK ID itself `{ user: { user_id, first_name, last_name } }`.
      const real = (body as VkIdProfile).user;
      const item = real ?? (body as VkProfile).response?.[0];
      const id = real ? real.user_id : (item as { id?: number } | undefined)?.id;
      const name = `${item?.first_name ?? ''} ${item?.last_name ?? ''}`.trim();
      return { providerUserId: id === undefined || id === null ? '' : String(id), displayName: name || 'Пользователь' };
    }
    const p = body as YandexProfile;
    return { providerUserId: p.id ? String(p.id) : '', displayName: p.display_name ?? p.login ?? 'Пользователь' };
  }

  private async findOrCreateUser(provider: OAuthProvider, providerUserId: string, displayName: string): Promise<RequestUser> {
    const providerEnum = provider.toUpperCase() as 'VK' | 'YANDEX';
    const existing = await this.db
      .select({ users: schema.users })
      .from(schema.authIdentities)
      .innerJoin(schema.users, eq(schema.authIdentities.userId, schema.users.id))
      .where(and(eq(schema.authIdentities.providerUserId, providerUserId), eq(schema.authIdentities.provider, providerEnum)))
      .limit(1);

    // AD-01: the first administrator is named by the account at the provider (ADMIN_ACCOUNTS), not by the person.
    const listed = (this.config.adminAccounts ?? []).includes(`${provider}:${providerUserId}`.toLowerCase());

    if (existing[0]) {
      const u = existing[0].users;
      if (listed && u.role === 'USER') {
        await this.db.update(schema.users).set({ role: 'ADMIN' }).where(eq(schema.users.id, u.id));
        await this.audit.log({ actorId: u.id, action: 'ROLE_ADMIN_BY_ACCOUNT', targetType: 'user', targetId: u.id });
        return { id: u.id, role: 'ADMIN', status: u.status, displayName: u.displayName, phoneE164: u.phoneE164 };
      }
      return { id: u.id, role: u.role, status: u.status, displayName: u.displayName, phoneE164: u.phoneE164 };
    }

    // AD-07: the first administrators (ADMIN_ACCOUNTS) can always get in; for others the door is shut while registration is off.
    if (!listed) await this.flags?.require('REGISTRATION_ENABLED', 'Регистрация новых пользователей временно закрыта. Попробуйте позже.');
    const id = generateId();
    const role = listed ? 'ADMIN' : 'USER';
    await this.db.insert(schema.users).values({ id, displayName, role, status: 'ACTIVE' });
    await this.db.insert(schema.authIdentities).values({ id: generateId(), userId: id, provider: providerEnum, providerUserId });
    if (listed) await this.audit.log({ actorId: id, action: 'ROLE_ADMIN_BY_ACCOUNT', targetType: 'user', targetId: id });
    return { id, role, status: 'ACTIVE', displayName, phoneE164: null };
  }
}
