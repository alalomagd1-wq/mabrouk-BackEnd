import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ReasonDto } from './dto/reason.dto';

@Injectable()
export class ServiceRequestsService {
  constructor(private readonly prisma: PrismaService) {}

  // -----------------------------------------------------------
  // مزوّد الخدمة: طلباته حسب النطاق المطلوب
  // pending = تحتاج ردًا | active = قيد العمل حاليًا | completed = منتهية | all = الكل
  // -----------------------------------------------------------
  async listMine(ownerId: number, scope: 'pending' | 'active' | 'completed' | 'all' = 'pending') {
    const baseWhere = { businessService: { business: { ownerId } } };

    const scopeWhere =
      scope === 'pending'
        ? { status: 'PENDING' as const }
        : scope === 'active'
          ? {
              status: 'ACCEPTED' as const,
              eventService: { status: { in: ['IN_PROGRESS', 'WAITING_FOR_VERIFICATION', 'NEEDS_CORRECTION'] } },
            }
          : scope === 'completed'
            ? { eventService: { status: 'COMPLETED' as const } }
            : {}; // 'all'

    return this.prisma.serviceRequest.findMany({
      where: { ...baseWhere, ...scopeWhere as any },
      include: {
        businessService: { include: { business: true, service: true } },
        eventService: { include: { event: true } },
      },
      orderBy: { requestedAt: 'desc' },
    });
  }

  // -----------------------------------------------------------
  // مزوّد الخدمة يقبل الإسناد (DL-010) → الخدمة تدخل قيد التنفيذ مباشرة
  // -----------------------------------------------------------
  async accept(requestId: number, ownerId: number) {
    const { serviceRequest, eventService } = await this.loadAndAuthorizeOwner(requestId, ownerId, 'ASSIGNED');

    return this.prisma.$transaction(async (tx) => {
      await tx.serviceRequest.update({ where: { id: requestId }, data: { status: 'ACCEPTED', respondedAt: new Date() } });
      await tx.eventService.update({ where: { id: eventService.id }, data: { status: 'IN_PROGRESS', startedAt: new Date() } });

      await tx.decisionLog.create({
        data: { decidedBy: ownerId, decisionType: 'ACCEPT_SERVICE_ASSIGNMENT', decision: 'Accepted' }, // DL-010
      });
      await tx.activityLog.create({ data: { userId: ownerId, activityType: 'SERVICE_ASSIGNMENT_ACCEPTED' } });
      await this.notifyEventManagers(tx, eventService.eventId, {
        type: 'SERVICE_ASSIGNMENT_ACCEPTED', // NL-011
        title: 'تم قبول إسناد الخدمة',
        message: 'وافق مزوّد الخدمة على تنفيذ الخدمة المطلوبة وبدأ العمل عليها.',
        relatedEntityType: 'EVENT_SERVICE',
        relatedEntityId: eventService.id,
      });

      return tx.eventService.findUnique({ where: { id: eventService.id } });
    });
  }

  // -----------------------------------------------------------
  // مزوّد الخدمة يرفض الإسناد (DL-011)
  // -----------------------------------------------------------
  async reject(requestId: number, ownerId: number, dto: ReasonDto) {
    const { serviceRequest, eventService } = await this.loadAndAuthorizeOwner(requestId, ownerId, 'ASSIGNED');

    return this.prisma.$transaction(async (tx) => {
      await tx.serviceRequest.update({
        where: { id: requestId },
        data: { status: 'REJECTED', respondedAt: new Date() },
      });
      await tx.eventService.update({ where: { id: eventService.id }, data: { status: 'REJECTED' } });

      await tx.decisionLog.create({
        data: { decidedBy: ownerId, decisionType: 'REJECT_SERVICE_ASSIGNMENT', decision: 'Rejected', reason: dto.reason }, // DL-011
      });
      await tx.activityLog.create({
        data: { userId: ownerId, activityType: 'SERVICE_ASSIGNMENT_REJECTED', description: dto.reason },
      });
      await this.notifyEventManagers(tx, eventService.eventId, {
        type: 'SERVICE_ASSIGNMENT_REJECTED', // NL-012
        title: 'تم رفض إسناد الخدمة',
        message: `رفض مزوّد الخدمة تنفيذ الخدمة. السبب: ${dto.reason}. يلزم إسناد الخدمة لمزوّد آخر.`,
        relatedEntityType: 'EVENT_SERVICE',
        relatedEntityId: eventService.id,
      });

      return tx.eventService.findUnique({ where: { id: eventService.id } });
    });
  }

  // -----------------------------------------------------------
  // مزوّد الخدمة يُعلم بانتهاء التنفيذ → تنتقل لانتظار تحقق المدير
  // -----------------------------------------------------------
  async complete(requestId: number, ownerId: number) {
    const { eventService } = await this.loadAndAuthorizeOwner(requestId, ownerId, [
      'IN_PROGRESS',
      'NEEDS_CORRECTION',
    ]);

    return this.prisma.$transaction(async (tx) => {
      await tx.eventService.update({
        where: { id: eventService.id },
        data: { status: 'WAITING_FOR_VERIFICATION' },
      });
      await tx.activityLog.create({ data: { userId: ownerId, activityType: 'SERVICE_MARKED_COMPLETE' } });
      await this.notifyEventManagers(tx, eventService.eventId, {
        type: 'SERVICE_WAITING_VERIFICATION',
        title: 'خدمة جاهزة للتحقق',
        message: 'أعلن مزوّد الخدمة انتهاءه من التنفيذ. يرجى مراجعتها واعتمادها أو طلب تصحيح.',
        relatedEntityType: 'EVENT_SERVICE',
        relatedEntityId: eventService.id,
      });
      return tx.eventService.findUnique({ where: { id: eventService.id } });
    });
  }

