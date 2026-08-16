import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ApprovedAccountGuard } from '../auth/guards/approved-account.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { EventsService } from './events.service';
import { CreateEventDto } from './dto/create-event.dto';
import { ReplaceServiceOwnerDto } from './dto/replace-service-owner.dto';
import { ServiceCategory } from '../admin/dto/create-service-catalog.dto';

interface AuthUser {
  userId: number;
  role: string;
  accountStatus: string;
}

@Controller('events')
@UseGuards(JwtAuthGuard)
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Get('available-services')
  listAvailableServices() {
    return this.eventsService.listAvailableServices();
  }

  // القيم الثابتة المسموحة لفئة الخدمة — القيمة الداخلية إنجليزية (مستقرة للكود وقاعدة
  // البيانات)، والتسمية بالعربية للعرض في القوائم المنسدلة بالواجهة
  @Get('service-categories')
  listServiceCategories() {
    const labels: Partial<Record<ServiceCategory, string>> = {
      [ServiceCategory.PHOTOGRAPHY]: 'تصوير فوتوغرافي',
      [ServiceCategory.CATERING]: 'تقديم الطعام والمشروبات',
      [ServiceCategory.DECORATION]: 'ديكور وتنسيق',
      [ServiceCategory.DANCE_AND_CHOREOGRAPHY]: 'رقص وتنسيق الحركات',
      [ServiceCategory.MUSIC_AND_ENTERTAINMENT]: 'موسيقى وترفيه',
      [ServiceCategory.VENUE]: 'تأجير قاعة أو مكان',
      [ServiceCategory.LIGHTING]: 'إضاءة',
      [ServiceCategory.FURNITURE_AND_SEATING]: 'أثاث وجلسات',
      [ServiceCategory.TRANSPORTATION]: 'نقل وتوصيل',
      [ServiceCategory.SWEETS_AND_DESSERTS]: 'حلويات وتحلية',
      [ServiceCategory.BEAUTY_AND_MAKEUP]: 'تجميل ومكياج',
      [ServiceCategory.PRINTING_AND_INVITATIONS]: 'دعوات وطباعة',
      [ServiceCategory.OTHER]: 'أخرى',
    };

    return (Object.values(ServiceCategory) as ServiceCategory[]).map((value) => ({
      value,
      label: labels[value] ?? value,
    }));
  }

  @Post()
  @UseGuards(RolesGuard, ApprovedAccountGuard)
  @Roles('CUSTOMER')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateEventDto) {
    return this.eventsService.createAndSubmit(user.userId, dto);
  }

  @Get('requests')
  @UseGuards(RolesGuard, ApprovedAccountGuard)
  @Roles('EVENT_MANAGER')
  listNewRequests() {
    return this.eventsService.listNewRequests();
  }

  @Post(':id/adopt')
  @UseGuards(RolesGuard, ApprovedAccountGuard)
  @Roles('EVENT_MANAGER')
  adopt(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.eventsService.adopt(id, user.userId);
  }

  @Post(':eventId/services/:eventServiceId/send')
  @UseGuards(RolesGuard, ApprovedAccountGuard)
  @Roles('EVENT_MANAGER')
  sendAssignment(
    @Param('eventId', ParseIntPipe) eventId: number,
    @Param('eventServiceId', ParseIntPipe) eventServiceId: number,
    @CurrentUser() user: AuthUser,
  ) {
    return this.eventsService.sendServiceAssignment(eventId, eventServiceId, user.userId);
  }

  @Post(':eventId/services/:eventServiceId/replace-owner')
  @UseGuards(RolesGuard, ApprovedAccountGuard)
  @Roles('EVENT_MANAGER')
  replaceServiceOwner(
    @Param('eventId', ParseIntPipe) eventId: number,
    @Param('eventServiceId', ParseIntPipe) eventServiceId: number,
    @CurrentUser() user: AuthUser,
    @Body() dto: ReplaceServiceOwnerDto,
  ) {
    return this.eventsService.replaceServiceOwner(eventId, eventServiceId, user.userId, dto);
  }

  @Get('mine')
  listMine(@CurrentUser() user: AuthUser) {
    return this.eventsService.listMine(user);
  }

  @Post(':id/close')
  @UseGuards(RolesGuard, ApprovedAccountGuard)
  @Roles('EVENT_MANAGER')
  close(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.eventsService.closeEvent(id, user.userId);
  }

  @Get(':id/activity-log')
  getActivityLog(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.eventsService.getActivityLog(id, user);
  }

  @Get(':id/decision-log')
  getDecisionLog(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.eventsService.getDecisionLog(id, user);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.eventsService.findOne(id, user);
  }
}