import { Body, Controller, Get, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ApprovedAccountGuard } from '../auth/guards/approved-account.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AssistantManagerService } from './assistant-manager.service';
import { OpenAssistantCallDto } from './dto/open-assistant-call.dto';

interface AuthUser {
  userId: number;
}

@UseGuards(JwtAuthGuard, RolesGuard, ApprovedAccountGuard)
@Roles('EVENT_MANAGER')
@Controller()
export class AssistantManagerController {
  constructor(private readonly service: AssistantManagerService) {}

  // المدير الرئيسي يفتح نداءً عامًا
  @Post('events/:eventId/assistant-manager/open')
  openCall(
    @Param('eventId', ParseIntPipe) eventId: number,
    @CurrentUser() user: AuthUser,
    @Body() dto: OpenAssistantCallDto,
  ) {
    return this.service.openCall(eventId, user.userId, dto);
  }

  // أي مدير يتصفح المناسبات التي تحتاج مدراء مساعدين
  @Get('events/open-for-assistant-managers')
  listOpenCalls(@CurrentUser() user: AuthUser) {
    return this.service.listOpenCalls(user.userId);
  }

  // مدير يقرر الانضمام بنفسه
  @Post('events/:eventId/assistant-manager/join')
  join(@Param('eventId', ParseIntPipe) eventId: number, @CurrentUser() user: AuthUser) {
    return this.service.join(eventId, user.userId);
  }
}