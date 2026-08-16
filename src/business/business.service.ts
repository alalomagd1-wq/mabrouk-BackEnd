import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBusinessDto } from './dto/create-business.dto';
import { CreateBusinessServiceDto } from './dto/create-business-service.dto';

@Injectable()
export class BusinessService {
  constructor(private readonly prisma: PrismaService) {}

  // -----------------------------------------------------------
  // إنشاء منشأة جديدة لصاحب الخدمة (قد يملك أكثر من منشأة)
  // -----------------------------------------------------------
  async create(ownerId: number, dto: CreateBusinessDto) {
    return this.prisma.business.create({
      data: {
        ownerId,
        name: dto.name,
        description: dto.description,
        phone: dto.phone,
        address: dto.address,
        status: 'ACTIVE',
      },
    });
  }

  // -----------------------------------------------------------
  // منشآتي
  // -----------------------------------------------------------
  async listMine(ownerId: number) {
    return this.prisma.business.findMany({
      where: { ownerId },
      include: { businessServices: { include: { service: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  // -----------------------------------------------------------
  // إضافة عرض خدمة لمنشأة:
  // - إن أُرسل serviceId: يجب أن يكون موجودًا وفعّالًا.
  // - وإلا: يبحث بالاسم في الكتالوج، وإن لم يجد ينشئ عنصر كتالوج جديدًا تلقائيًا (يتطلب category).
  // -----------------------------------------------------------
  async addService(businessId: number, ownerId: number, dto: CreateBusinessServiceDto) {
    const business = await this.prisma.business.findUnique({ where: { id: businessId } });
    if (!business) throw new NotFoundException('المنشأة غير موجودة.');
    if (business.ownerId !== ownerId) {
      throw new ForbiddenException('لا تملك صلاحية على هذه المنشأة.');
    }

    const serviceId = await this.resolveServiceId(dto);

    return this.prisma.businessService.create({
      data: {
        businessId,
        serviceId,
        price: dto.price,
        description: dto.description,
        status: 'ACTIVE',
      },
      include: { service: true },
    });
  }

  // -----------------------------------------------------------
  private async resolveServiceId(dto: CreateBusinessServiceDto): Promise<number> {
    // الحالة 1: تحديد صريح لخدمة موجودة
    if (dto.serviceId) {
      const service = await this.prisma.service.findUnique({ where: { id: dto.serviceId } });
      if (!service || service.status !== 'ACTIVE') {
        throw new BadRequestException('نوع الخدمة المختار غير موجود أو غير متاح حاليًا.');
      }
      return service.id;
    }

    if (!dto.serviceName) {
      throw new BadRequestException('يجب إرسال serviceId، أو serviceName مع category لإنشاء خدمة جديدة.');
    }

    // الحالة 2: البحث بالاسم أولاً (تفاديًا لتكرار خدمات متطابقة)
    const existing = await this.prisma.service.findFirst({
      where: { name: dto.serviceName.trim(), status: 'ACTIVE' },
    });
    if (existing) return existing.id;

    // الحالة 3: لم توجد — أنشئها تلقائيًا (تتطلب category صالحة)
    if (!dto.category) {
      throw new BadRequestException(
        'هذه الخدمة غير موجودة في الكتالوج بعد، يجب تحديد category لإنشائها تلقائيًا.',
      );
    }
    const created = await this.prisma.service.create({
      data: {
        name: dto.serviceName.trim(),
        category: dto.category as any,
        status: 'ACTIVE',
      },
    });
    return created.id;
  }

  // -----------------------------------------------------------
  // تعديل عرض خدمة (السعر/الوصف) — يجب أن يملك المستخدم المنشأة صاحبة العرض
  // -----------------------------------------------------------
  async updateBusinessService(businessServiceId: number, ownerId: number, dto: { price?: number; description?: string }) {
    const businessService = await this.assertOwnsBusinessService(businessServiceId, ownerId);
    return this.prisma.businessService.update({
      where: { id: businessServiceId },
      data: {
        ...(dto.price !== undefined ? { price: dto.price } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
      },
      include: { service: true },
    });
  }

  // -----------------------------------------------------------
  // تعطيل/تفعيل عرض خدمة (بدل حذفه — يحافظ على السجل التاريخي للطلبات المرتبطة به)
  // -----------------------------------------------------------
  async setBusinessServiceStatus(businessServiceId: number, ownerId: number, status: 'ACTIVE' | 'INACTIVE') {
    await this.assertOwnsBusinessService(businessServiceId, ownerId);
    return this.prisma.businessService.update({
      where: { id: businessServiceId },
      data: { status },
      include: { service: true },
    });
  }

  // -----------------------------------------------------------
  private async assertOwnsBusinessService(businessServiceId: number, ownerId: number) {
    const businessService = await this.prisma.businessService.findUnique({
      where: { id: businessServiceId },
      include: { business: true },
    });
    if (!businessService) throw new NotFoundException('عرض الخدمة غير موجود.');
    if (businessService.business.ownerId !== ownerId) {
      throw new ForbiddenException('لا تملك صلاحية على هذا العرض.');
    }
    return businessService;
  }

  // -----------------------------------------------------------
  // خدمات منشأة معينة (يملكها صاحب الخدمة)
  // -----------------------------------------------------------
  async listServicesForBusiness(businessId: number, ownerId: number) {
    const business = await this.prisma.business.findUnique({ where: { id: businessId } });
    if (!business) throw new NotFoundException('المنشأة غير موجودة.');
    if (business.ownerId !== ownerId) {
      throw new ForbiddenException('لا تملك صلاحية على هذه المنشأة.');
    }
    return this.prisma.businessService.findMany({
      where: { businessId },
      include: { service: true },
    });
  }
}