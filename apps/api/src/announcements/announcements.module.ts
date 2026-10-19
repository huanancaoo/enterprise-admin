import { Module } from '@nestjs/common';
import { PlatformAccessModule } from '../platform/platform-access.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { Announcements } from './announcements';
import {
  PlatformAnnouncementInboxController,
  PlatformAnnouncementsController,
  TenantAnnouncementsController,
} from './announcements.controller';

@Module({
  imports: [TenancyModule, PlatformAccessModule],
  controllers: [
    PlatformAnnouncementsController,
    PlatformAnnouncementInboxController,
    TenantAnnouncementsController,
  ],
  providers: [Announcements],
})
export class AnnouncementsModule {}
