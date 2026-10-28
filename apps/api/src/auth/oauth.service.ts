import { createHash, randomBytes } from 'node:crypto';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
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
}

interface VkProfile {
  response: Array<{ id: number; first_name: string; last_name: string }>;
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
  async processCallback(provider: OAuthProvider, code: string, state: string, ip: string, ua: string): Promise<{ token: string; user: RequestUser } | { mfa: string; user: RequestUser }> {
    const stateData = await this.stateStore.get(state);
    if (!stateData || stateData.provider !== provider) {
      throw new BadRequestException({ error: { code: 'INVALID_OAUTH_STATE', message: 'Неверный или устаревший параметр state' } });
    }
    await this.stateStore.delete(state);

    const cfg = this.providerConfig(provider);

    const tokenRes = await fetch(cfg.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Blokum-CSRF': '1' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: cfg.clientId,
        code,
        redirect_uri: stateData.redirectUri,
        code_verifier: stateData.codeVerifier,
      }).toString(),
    });
    if (!tokenRes.ok) {
      throw new BadRequestException({ error: { code: 'OAUTH_TOKEN_FAILED', message: 'Не удалось получить токен от провайдера' } });
    }
    const tokenBody = await tokenRes.json() as { access_token?: string };
    const accessToken = tokenBody.access_token;
    if (!accessToken) {
      throw new BadRequestException({ error: { code: 'OAUTH_TOKEN_FAILED', message: 'Провайдер не вернул access_token' } });
    }

    const profileRes = await fetch(cfg.profileUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!profileRes.ok) {
      throw new BadRequestException({ error: { code: 'OAUTH_PROFILE_FAILED', message: 'Не удалось получить профиль пользователя' } });
    }
    const profileBody = await profileRes.json();
    const { providerUserId, displayName } = this.extractProfile(provider, profileBody);

    const user = await this.findOrCreateUser(provider, providerUserId, displayName);
    // AD-01: an administrator or a moderator needs the second factor; no session before it.
    if (user.status === 'ACTIVE' && this.mfa.required(user)) return { mfa: this.mfa.begin(user.id), user };
    const token = await this.sessions.create(user.id, { ip, ua });
    return { token, user };
  }

  /** A-01: §2.5 links a provider identity to an existing user (account binding). */
  async linkIdentity(userId: string, provider: OAuthProvider, providerUserId: string): Promise<void> {
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

  private providerConfig(provider: OAuthProvider): ProviderConfig {
    const base = this.config.oauthBaseUrl;
    if (provider === 'vk') {
      return {
        clientId: this.config.vkClientId,
        authorizationUrl: `${base}/dev/oauth/vk/authorize`,
        tokenUrl: `${base}/dev/oauth/vk/token`,
        profileUrl: `${base}/dev/oauth/vk/me`,
        scope: 'email',
      };
    }
    return {
      clientId: this.config.yandexClientId,
      authorizationUrl: `${base}/dev/oauth/yandex/authorize`,
      tokenUrl: `${base}/dev/oauth/yandex/token`,
      profileUrl: `${base}/dev/oauth/yandex/me`,
      scope: 'login:email login:info',
    };
  }

  private extractProfile(provider: OAuthProvider, body: unknown): { providerUserId: string; displayName: string } {
    if (provider === 'vk') {
      const p = body as VkProfile;
      const item = p.response?.[0];
      return { providerUserId: String(item?.id ?? ''), displayName: `${item?.first_name ?? ''} ${item?.last_name ?? ''}`.trim() };
    }
    const p = body as YandexProfile;
    return { providerUserId: p.id, displayName: p.display_name ?? p.login ?? p.id };
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

    const id = generateId();
    const role = listed ? 'ADMIN' : 'USER';
    await this.db.insert(schema.users).values({ id, displayName, role, status: 'ACTIVE' });
    await this.db.insert(schema.authIdentities).values({ id: generateId(), userId: id, provider: providerEnum, providerUserId });
    if (listed) await this.audit.log({ actorId: id, action: 'ROLE_ADMIN_BY_ACCOUNT', targetType: 'user', targetId: id });
    return { id, role, status: 'ACTIVE', displayName, phoneE164: null };
  }
}
