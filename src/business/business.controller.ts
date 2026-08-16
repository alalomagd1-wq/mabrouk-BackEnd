import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ApprovedAccountGuard } from '../auth/guards/approved-account.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { BusinessService } from './business.service';
import { CreateBusinessDto } from './dto/create-business.dto';
import { CreateBusinessServiceDto } from './dto/create-business-service.dto';
import { UpdateBusinessServiceDto } from './dto/update-business-service.dto';
import { UpdateActiveStatusDto } from '../admin/dto/update-active-status.dto';

interface AuthUser {
  userId: number;
}

@Controller('business')
@UseGuards(JwtAuthGuard, RolesGuard, ApprovedAccountGuard)
@Roles('SERVICE_OWNER')
export class BusinessController {
  constructor(private readonly businessService: BusinessService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateBusinessDto) {
    return this.businessService.create(user.userId, dto);
  }

  @Get('mine')
  listMine(@CurrentUser() user: AuthUser) {
    return this.businessService.listMine(user.userId);
  }

  @Post(':businessId/services')
  addService(
    @Param('businessId', ParseIntPipe) businessId: number,
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateBusinessServiceDto,
  ) {
    return this.businessService.addService(businessId, user.userId, dto);
  }

  @Get(':businessId/services')
  listServices(@Param('businessId', ParseIntPipe) businessId: number, @CurrentUser() user: AuthUser) {
    return this.businessService.listServicesForBusiness(businessId, user.userId);
  }

  @Patch('services/:id')
  updateService(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateBusinessServiceDto,
  ) {
    return this.businessService.updateBusinessService(id, user.userId, dto);
  }

  @Patch('services/:id/status')
  setServiceStatus(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateActiveStatusDto,
  ) {
    return this.businessService.setBusinessServiceStatus(id, user.userId, dto.status);
  }
}