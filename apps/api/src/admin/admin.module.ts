import { type DynamicModule, Global, Module } from '@nestjs/common';
import { type Alerts } from '@blokum/observability';
import { AuditLogService } from '../auth/audit-log.service.js';
import { type EmailSender } from '../auth/email-sender.js';
import { type ApiConfig } from '../config.js';
import { type HealthProbes } from '../health/health.controller.js';
import { ALERTS, API_CONFIG, EMAIL_SENDER, HEALTH_PROBES, LINK_REPUTATION } from '../tokens.js';
import { type LinkReputation } from './safe-browsing.js';
import { BlockedIdentitiesService } from './blocked-identities.service.js';
import { SafetyAdminController } from './safety-admin.controller.js';
import { SafetyService } from './safety.service.js';
import { AdminController } from './admin.controller.js';
import { AdminUsersService } from './admin-users.service.js';
import { CreatorModerationController } from './creator-moderation.controller.js';
import { FeatureFlagsService } from './feature-flags.service.js';
import { LegalLogsService } from './legal-logs.service.js';
import { LibraryAdminService } from './library-admin.service.js';
import { ModerationService } from './moderation.service.js';
import { NotificationsService } from './notifications.service.js';
import { RetentionService } from './retention.service.js';
import { SystemContentService } from './system-content.service.js';
import { SystemService } from './system.service.js';

/**
 * The admin and the moderation (P9.3). Global: the switches (AD-07) are read by the registration, the uploads, the publishing and
 * the player, and a complaint (reports) starts the automatic measures.
 */
@Global()
@Module({})
export class AdminModule {
  static register(deps: { alerts: Alerts; emailSender: EmailSender | null; config: ApiConfig; probes: HealthProbes; linkReputation?: LinkReputation | null }): DynamicModule {
    return {
      module: AdminModule,
      controllers: [AdminController, CreatorModerationController, SafetyAdminController],
      providers: [
        { provide: ALERTS, useValue: deps.alerts },
        { provide: EMAIL_SENDER, useValue: deps.emailSender },
        { provide: API_CONFIG, useValue: deps.config },
        { provide: HEALTH_PROBES, useValue: deps.probes },
        { provide: LINK_REPUTATION, useValue: deps.linkReputation ?? null },
        SafetyService,
        BlockedIdentitiesService,
        AuditLogService,
        NotificationsService,
        FeatureFlagsService,
        ModerationService,
        AdminUsersService,
        LegalLogsService,
        RetentionService,
        SystemService,
        SystemContentService,
        LibraryAdminService,
      ],
      exports: [FeatureFlagsService, ModerationService, NotificationsService, AuditLogService, SafetyService, BlockedIdentitiesService],
    };
  }
}