  // -----------------------------------------------------------
  // مدير المناسبة يعتمد اكتمال الخدمة (DL-012)
  // -----------------------------------------------------------
  async approveCompletion(requestId: number, managerId: number) {
    const { eventService } = await this.loadAndAuthorizeManager(requestId, managerId, 'WAITING_FOR_VERIFICATION');

    return this.prisma.$transaction(async (tx) => {
      await tx.eventService.update({
        where: { id: eventService.id },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });
      await tx.decisionLog.create({
        data: { eventId: eventService.eventId, decidedBy: managerId, decisionType: 'APPROVE_SERVICE_COMPLETION', decision: 'Approved' }, // DL-012
      });
      await tx.activityLog.create({ data: { userId: managerId, eventId: eventService.eventId, activityType: 'SERVICE_APPROVED' } });
      await this.notifyServiceOwner(tx, requestId, {
        type: 'SERVICE_APPROVED', // NL-016
        title: 'تم اعتماد الخدمة',
        message: 'اعتمد مدير المناسبة الخدمة التي نفّذتها. عمل رائع!',
        relatedEntityType: 'EVENT_SERVICE',
        relatedEntityId: eventService.id,
      });
      return tx.eventService.findUnique({ where: { id: eventService.id } });
    });
  }

  // -----------------------------------------------------------
  // مدير المناسبة يطلب تصحيحًا (DL-013)
  // -----------------------------------------------------------
  async requestCorrection(requestId: number, managerId: number, dto: ReasonDto) {
    const { eventService } = await this.loadAndAuthorizeManager(requestId, managerId, 'WAITING_FOR_VERIFICATION');

    return this.prisma.$transaction(async (tx) => {
      await tx.eventService.update({ where: { id: eventService.id }, data: { status: 'NEEDS_CORRECTION' } });
      await tx.decisionLog.create({
        data: {
          eventId: eventService.eventId,
          decidedBy: managerId,
          decisionType: 'REQUEST_SERVICE_CORRECTION', // DL-013
          decision: 'Correction Requested',
          reason: dto.reason,
        },
      });
      await tx.activityLog.create({
        data: { userId: managerId, eventId: eventService.eventId, activityType: 'SERVICE_CORRECTION_REQUESTED', description: dto.reason },
      });
      await this.notifyServiceOwner(tx, requestId, {
        type: 'SERVICE_CORRECTION_REQUESTED', // NL-017
        title: 'طلب تصحيح على الخدمة',
        message: `طلب مدير المناسبة تصحيحًا: ${dto.reason}`,
        relatedEntityType: 'EVENT_SERVICE',
        relatedEntityId: eventService.id,
      });
      return tx.eventService.findUnique({ where: { id: eventService.id } });
    });
  }

  // =============================================================
  // Helpers
  // =============================================================
  private async loadAndAuthorizeOwner(requestId: number, ownerId: number, expectedStatus: string | string[]) {
    const serviceRequest = await this.prisma.serviceRequest.findUnique({
      where: { id: requestId },
      include: { businessService: { include: { business: true } }, eventService: true },
    });
    if (!serviceRequest) throw new NotFoundException('طلب الخدمة غير موجود.');
    if (serviceRequest.businessService.business.ownerId !== ownerId) {
      throw new ForbiddenException('لا تملك صلاحية على هذا الطلب.');
    }
    const allowed = Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus];
    if (!allowed.includes(serviceRequest.eventService.status)) {
      throw new ConflictException(
        `لا يمكن تنفيذ هذا الإجراء، حالة الخدمة الحالية "${serviceRequest.eventService.status}".`,
      );
    }
    return { serviceRequest, eventService: serviceRequest.eventService };
  }

  private async loadAndAuthorizeManager(requestId: number, managerId: number, expectedStatus: string) {
    const serviceRequest = await this.prisma.serviceRequest.findUnique({
      where: { id: requestId },
      include: { eventService: { include: { event: { include: { managerAssignments: true } } } } },
    });
    if (!serviceRequest) throw new NotFoundException('طلب الخدمة غير موجود.');
    const isManager = serviceRequest.eventService.event.managerAssignments.some(
      (a) => a.userId === managerId && a.status === 'ACTIVE',
    );
    if (!isManager) throw new ForbiddenException('لست المدير المسؤول عن هذه المناسبة.');
    if (serviceRequest.eventService.status !== expectedStatus) {
      throw new ConflictException(
        `لا يمكن تنفيذ هذا الإجراء، حالة الخدمة الحالية "${serviceRequest.eventService.status}".`,
      );
    }
    return { serviceRequest, eventService: serviceRequest.eventService };
  }

  private async notifyEventManagers(
    tx: any,
    eventId: number,
    data: { type: string; title: string; message: string; relatedEntityType: string; relatedEntityId: number },
  ) {
    const managers = await tx.eventManagerAssignment.findMany({ where: { eventId, status: 'ACTIVE' } });
    for (const m of managers) {
      await tx.notification.create({ data: { userId: m.userId, ...data } });
    }
  }

  private async notifyServiceOwner(
    tx: any,
    requestId: number,
    data: { type: string; title: string; message: string; relatedEntityType: string; relatedEntityId: number },
  ) {
    const req = await tx.serviceRequest.findUnique({
      where: { id: requestId },
      include: { businessService: { include: { business: true } } },
    });
    await tx.notification.create({ data: { userId: req.businessService.business.ownerId, ...data } });
  }
}