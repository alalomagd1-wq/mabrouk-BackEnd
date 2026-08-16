import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ApprovedAccountGuard } from '../auth/guards/approved-account.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ServiceRequestsService } from './service-requests.service';
import { ReasonDto } from './dto/reason.dto';

interface AuthUser {
  userId: number;
  role: string;
}

@Controller('service-requests')
@UseGuards(JwtAuthGuard, RolesGuard, ApprovedAccountGuard)
export class ServiceRequestsController {
  constructor(private readonly service: ServiceRequestsService) {}

  // --------- مزوّد الخدمة ---------
  @Get('mine')
  @Roles('SERVICE_OWNER')
  listMine(
    @CurrentUser() user: AuthUser,
    @Query('scope') scope?: 'pending' | 'active' | 'completed' | 'all',
  ) {
    return this.service.listMine(user.userId, scope ?? 'pending');
  }

  @Post(':id/accept')
  @Roles('SERVICE_OWNER')
  accept(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.service.accept(id, user.userId);
  }

  @Post(':id/reject')
  @Roles('SERVICE_OWNER')
  reject(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser, @Body() dto: ReasonDto) {
    return this.service.reject(id, user.userId, dto);
  }

  @Post(':id/complete')
  @Roles('SERVICE_OWNER')
  complete(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.service.complete(id, user.userId);
  }

  // --------- مدير المناسبة ---------
  @Post(':id/approve')
  @Roles('EVENT_MANAGER')
  approve(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.service.approveCompletion(id, user.userId);
  }

  @Post(':id/request-correction')
  @Roles('EVENT_MANAGER')
  requestCorrection(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthUser,
    @Body() dto: ReasonDto,
  ) {
    return this.service.requestCorrection(id, user.userId, dto);
  }
}