import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RejectVerificationDto } from './dto/reject-verification.dto';
import { CreateServiceCatalogDto } from './dto/create-service-catalog.dto';

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  // -----------------------------------------------------------
  // عرض كل طلبات التحقق (افتراضيًا المعلّقة فقط)
  // -----------------------------------------------------------
  async listVerificationRequests(status: 'PENDING' | 'APPROVED' | 'REJECTED' = 'PENDING') {
    return this.prisma.verificationRequest.findMany({
      where: { status },
      orderBy: { submittedAt: 'asc' },
      include: {
        applicant: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            role: true,
            accountStatus: true,
          },
        },
      },
    });
  }

  // -----------------------------------------------------------
  // اعتماد طلب: يفعّل الحساب + يحدّث الطلب + يسجّل القرار والنشاط + يُشعر المستخدم
  // -----------------------------------------------------------
  async approve(verificationId: number, adminId: number) {
    const request = await this.getPendingRequestOrThrow(verificationId);

    return this.prisma.$transaction(async (tx) => {
      await tx.verificationRequest.update({
        where: { id: verificationId },
        data: { status: 'APPROVED', reviewedBy: adminId, reviewedAt: new Date() },
      });

      const user = await tx.user.update({
        where: { id: request.userId },
        data: { accountStatus: 'APPROVED' },
      });

      await tx.decisionLog.create({
        data: {
          decidedBy: adminId,
          decisionType: 'APPROVE_ACCOUNT',
          decision: 'Approved',
          reason: `${user.role} account verified and approved.`,
        },
      });

      await tx.activityLog.create({
        data: {
          userId: user.id,
          activityType: 'ACCOUNT_APPROVED',
          description: 'Account verification approved by Administrator.',
        },
      });

      await tx.notification.create({
        data: {
          userId: user.id,
          type: 'ACCOUNT_APPROVED',
          title: 'تم اعتماد حسابك',
          message: 'تهانينا! تم التحقق من هويتك واعتماد حسابك. يمكنك الآن استخدام جميع ميزات النظام.',
          relatedEntityType: 'USER',
          relatedEntityId: user.id,
        },
      });

      return { message: 'تم اعتماد الحساب بنجاح.', user };
    });
  }

  // -----------------------------------------------------------
  // رفض طلب: يرفض الحساب مع سبب إلزامي
  // -----------------------------------------------------------
  async reject(verificationId: number, adminId: number, dto: RejectVerificationDto) {
    const request = await this.getPendingRequestOrThrow(verificationId);

    return this.prisma.$transaction(async (tx) => {
      await tx.verificationRequest.update({
        where: { id: verificationId },
        data: {
          status: 'REJECTED',
          reviewedBy: adminId,
          reviewedAt: new Date(),
          rejectionReason: dto.reason,
        },
      });

      const user = await tx.user.update({
        where: { id: request.userId },
        data: { accountStatus: 'REJECTED' },
      });

      await tx.decisionLog.create({
        data: {
          decidedBy: adminId,
          decisionType: 'REJECT_ACCOUNT',
          decision: 'Rejected',
          reason: dto.reason,
        },
      });

      await tx.activityLog.create({
        data: {
          userId: user.id,
          activityType: 'ACCOUNT_REJECTED',
          description: `Account verification rejected. Reason: ${dto.reason}`,
        },
      });

      await tx.notification.create({
        data: {
          userId: user.id,
          type: 'ACCOUNT_REJECTED',
          title: 'تم رفض طلب التحقق من حسابك',
          message: `للأسف تم رفض طلبك. السبب: ${dto.reason}`,
          relatedEntityType: 'USER',
          relatedEntityId: user.id,
        },
      });

      return { message: 'تم رفض الحساب.', user };
    });
  }

  // -----------------------------------------------------------
  // إدارة كتالوج أنواع الخدمات العام (Service Catalog)
  // -----------------------------------------------------------
  async createServiceCatalogEntry(dto: CreateServiceCatalogDto) {
    return this.prisma.service.create({
      data: {
        name: dto.name,
        description: dto.description,
        category: dto.category,
        status: 'ACTIVE',
      },
    });
  }

  async listServiceCatalog() {
    return this.prisma.service.findMany({ orderBy: { name: 'asc' } });
  }

  // -----------------------------------------------------------
  // -----------------------------------------------------------
  // إدارة المستخدمين (مراقبة/بحث)
  // -----------------------------------------------------------
  async listUsers(filters: { role?: string; accountStatus?: string }) {
    return this.prisma.user.findMany({
      where: {
        ...(filters.role ? { role: filters.role as any } : {}),
        ...(filters.accountStatus ? { accountStatus: filters.accountStatus as any } : {}),
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        role: true,
        accountStatus: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getUserDetail(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        role: true,
        accountStatus: true,
        createdAt: true,
        businesses: true,
        events: { select: { id: true, title: true, status: true } },
      },
    });
    if (!user) throw new NotFoundException('المستخدم غير موجود.');
    return user;
  }

  // -----------------------------------------------------------
  // إدارة المنشآت (مراقبة + تعطيل/تفعيل عند سوء الاستخدام)
  // -----------------------------------------------------------
  async listBusinesses() {
    return this.prisma.business.findMany({
      include: {
        owner: { select: { id: true, firstName: true, lastName: true, email: true } },
        businessServices: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async setBusinessStatus(businessId: number, status: 'ACTIVE' | 'INACTIVE') {
    const business = await this.prisma.business.findUnique({ where: { id: businessId } });
    if (!business) throw new NotFoundException('المنشأة غير موجودة.');
    return this.prisma.business.update({ where: { id: businessId }, data: { status } });
  }

  // -----------------------------------------------------------
  // مراقبة المناسبات (قراءة فقط — لا صلاحية تعديل قرارات مدير المناسبة)
  // -----------------------------------------------------------
  async listEvents(status?: string) {
    return this.prisma.event.findMany({
      where: status ? { status: status as any } : undefined,
      select: {
        id: true,
        title: true,
        status: true,
        eventDate: true,
        createdAt: true,
        customer: { select: { id: true, firstName: true, lastName: true } },
        managerAssignments: {
          where: { status: 'ACTIVE' },
          select: { managerRole: true, user: { select: { id: true, firstName: true, lastName: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // -----------------------------------------------------------
  // تعطيل/تفعيل عنصر من كتالوج الخدمات
  // -----------------------------------------------------------
  async setServiceCatalogStatus(serviceId: number, status: 'ACTIVE' | 'INACTIVE') {
    const service = await this.prisma.service.findUnique({ where: { id: serviceId } });
    if (!service) throw new NotFoundException('نوع الخدمة غير موجود.');
    return this.prisma.service.update({ where: { id: serviceId }, data: { status } });
  }

  // -----------------------------------------------------------
  // -----------------------------------------------------------
  // مسار مستند التحقق المخزَّن (يُستخدم لعرضه/تحميله من الكونترولر)
  // -----------------------------------------------------------
  async getVerificationDocumentPath(verificationId: number) {
    const request = await this.prisma.verificationRequest.findUnique({ where: { id: verificationId } });
    if (!request) throw new NotFoundException('طلب التحقق غير موجود.');
    if (!request.documentPath) throw new NotFoundException('لا يوجد مستند مرفق لهذا الطلب.');
    return request.documentPath;
  }

  // -----------------------------------------------------------
  private async getPendingRequestOrThrow(verificationId: number) {
    const request = await this.prisma.verificationRequest.findUnique({
      where: { id: verificationId },
    });
    if (!request) {
      throw new NotFoundException('طلب التحقق غير موجود.');
    }
    if (request.status !== 'PENDING') {
      throw new ConflictException(
        `لا يمكن معالجة هذا الطلب لأن حالته الحالية "${request.status}" وليست PENDING.`,
      );
    }
    return request;
  }
}