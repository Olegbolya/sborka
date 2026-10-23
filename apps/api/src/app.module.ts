import { type DynamicModule, Module, type Provider } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, Reflector } from '@nestjs/core';
import { type Alerts, type Logger } from '@blokum/observability';
import { type Db } from '@blokum/db';
import { type ApiConfig } from './config.js';
import { HealthController, type HealthProbes } from './health/health.controller.js';
import { AllExceptionsFilter } from './observability/exception.filter.js';
import { ALERTS, API_CONFIG, CAPTCHA_VERIFIER, EMAIL_SENDER, HEALTH_PROBES, LOGGER, OAUTH_STATE_STORE, OTP_SENDER } from './tokens.js';
import { DatabaseModule } from './database.module.js';
import { AuthModule } from './auth/auth.module.js';
import { AuthGuard } from './auth/auth.guard.js';
import { CsrfGuard } from './auth/csrf.guard.js';
import { RolesGuard } from './auth/roles.guard.js';
import { SessionService } from './auth/session.service.js';
import { OtpService } from './auth/otp.service.js';
import { OtpController } from './auth/otp.controller.js';
import { OAuthService } from './auth/oauth.service.js';
import { OAuthController } from './auth/oauth.controller.js';
import { DevOAuthController } from './auth/dev-oauth.controller.js';
import { InMemoryOAuthStateStore } from './auth/oauth-state.js';
import { LegalDocumentService } from './auth/legal-document.service.js';
import { ConsentService } from './auth/consent.service.js';
import { ConsentController, LegalController } from './auth/consent.controller.js';
import { AccountService } from './auth/account.service.js';
import { AccountController } from './auth/account.controller.js';
import { TotpService } from './auth/totp.service.js';
import { AuditLogService } from './auth/audit-log.service.js';
import type { CaptchaVerifier } from './auth/captcha.js';
import type { OtpSender } from './auth/otp-sender.js';
import type { EmailSender } from './auth/email-sender.js';
import { DevEmailSender } from './auth/email-sender.js';

export interface AppDeps {
  logger: Logger;
  alerts: Alerts;
  probes: HealthProbes;
  db: Db;
  /** Needed only when phone login is on (`config.phoneLogin`). */
  otpSender?: OtpSender;
  captchaVerifier?: CaptchaVerifier;
  /** null — no mail service connected (A-03 answers «почта не подключена»). */
  emailSender?: EmailSender | null;
  /** Extra controllers (used by tests to exercise error handling). */
  extraControllers?: DynamicModule['controllers'];
  extraProviders?: Provider[];
}

@Module({})
export class AppModule {
  static register(config: ApiConfig, deps: AppDeps): DynamicModule {
    const production = process.env.NODE_ENV === 'production';
    return {
      module: AppModule,
      imports: [DatabaseModule.forRoot(deps.db), AuthModule],
      controllers: [
        HealthController,
        ...(config.phoneLogin ? [OtpController] : []),
        OAuthController,
        ConsentController,
        LegalController,
        AccountController,
        ...(production ? [] : [DevOAuthController]),
        ...(deps.extraControllers ?? []),
      ],
      providers: [
        ...(config.phoneLogin ? [OtpService] : []),
        OAuthService,
        LegalDocumentService,
        ConsentService,
        AccountService,
        TotpService,
        AuditLogService,
        { provide: API_CONFIG, useValue: config },
        { provide: LOGGER, useValue: deps.logger },
        { provide: ALERTS, useValue: deps.alerts },
        { provide: HEALTH_PROBES, useValue: deps.probes },
        ...(config.phoneLogin ? [{ provide: OTP_SENDER, useValue: deps.otpSender }, { provide: CAPTCHA_VERIFIER, useValue: deps.captchaVerifier }] : []),
        // A-03: in production a real mail service is required; until the owner picks one (00-OWNER-DECISIONS §8) there is
        // none, and confirming an address answers «почта не подключена» instead of crashing the API at start.
        { provide: EMAIL_SENDER, useValue: deps.emailSender !== undefined ? deps.emailSender : production ? null : new DevEmailSender() },
        { provide: OAUTH_STATE_STORE, useValue: new InMemoryOAuthStateStore() },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
        // Global guards: CSRF → Auth → Roles (order matters).
        { provide: APP_GUARD, useFactory: (cfg: ApiConfig) => new CsrfGuard(cfg), inject: [API_CONFIG] },
        { provide: APP_GUARD, useFactory: (svc: SessionService, ref: Reflector) => new AuthGuard(svc, ref), inject: [SessionService, Reflector] },
        { provide: APP_GUARD, useFactory: (ref: Reflector) => new RolesGuard(ref), inject: [Reflector] },
        ...(deps.extraProviders ?? []),
      ],
    };
  }
}
