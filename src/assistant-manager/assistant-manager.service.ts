import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OpenAssistantCallDto } from './dto/open-assistant-call.dto';

@Injectable()
export class AssistantManagerService {
  constructor(private readonly prisma: PrismaService) {}

  // -----------------------------------------------------------
  // المدير الرئيسي يفتح نداءً عامًا: "أحتاج N مدير/مدراء مساعدين"
  // -----------------------------------------------------------
  async openCall(eventId: number, primaryManagerId: number, dto: OpenAssistantCallDto) {
    const primaryAssignment = await this.prisma.eventManagerAssignment.findFirst({
      where: { eventId, userId: primaryManagerId, managerRole: 'PRIMARY', status: 'ACTIVE' },
    });
    if (!primaryAssignment) {
      throw new ForbiddenException('فقط المدير الرئيسي للمناسبة يمكنه فتح نداء لمدراء مساعدين.');
    }

    const event = await this.prisma.event.update({
      where: { id: eventId },
      data: { assistantManagersNeeded: dto.slotsNeeded },
    });

    await this.prisma.activityLog.create({
      data: {
        userId: primaryManagerId,
        eventId,
        activityType: 'ASSISTANT_MANAGER_CALL_OPENED', // AL-010 (بالمعنى الجديد: فتح نداء وليس دعوة شخص)
        description: `Primary manager opened a call for ${dto.slotsNeeded} assistant manager(s).`,
      },
    });

    return event;
  }

  // -----------------------------------------------------------
  // أي مدير مناسبات معتمد يتصفح المناسبات التي تحتاج مدراء مساعدين حاليًا
  // -----------------------------------------------------------
  async listOpenCalls(userId: number) {
    return this.prisma.event.findMany({
      where: {
        assistantManagersNeeded: { gt: 0 },
        managerAssignments: { none: { userId, status: 'ACTIVE' } }, // لا يرى مناسباته هو نفسه
      },
      select: {
        id: true,
        title: true,
        eventDate: true,
        location: true,
        assistantManagersNeeded: true,
        customer: { select: { firstName: true, lastName: true } },
      },
      orderBy: { eventDate: 'asc' },
    });
  }

  // -----------------------------------------------------------
  // مدير آخر يقرر الانضمام بنفسه (بلا حاجة لموافقة المدير الرئيسي)
  // -----------------------------------------------------------
  async join(eventId: number, managerId: number) {
    return this.prisma.$transaction(async (tx) => {
      // قفل ضمني عبر الشرط في WHERE يمنع الانضمام المزدوج أو تجاوز العدد المطلوب
      const event = await tx.event.findUnique({ where: { id: eventId } });
      if (!event) throw new BadRequestException('المناسبة غير موجودة.');
      if (event.assistantManagersNeeded <= 0) {
        throw new ConflictException('لا توجد شواغر متاحة حاليًا لهذه المناسبة.');
      }

      const alreadyAssigned = await tx.eventManagerAssignment.findFirst({
        where: { eventId, userId: managerId, status: 'ACTIVE' },
      });
      if (alreadyAssigned) {
        throw new ConflictException('أنت مُسنَد بالفعل لهذه المناسبة.');
      }

      const updated = await tx.event.updateMany({
        where: { id: eventId, assistantManagersNeeded: { gt: 0 } },
        data: { assistantManagersNeeded: { decrement: 1 } },
      });
      if (updated.count === 0) {
        // امتلأت الشواغر للتو (Race Condition) بين مديرين انضمّا في نفس اللحظة
        throw new ConflictException('تم شغل آخر شاغر للتو من مدير آخر.');
      }

      await tx.eventManagerAssignment.create({
        data: { eventId, userId: managerId, managerRole: 'ASSISTANT', status: 'ACTIVE', joinedAt: new Date() },
      });

      const primary = await tx.eventManagerAssignment.findFirst({
        where: { eventId, managerRole: 'PRIMARY', status: 'ACTIVE' },
      });

      await tx.assistantManagerRequest.create({
        data: {
          eventId,
          requesterId: primary ? primary.userId : managerId, // المدير الرئيسي (أو نفس المنضم إن تعذّر إيجاده)
          requestedUserId: managerId,
          status: 'APPROVED',
          respondedAt: new Date(),
        },
      });

      await tx.decisionLog.create({
        data: { eventId, decidedBy: managerId, decisionType: 'JOIN_AS_ASSISTANT_MANAGER', decision: 'Joined' },
      });
      await tx.activityLog.create({
        data: { userId: managerId, eventId, activityType: 'ASSISTANT_MANAGER_JOINED' }, // AL-011
      });

      if (primary) {
        await tx.notification.create({
          data: {
            userId: primary.userId,
            type: 'ASSISTANT_MANAGER_JOINED', // NL-008 (بالمعنى الجديد)
            title: 'انضم مدير مساعد جديد',
            message: 'انضم أحد مدراء المناسبات كمدير مساعد لمناسبتك.',
            relatedEntityType: 'EVENT',
            relatedEntityId: eventId,
          },
        });
      }

      return tx.eventManagerAssignment.findFirst({ where: { eventId, userId: managerId } });
    });
  }
}