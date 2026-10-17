import { Module } from '@nestjs/common';
import { TenancyModule } from '../tenancy/tenancy.module';
import { PlatformAccessService } from '../platform/platform-access.service';
import { PlatformGuard } from '../platform/platform.guard';
import { Announcements } from './announcements';
import {
  PlatformAnnouncementsController,
  PlatformAnnouncementInboxController,
  TenantAnnouncementsController,
} from './announcements.controller';

@Module({
  imports: [TenancyModule],
  controllers: [
    PlatformAnnouncementsController,
    PlatformAnnouncementInboxController,
    TenantAnnouncementsController,
  ],
  providers: [Announcements, PlatformAccessService, PlatformGuard],
})
export class AnnouncementsModule {}
