import { ConflictException, Injectable, Logger } from '@nestjs/common';

interface LockEntry {
  expiresAt: number;
  timeout: NodeJS.Timeout;
}

/**
 * خدمة أقفال في الذاكرة (In-Memory) لمنع تنفيذ نفس العملية الحساسة أكثر
 * من مرة بالتزامن (Request Locking).
 *
 * ⚠️ هذه الخدمة طبقة حماية إضافية بجانب Database Transactions وValidation،
 * وليست بديلاً عنها. راجع 07_Architecture_Decision_Records للتفاصيل الكاملة.
 *
 * ⚠️ قيد معماري مهم: هذا التصميم In-Memory يعمل بشكل صحيح فقط طالما أن
 * الـ Backend يعمل كسيرفر واحد (نسخة واحدة/Instance). عند التوسع لاحقًا
 * لعدة سيرفرات (Horizontal Scaling)، يجب استبدال هذا التنفيذ بـ Redis
 * (نفس الواجهة الخارجية acquire/release/executeWithLock تبقى كما هي،
 * فقط التنفيذ الداخلي يتغيّر — لن تحتاج لتعديل أي Service آخر يستخدمها).
 */
@Injectable()
export class RequestLockService {
  private readonly logger = new Logger(RequestLockService.name);
  private readonly locks = new Map<string, LockEntry>();

  private static readonly DEFAULT_TTL_MS = 30_000; // 30 ثانية كحماية احتياطية فقط

  /**
   * يحاول الحصول على قفل لمفتاح معيّن. يعيد true إن نجح، false إن كان مقفلاً بالفعل.
   */
  acquire(key: string, ttlMs: number = RequestLockService.DEFAULT_TTL_MS): boolean {
    const existing = this.locks.get(key);
    if (existing && existing.expiresAt > Date.now()) {
      return false; // مقفل بالفعل من طلب سابق لم ينتهِ بعد
    }

    // قفل منتهي الصلاحية (Timeout) أو غير موجود أصلاً — نظّف القديم إن وُجد وأنشئ جديدًا
    if (existing) {
      clearTimeout(existing.timeout);
    }

    const timeout = setTimeout(() => {
      // شبكة أمان: لو لم يُحرَّر القفل يدويًا لأي سبب (تعطّل غير متوقع)، يُحرَّر تلقائيًا هنا
      this.locks.delete(key);
      this.logger.warn(`Lock "${key}" expired via TTL fallback (was not released manually).`);
    }, ttlMs);

    this.locks.set(key, { expiresAt: Date.now() + ttlMs, timeout });
    return true;
  }

  /**
   * يحرّر القفل فورًا (يُستدعى عند نجاح العملية أو فشلها — وليس عند انتهاء TTL فقط)
   */
  release(key: string): void {
    const existing = this.locks.get(key);
    if (existing) {
      clearTimeout(existing.timeout);
      this.locks.delete(key);
    }
  }

  isLocked(key: string): boolean {
    const existing = this.locks.get(key);
    return !!existing && existing.expiresAt > Date.now();
  }

  /**
   * الطريقة الموصى بها للاستخدام: تحصل على القفل، تنفّذ العملية، ثم تحرّر القفل
   * دائمًا (نجاحًا أو فشلًا) عبر finally. ترمي 409 Conflict إن كانت العملية
   * قيد التنفيذ بالفعل.
   */
  async executeWithLock<T>(
    key: string,
    fn: () => Promise<T>,
    ttlMs: number = RequestLockService.DEFAULT_TTL_MS,
  ): Promise<T> {
    const acquired = this.acquire(key, ttlMs);
    if (!acquired) {
      throw new ConflictException('هذه العملية قيد التنفيذ بالفعل، الرجاء الانتظار قبل إعادة المحاولة.');
    }

    try {
      return await fn();
    } finally {
      this.release(key);
    }
  }
}