import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { AdminModule } from './admin/admin.module';
import { EventsModule } from './events/events.module';
import { ServiceRequestsModule } from './service-requests/service-requests.module';
import { AssistantManagerModule } from './assistant-manager/assistant-manager.module';
import { NotificationsModule } from './notifications/notifications.module';
import { BusinessModule } from './business/business.module';
import { UsersModule } from './users/users.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    AdminModule,
    AssistantManagerModule,
    EventsModule,
    ServiceRequestsModule,
    NotificationsModule,
    BusinessModule,
    UsersModule,
    HealthModule,
  ],
})
export class AppModule {}