import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { createReadStream, existsSync } from 'fs';
import { extname, join } from 'path';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AdminService } from './admin.service';
import { RejectVerificationDto } from './dto/reject-verification.dto';
import { CreateServiceCatalogDto } from './dto/create-service-catalog.dto';
import { UpdateActiveStatusDto } from './dto/update-active-status.dto';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMINISTRATOR')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('verification-requests')
  list(@Query('status') status?: 'PENDING' | 'APPROVED' | 'REJECTED') {
    return this.adminService.listVerificationRequests(status ?? 'PENDING');
  }

  @Post('verification-requests/:id/approve')
  approve(@Param('id', ParseIntPipe) id: number, @CurrentUser() admin: { userId: number }) {
    return this.adminService.approve(id, admin.userId);
  }

  @Post('verification-requests/:id/reject')
  reject(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() admin: { userId: number },
    @Body() dto: RejectVerificationDto,
  ) {
    return this.adminService.reject(id, admin.userId, dto);
  }

  @Get('verification-requests/:id/document')
  async getDocument(@Param('id', ParseIntPipe) id: number): Promise<StreamableFile> {
    const relativePath = await this.adminService.getVerificationDocumentPath(id);
    const absolutePath = join(process.cwd(), 'uploads', relativePath);

    if (!existsSync(absolutePath)) {
      throw new NotFoundException('الملف غير موجود فعليًا على الخادم (ربما حُذف أو نُقل).');
    }

    const mimeTypes: Record<string, string> = {
      '.pdf': 'application/pdf',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
    };
    const type = mimeTypes[extname(absolutePath).toLowerCase()] ?? 'application/octet-stream';

    return new StreamableFile(createReadStream(absolutePath), {
      type,
      disposition: `inline; filename="${absolutePath.split(/[\\/]/).pop()}"`,
    });
  }

  // --------- كتالوج أنواع الخدمات العام ---------
  @Get('services')
  listServiceCatalog() {
    return this.adminService.listServiceCatalog();
  }

  @Post('services')
  createServiceCatalogEntry(@Body() dto: CreateServiceCatalogDto) {
    return this.adminService.createServiceCatalogEntry(dto);
  }

  @Patch('services/:id/status')
  setServiceCatalogStatus(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateActiveStatusDto) {
    return this.adminService.setServiceCatalogStatus(id, dto.status);
  }

  // --------- المستخدمون ---------
  @Get('users')
  listUsers(@Query('role') role?: string, @Query('accountStatus') accountStatus?: string) {
    return this.adminService.listUsers({ role, accountStatus });
  }

  @Get('users/:id')
  getUserDetail(@Param('id', ParseIntPipe) id: number) {
    return this.adminService.getUserDetail(id);
  }

  // --------- المنشآت ---------
  @Get('businesses')
  listBusinesses() {
    return this.adminService.listBusinesses();
  }

  @Patch('businesses/:id/status')
  setBusinessStatus(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateActiveStatusDto) {
    return this.adminService.setBusinessStatus(id, dto.status);
  }

  // --------- مراقبة المناسبات (قراءة فقط) ---------
  @Get('events')
  listEvents(@Query('status') status?: string) {
    return this.adminService.listEvents(status);
  }
}