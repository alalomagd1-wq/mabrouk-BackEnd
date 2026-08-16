import { Controller, Get, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { NotificationsService } from './notifications.service';

interface AuthUser {
  userId: number;
}

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get('mine')
  listMine(@CurrentUser() user: AuthUser) {
    return this.notificationsService.listMine(user.userId);
  }

  @Get('unread-count')
  unreadCount(@CurrentUser() user: AuthUser) {
    return this.notificationsService.unreadCount(user.userId);
  }

  @Post(':id/read')
  markAsRead(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.notificationsService.markAsRead(id, user.userId);
  }

  @Post('read-all')
  markAllAsRead(@CurrentUser() user: AuthUser) {
    return this.notificationsService.markAllAsRead(user.userId);
  }
}