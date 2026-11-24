import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RequestLockService } from '../request-lock/request-lock.service';
import { CreateEventDto } from './dto/create-event.dto';

@Injectable()
export class EventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly requestLock: RequestLockService,
  ) {}

  // -----------------------------------------------------------
  // الخدمات المتاحة للعميل ليختار منها عند إنشاء المناسبة
  // -----------------------------------------------------------
  async listAvailableServices() {
    return this.prisma.businessService.findMany({
      where: { status: 'ACTIVE', business: { status: 'ACTIVE' }, service: { status: 'ACTIVE' } },
      include: {
        business: { select: { id: true, name: true, address: true, phone: true } },
        service: { select: { id: true, name: true, category: true } },
      },
    });
  }

  // -----------------------------------------------------------
  // العميل ينشئ المناسبة ويرسلها مباشرة (Create + Submit في خطوة واحدة)
  // -----------------------------------------------------------
  async createAndSubmit(customerId: number, dto: CreateEventDto) {
    const businessServices = await this.prisma.businessService.findMany({
      where: { id: { in: dto.businessServiceIds }, status: 'ACTIVE' },
    });

    if (businessServices.length !== dto.businessServiceIds.length) {
      throw new BadRequestException('بعض الخدمات المختارة غير موجودة أو غير متاحة حاليًا.');
    }

    return this.prisma.$transaction(async (tx) => {
      const event = await tx.event.create({
        data: {
          userId: customerId,
          title: dto.title,
          description: dto.description,
          eventDate: new Date(dto.eventDate),
          location: dto.location,
          status: 'SUBMITTED',
        },
      });

      for (const bs of businessServices) {
        const eventService = await tx.eventService.create({
          data: {
            eventId: event.id,
            status: 'PENDING_ASSIGNMENT',
            price: bs.price,
          },
        });
        await tx.serviceRequest.create({
          data: {
            eventServiceId: eventService.id,
            businessServiceId: bs.id,
            status: 'PENDING',
          },
        });
      }

      await tx.activityLog.create({
        data: {
          userId: customerId,
          eventId: event.id,
          activityType: 'EVENT_SUBMITTED', // راجع Activity_Logs.docx
          description: `Event "${event.title}" created and submitted with ${businessServices.length} service(s).`,
        },
      });

      // بث إشعار لكل مدراء المناسبات المعتمدين بوجود طلب جديد ينتظر التبنّي
      const approvedManagers = await tx.user.findMany({
        where: { role: 'EVENT_MANAGER', accountStatus: 'APPROVED' },
        select: { id: true },
      });
      for (const manager of approvedManagers) {
        await tx.notification.create({
          data: {
            userId: manager.id,
            type: 'NEW_EVENT_REQUEST',
            title: 'طلب مناسبة جديد',
            message: `مناسبة جديدة "${event.title}" بانتظار من يتبنّاها.`,
            relatedEntityType: 'EVENT',
            relatedEntityId: event.id,
          },
        });
      }

      return tx.event.findUnique({
        where: { id: event.id },
        include: { eventServices: true },
      });
    });
  }

  // -----------------------------------------------------------
  // مدير المناسبة: قائمة الطلبات الجديدة غير المتبنّاة (بديل "Publish to Queue")
  // -----------------------------------------------------------
  async listNewRequests() {
    return this.prisma.event.findMany({
      where: {
        status: 'SUBMITTED',
        managerAssignments: { none: { managerRole: 'PRIMARY', status: 'ACTIVE' } },
      },
      orderBy: { createdAt: 'asc' },
      include: {
        customer: { select: { id: true, firstName: true, lastName: true, email: true } },
        eventServices: true,
      },
    });
  }

  // -----------------------------------------------------------
  // مدير المناسبة يتبنى الطلب فيصبح Primary Event Manager
  // -----------------------------------------------------------
  async adopt(eventId: number, managerId: number) {
    const lockKey = `event:${eventId}:adopt`;

    return this.requestLock.executeWithLock(lockKey, async () => {
      const event = await this.prisma.event.findUnique({
        where: { id: eventId },
        include: { managerAssignments: { where: { managerRole: 'PRIMARY', status: 'ACTIVE' } } },
      });

      if (!event) throw new NotFoundException('المناسبة غير موجودة.');
      if (event.status !== 'SUBMITTED') {
        throw new ConflictException(`لا يمكن تبنّي هذه المناسبة، حالتها الحالية "${event.status}".`);
      }
      if (event.managerAssignments.length > 0) {
        throw new ConflictException('تم تبنّي هذه المناسبة بالفعل من مدير آخر.');
      }

      return this.prisma.$transaction(async (tx) => {
        await tx.eventManagerAssignment.create({
          data: {
            eventId,
            userId: managerId,
            managerRole: 'PRIMARY',
            status: 'ACTIVE',
            joinedAt: new Date(),
          },
        });

        const updatedEvent = await tx.event.update({
          where: { id: eventId },
          data: { status: 'ADOPTED' },
        });

        await tx.eventStatusHistory.create({
          data: {
            eventId,
            changedBy: managerId,
            oldStatus: 'SUBMITTED',
            newStatus: 'ADOPTED',
          },
        });

        await tx.decisionLog.create({
          data: {
            eventId,
            decidedBy: managerId,
            decisionType: 'ADOPT_EVENT_REQUEST', // DL-005
            decision: 'Adopted',
          },
        });

        await tx.activityLog.create({
          data: {
            userId: managerId,
            eventId,
            activityType: 'EVENT_ADOPTED',
          },
        });

        await tx.notification.create({
          data: {
            userId: updatedEvent.userId,
            type: 'EVENT_ADOPTED', // NL-006
            title: 'تم تبنّي مناسبتك',
            message: 'قام أحد مدراء المناسبات بتبنّي طلبك وسيبدأ بترتيب الخدمات المطلوبة.',
            relatedEntityType: 'EVENT',
            relatedEntityId: eventId,
          },
        });

        return updatedEvent;
      });
    });
  }

  // -----------------------------------------------------------
  // تفاصيل مناسبة واحدة (مع تحقق بسيط من الصلاحية على مستوى العميل)
  // -----------------------------------------------------------
  async findOne(eventId: number, requester: { userId: number; role: string }) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: {
        customer: { select: { id: true, firstName: true, lastName: true, email: true } },
        managerAssignments: { include: { user: { select: { id: true, firstName: true, lastName: true } } } },
        eventServices: { include: { serviceRequests: true } },
      },
    });
    if (!event) throw new NotFoundException('المناسبة غير موجودة.');

    const isOwner = event.userId === requester.userId;
    const isAssignedManager = event.managerAssignments.some((a) => a.userId === requester.userId);
    if (requester.role === 'CUSTOMER' && !isOwner) {
      throw new ForbiddenException('لا تملك صلاحية عرض هذه المناسبة.');
    }
    if (requester.role === 'EVENT_MANAGER' && !isAssignedManager) {
      throw new ForbiddenException('لا تملك صلاحية عرض هذه المناسبة.');
    }

    return event;
  }

  // -----------------------------------------------------------
  // سجل النشاط لمناسبة معينة (العميل صاحبها أو أحد مدرائها فقط)
  // -----------------------------------------------------------
  async getActivityLog(eventId: number, requester: { userId: number; role: string }) {
    await this.assertCanViewEvent(eventId, requester);
    return this.prisma.activityLog.findMany({
      where: { eventId },
      include: { user: { select: { id: true, firstName: true, lastName: true, role: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  // -----------------------------------------------------------
  // سجل القرارات لمناسبة معينة (نفس شرط الصلاحية)
  // -----------------------------------------------------------
  async getDecisionLog(eventId: number, requester: { userId: number; role: string }) {
    await this.assertCanViewEvent(eventId, requester);
    return this.prisma.decisionLog.findMany({
      where: { eventId },
      include: { user: { select: { id: true, firstName: true, lastName: true, role: true } } },
      orderBy: { decidedAt: 'asc' },
    });
  }

  // -----------------------------------------------------------
  private async assertCanViewEvent(eventId: number, requester: { userId: number; role: string }) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: { managerAssignments: true },
    });
    if (!event) throw new NotFoundException('المناسبة غير موجودة.');

    const isOwner = event.userId === requester.userId;
    const isAssignedManager = event.managerAssignments.some(
      (a) => a.userId === requester.userId && a.status === 'ACTIVE',
    );
    if (requester.role === 'CUSTOMER' && !isOwner) {
      throw new ForbiddenException('لا تملك صلاحية عرض هذه المناسبة.');
    }
    if (requester.role === 'EVENT_MANAGER' && !isAssignedManager) {
      throw new ForbiddenException('لا تملك صلاحية عرض هذه المناسبة.');
    }
    return event;
  }

  // -----------------------------------------------------------
  // مناسباتي — دور-محور: العميل يرى مناسباته، المدير يرى مناسباته المُسنَدة إليه
  // -----------------------------------------------------------
  async listMine(requester: { userId: number; role: string }) {
    const baseInclude = {
      customer: { select: { id: true, firstName: true, lastName: true, email: true } },
      managerAssignments: { include: { user: { select: { id: true, firstName: true, lastName: true } } } },
      eventServices: true,
    };

    if (requester.role === 'CUSTOMER') {
      return this.prisma.event.findMany({
        where: { userId: requester.userId },
        include: baseInclude,
        orderBy: { createdAt: 'desc' },
      });
    }

    if (requester.role === 'EVENT_MANAGER') {
      return this.prisma.event.findMany({
        where: { managerAssignments: { some: { userId: requester.userId, status: 'ACTIVE' } } },
        include: baseInclude,
        orderBy: { createdAt: 'desc' },
      });
    }

    throw new ForbiddenException('هذا المسار متاح فقط لـ Customer أو Event Manager.');
  }

  // -----------------------------------------------------------
  // مدير المناسبة يرسل الإسناد لمزوّد الخدمة (Diagram 3)
  // -----------------------------------------------------------
  async sendServiceAssignment(eventId: number, eventServiceId: number, managerId: number) {
    await this.assertManagerOwnsEvent(eventId, managerId);

    const eventService = await this.prisma.eventService.findUnique({
      where: { id: eventServiceId },
      include: {
        serviceRequests: {
          where: { status: 'PENDING' },
          include: { businessService: { include: { business: true } } },
        },
      },
    });

    if (!eventService || eventService.eventId !== eventId) {
      throw new NotFoundException('الخدمة غير موجودة ضمن هذه المناسبة.');
    }
    if (eventService.status !== 'PENDING_ASSIGNMENT') {
      throw new ConflictException(`لا يمكن إرسال الإسناد، حالة الخدمة الحالية "${eventService.status}".`);
    }
    const pendingRequest = eventService.serviceRequests[0];
    if (!pendingRequest) {
      throw new ConflictException('لا يوجد طلب إسناد معلّق لهذه الخدمة.');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.eventService.update({
        where: { id: eventServiceId },
        data: { status: 'ASSIGNED' },
      });

      const currentEvent = await tx.event.findUnique({ where: { id: eventId } });
      if (currentEvent && currentEvent.status === 'ADOPTED') {
        await tx.event.update({ where: { id: eventId }, data: { status: 'IN_PROGRESS' } });
        await tx.eventStatusHistory.create({
          data: { eventId, changedBy: managerId, oldStatus: 'ADOPTED', newStatus: 'IN_PROGRESS' },
        });
      }

      await tx.activityLog.create({
        data: {
          userId: managerId,
          eventId,
          activityType: 'SERVICE_ASSIGNMENT_SENT',
        },
      });

      await tx.notification.create({
        data: {
          userId: pendingRequest.businessService.business.ownerId,
          type: 'SERVICE_ASSIGNMENT_SENT', // NL-010
          title: 'طلب إسناد خدمة جديد',
          message: 'لديك طلب تنفيذ خدمة جديد ضمن مناسبة. يرجى مراجعته والرد عليه.',
          relatedEntityType: 'EVENT_SERVICE',
          relatedEntityId: eventServiceId,
        },
      });

      return tx.eventService.findUnique({ where: { id: eventServiceId } });
    });
  }

  // -----------------------------------------------------------
  // -----------------------------------------------------------
  // استبدال مزوّد الخدمة (Diagram 5 / DL-009) — بلا حاجة لموافقة العميل
  // -----------------------------------------------------------
  async replaceServiceOwner(
    eventId: number,
    eventServiceId: number,
    managerId: number,
    dto: { newBusinessServiceId: number; reason: string },
  ) {
    await this.assertManagerOwnsEvent(eventId, managerId);

    const eventService = await this.prisma.eventService.findUnique({ where: { id: eventServiceId } });
    if (!eventService || eventService.eventId !== eventId) {
      throw new NotFoundException('الخدمة غير موجودة ضمن هذه المناسبة.');
    }
    if (['PENDING_ASSIGNMENT', 'COMPLETED'].includes(eventService.status)) {
      throw new ConflictException(
        `لا يمكن استبدال المزوّد، حالة الخدمة الحالية "${eventService.status}" لا تسمح بذلك.`,
      );
    }

    const newBusinessService = await this.prisma.businessService.findUnique({
      where: { id: dto.newBusinessServiceId },
      include: { business: true },
    });
    if (!newBusinessService || newBusinessService.status !== 'ACTIVE') {
      throw new BadRequestException('عرض الخدمة الجديد غير موجود أو غير متاح.');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.eventService.update({ where: { id: eventServiceId }, data: { status: 'ASSIGNED' } });

      await tx.serviceRequest.create({
        data: { eventServiceId, businessServiceId: dto.newBusinessServiceId, status: 'PENDING' },
      });

      await tx.decisionLog.create({
        data: { eventId, decidedBy: managerId, decisionType: 'CHANGE_SERVICE_OWNER', decision: 'Replaced', reason: dto.reason }, // DL-009
      });
      await tx.activityLog.create({
        data: { userId: managerId, eventId, activityType: 'SERVICE_OWNER_CHANGED', description: dto.reason },
      });

      await tx.notification.create({
        data: {
          userId: newBusinessService.business.ownerId,
          type: 'SERVICE_ASSIGNMENT_SENT',
          title: 'طلب إسناد خدمة جديد',
          message: 'لديك طلب تنفيذ خدمة جديد ضمن مناسبة. يرجى مراجعته والرد عليه.',
          relatedEntityType: 'EVENT_SERVICE',
          relatedEntityId: eventServiceId,
        },
      });

      const event = await tx.event.findUnique({ where: { id: eventId } });
      if (event) {
        await tx.notification.create({
          data: {
            userId: event.userId,
            type: 'SERVICE_OWNER_CHANGED', // NL-013
            title: 'تغيير مزوّد الخدمة',
            message: `تم تغيير مزوّد أحد الخدمات ضمن مناسبتك. السبب: ${dto.reason}`,
            relatedEntityType: 'EVENT_SERVICE',
            relatedEntityId: eventServiceId,
          },
        });
      }

      return tx.eventService.findUnique({ where: { id: eventServiceId } });
    });
  }

  // -----------------------------------------------------------
  // إغلاق المناسبة نهائيًا (Diagram 8 / DL-014) — المدير الرئيسي فقط،
  // ويتطلب اكتمال كل الخدمات أولاً
  // -----------------------------------------------------------
  async closeEvent(eventId: number, managerId: number) {
    await this.assertManagerOwnsEvent(eventId, managerId, 'PRIMARY');

    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: { eventServices: true },
    });
    if (!event) throw new NotFoundException('المناسبة غير موجودة.');
    if (event.status === 'COMPLETED') {
      throw new ConflictException('هذه المناسبة مغلقة بالفعل.');
    }

    const notCompleted = event.eventServices.filter((s) => s.status !== 'COMPLETED');
    if (notCompleted.length > 0) {
      throw new ConflictException(
        `لا يمكن إغلاق المناسبة، هناك ${notCompleted.length} خدمة/خدمات لم تكتمل بعد (الحالات: ${notCompleted
          .map((s) => s.status)
          .join(', ')}).`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const previousStatus = event.status;
      const updated = await tx.event.update({ where: { id: eventId }, data: { status: 'COMPLETED' } });

      await tx.eventStatusHistory.create({
        data: { eventId, changedBy: managerId, oldStatus: previousStatus, newStatus: 'COMPLETED' },
      });
      await tx.decisionLog.create({
        data: { eventId, decidedBy: managerId, decisionType: 'CLOSE_EVENT', decision: 'Closed' }, // DL-014
      });
      await tx.activityLog.create({
        data: { userId: managerId, eventId, activityType: 'EVENT_COMPLETED' }, // AL-021
      });
      await tx.notification.create({
        data: {
          userId: updated.userId,
          type: 'EVENT_COMPLETED', // NL-019
          title: 'اكتملت مناسبتك',
          message: 'تم اعتماد اكتمال جميع الخدمات وإغلاق المناسبة رسميًا. نتمنى أنها نالت رضاك!',
          relatedEntityType: 'EVENT',
          relatedEntityId: eventId,
        },
      });

      return updated;
    });
  }

  // -----------------------------------------------------------
  private async assertManagerOwnsEvent(eventId: number, managerId: number, role?: 'PRIMARY' | 'ASSISTANT') {
    const assignment = await this.prisma.eventManagerAssignment.findFirst({
      where: { eventId, userId: managerId, status: 'ACTIVE', ...(role ? { managerRole: role } : {}) },
    });
    if (!assignment) {
      throw new ForbiddenException(
        role === 'PRIMARY' ? 'فقط المدير الرئيسي لهذه المناسبة يمكنه هذا الإجراء.' : 'لست المدير المسؤول عن هذه المناسبة.',
      );
    }
  }
}