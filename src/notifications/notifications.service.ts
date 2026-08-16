import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  // -----------------------------------------------------------
  // كل إشعارات المستخدم الحالي (الأحدث أولاً) — NR-002: لا تُحذف تلقائيًا أبدًا
  // -----------------------------------------------------------
  async listMine(userId: number) {
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  // -----------------------------------------------------------
  // عدد الإشعارات غير المقروءة (مفيد لعرض Badge في الواجهة)
  // -----------------------------------------------------------
  async unreadCount(userId: number) {
    const count = await this.prisma.notification.count({ where: { userId, isRead: false } });
    return { count };
  }

  // -----------------------------------------------------------
  // تعليم إشعار واحد كمقروء (NR-003)
  // -----------------------------------------------------------
  async markAsRead(notificationId: number, userId: number) {
    const notification = await this.prisma.notification.findUnique({ where: { id: notificationId } });
    if (!notification) throw new NotFoundException('الإشعار غير موجود.');
    if (notification.userId !== userId) {
      throw new ForbiddenException('لا تملك صلاحية على هذا الإشعار.');
    }
    return this.prisma.notification.update({
      where: { id: notificationId },
      data: { isRead: true },
    });
  }

  // -----------------------------------------------------------
  // تعليم كل إشعارات المستخدم كمقروءة دفعة واحدة
  // -----------------------------------------------------------
  async markAllAsRead(userId: number) {
    const result = await this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });
    return { updated: result.count };
  }
}