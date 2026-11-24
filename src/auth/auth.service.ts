import {
  BadRequestException,
  Injectable,
  ConflictException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomInt } from 'crypto';
import { unlink } from 'fs/promises';
import { basename, join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterCustomerDto } from './dto/register-customer.dto';
import { RegisterProfessionalDto } from './dto/register-professional.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { EmailService } from '../email/email.service';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { ResendVerificationEmailDto } from './dto/resend-verification-email.dto';

const SALT_ROUNDS = 10;
const EMAIL_VERIFICATION_TTL_MS = 10 * 60 * 1000;
const EMAIL_VERIFICATION_RESEND_COOLDOWN_MS = 60 * 1000;
const EMAIL_VERIFICATION_RESEND_WINDOW_MS = 24 * 60 * 60 * 1000;
const EMAIL_VERIFICATION_MAX_RESENDS_PER_WINDOW = 5;
const EMAIL_VERIFICATION_MAX_ATTEMPTS = 5;
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;
const PASSWORD_RESET_MAX_ATTEMPTS = 5;
const GENERIC_VERIFICATION_RESPONSE = {
  message: 'إذا كانت البيانات صالحة، ستصلك رسالة لتأكيد البريد الإلكتروني.',
  verificationRequired: true,
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly emailService: EmailService,
  ) {}

  // -----------------------------------------------------------
  // إنشاء طلب تسجيل عميل بانتظار تأكيد البريد
  // -----------------------------------------------------------
  async registerCustomer(dto: RegisterCustomerDto) {
    return this.createPendingRegistration({
      ...dto,
      role: 'CUSTOMER',
    });
  }

  // -----------------------------------------------------------
  // إنشاء طلب تسجيل احترافي بانتظار تأكيد البريد ومراجعة الإدارة
  // -----------------------------------------------------------
  async registerProfessional(
    dto: RegisterProfessionalDto,
    documents: {
      identityFrontPath: string;
      identityBackPath: string;
      businessFrontPath?: string;
    },
  ) {
    if (!documents.identityFrontPath || !documents.identityBackPath) {
      throw new BadRequestException(
        'يجب رفع صورتي الوجه الأمامي والخلفي للهوية الشخصية.',
      );
    }
    if (dto.role === 'SERVICE_OWNER' && !documents.businessFrontPath) {
      throw new BadRequestException(
        'يجب رفع صورة الواجهة الأمامية للمنشأة أو المتجر أو الصالة.',
      );
    }
    return this.createPendingRegistration({
      ...dto,
      identityFrontPath: documents.identityFrontPath,
      identityBackPath: documents.identityBackPath,
      businessFrontPath: documents.businessFrontPath,
    });
  }

  // -----------------------------------------------------------
  // تسجيل الدخول — مسموح حتى أثناء Pending Verification،
  // ممنوع فقط إن كان الحساب Rejected
  // -----------------------------------------------------------
  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (!user) {
      throw new UnauthorizedException('البريد الإلكتروني أو كلمة المرور غير صحيحة.');
    }

    const passwordMatches = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordMatches || user.emailVerifiedAt === null) {
      throw new UnauthorizedException('البريد الإلكتروني أو كلمة المرور غير صحيحة.');
    }

    if (user.accountStatus === 'REJECTED') {
      throw new UnauthorizedException('تم رفض هذا الحساب. تواصل مع الإدارة لمزيد من التفاصيل.');
    }

    return this.issueToken(user);
  }

  async verifyEmail(dto: VerifyEmailDto) {
    await this.cleanupExpiredPendingRegistrations();
    const now = new Date();
    const pending = await this.prisma.pendingRegistration.findUnique({
      where: { email: dto.email },
    });
    if (
      !pending ||
      pending.expiresAt <= now ||
      pending.verificationAttempts >= EMAIL_VERIFICATION_MAX_ATTEMPTS
    ) {
      throw new BadRequestException('رمز التحقق غير صالح أو منتهي الصلاحية.');
    }

    const attempt = await this.prisma.pendingRegistration.updateMany({
      where: {
        id: pending.id,
        verificationTokenHash: pending.verificationTokenHash,
        expiresAt: { gt: now },
        verificationAttempts: { lt: EMAIL_VERIFICATION_MAX_ATTEMPTS },
      },
      data: { verificationAttempts: { increment: 1 } },
    });
    if (attempt.count !== 1) {
      throw new BadRequestException('رمز التحقق غير صالح أو منتهي الصلاحية.');
    }

    const codeMatches =
      pending.verificationTokenHash.startsWith('$2') &&
      (await bcrypt.compare(dto.code, pending.verificationTokenHash));
    if (!codeMatches) {
      throw new BadRequestException('رمز التحقق غير صالح أو منتهي الصلاحية.');
    }

    try {
      const user = await this.prisma.$transaction(async (tx) => {
        const consumed = await tx.pendingRegistration.deleteMany({
          where: {
            id: pending.id,
            verificationTokenHash: pending.verificationTokenHash,
            expiresAt: { gt: now },
            verificationAttempts: { lte: EMAIL_VERIFICATION_MAX_ATTEMPTS },
          },
        });
        if (consumed.count !== 1) {
          throw new BadRequestException('رمز التحقق غير صالح أو منتهي الصلاحية.');
        }

        const customer = pending.role === 'CUSTOMER';
        const createdUser = await tx.user.create({
          data: {
            firstName: pending.firstName,
            lastName: pending.lastName,
            phone: pending.phone,
            email: pending.email,
            passwordHash: pending.passwordHash,
            role: pending.role,
            accountStatus: customer ? 'APPROVED' : 'PENDING_VERIFICATION',
            emailVerifiedAt: now,
          },
        });

        if (customer) {
          await tx.activityLog.create({
            data: {
              userId: createdUser.id,
              activityType: 'ACCOUNT_REGISTERED',
              description: 'Customer account registered and email verified.',
            },
          });
        } else {
          await tx.verificationRequest.create({
            data: {
              userId: createdUser.id,
              documentPath: pending.identityFrontPath!,
              identityFrontPath: pending.identityFrontPath,
              identityBackPath: pending.identityBackPath,
              businessFrontPath:
                pending.role === 'SERVICE_OWNER' ? pending.businessFrontPath : null,
              status: 'PENDING',
            },
          });
          await tx.activityLog.create({
            data: {
              userId: createdUser.id,
              activityType: 'ACCOUNT_SUBMITTED_FOR_VERIFICATION',
              description: `${pending.role} account submitted for identity verification.`,
            },
          });
        }

        return createdUser;
      });

      if (user.role === 'CUSTOMER') {
        return {
          message: 'تم تأكيد البريد الإلكتروني وإنشاء الحساب بنجاح.',
          ...this.issueToken(user),
        };
      }
      return {
        message: 'تم تأكيد البريد الإلكتروني. حسابك بانتظار مراجعة الإدارة.',
        accountStatus: user.accountStatus,
      };
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException('تعذر إكمال التسجيل بهذا البريد الإلكتروني.');
      }
      throw error;
    }
  }

  async resendVerificationEmail(dto: ResendVerificationEmailDto) {
    await this.cleanupExpiredPendingRegistrations();
    const pending = await this.prisma.pendingRegistration.findUnique({
      where: { email: dto.email },
    });
    if (!pending) return GENERIC_VERIFICATION_RESPONSE;

    const now = new Date();
    const startingNewWindow =
      pending.resendWindowStartedAt.getTime() <=
      now.getTime() - EMAIL_VERIFICATION_RESEND_WINDOW_MS;
    const windowStartedAt = startingNewWindow
      ? now
      : pending.resendWindowStartedAt;
    if (
      !startingNewWindow &&
      pending.resendCount >= EMAIL_VERIFICATION_MAX_RESENDS_PER_WINDOW
    ) {
      return GENERIC_VERIFICATION_RESPONSE;
    }
    const code = this.generateVerificationCode();
    const tokenHash = await bcrypt.hash(code, SALT_ROUNDS);
    const updated = await this.prisma.pendingRegistration.updateMany({
      where: {
        id: pending.id,
        verificationTokenHash: pending.verificationTokenHash,
        resendAvailableAt: { lte: now },
        resendWindowStartedAt: pending.resendWindowStartedAt,
        resendCount: pending.resendCount,
      },
      data: {
        verificationTokenHash: tokenHash,
        expiresAt: new Date(now.getTime() + EMAIL_VERIFICATION_TTL_MS),
        verificationAttempts: 0,
        resendAvailableAt: new Date(
          now.getTime() + EMAIL_VERIFICATION_RESEND_COOLDOWN_MS,
        ),
        resendWindowStartedAt: windowStartedAt,
        resendCount: startingNewWindow ? 1 : { increment: 1 },
      },
    });
    if (updated.count !== 1) return GENERIC_VERIFICATION_RESPONSE;

    await this.deliverVerificationEmail(pending.email, code);
    return GENERIC_VERIFICATION_RESPONSE;
  }

  private async createPendingRegistration(input: {
    firstName: string;
    lastName: string;
    phone: string;
    email: string;
    password: string;
    role: 'CUSTOMER' | 'EVENT_MANAGER' | 'SERVICE_OWNER';
    identityFrontPath?: string;
    identityBackPath?: string;
    businessFrontPath?: string;
  }) {
    if (
      input.role !== 'CUSTOMER' &&
      (!input.identityFrontPath || !input.identityBackPath)
    ) {
      throw new BadRequestException(
        'يجب رفع صورتي الوجه الأمامي والخلفي للهوية الشخصية.',
      );
    }
    if (input.role === 'SERVICE_OWNER' && !input.businessFrontPath) {
      throw new BadRequestException(
        'يجب رفع صورة الواجهة الأمامية للمنشأة أو المتجر أو الصالة.',
      );
    }

    await this.cleanupExpiredPendingRegistrations();
    await this.ensureEmailIsFree(input.email);
    const passwordHash = await bcrypt.hash(input.password, SALT_ROUNDS);
    const code = this.generateVerificationCode();
    const tokenHash = await bcrypt.hash(code, SALT_ROUNDS);
    const now = new Date();

    try {
      await this.prisma.pendingRegistration.create({
        data: {
          firstName: input.firstName,
          lastName: input.lastName,
          phone: input.phone,
          email: input.email,
          passwordHash,
          role: input.role,
          identityFrontPath: input.identityFrontPath,
          identityBackPath: input.identityBackPath,
          businessFrontPath: input.businessFrontPath,
          verificationTokenHash: tokenHash,
          expiresAt: new Date(now.getTime() + EMAIL_VERIFICATION_TTL_MS),
          verificationAttempts: 0,
          resendAvailableAt: new Date(
            now.getTime() + EMAIL_VERIFICATION_RESEND_COOLDOWN_MS,
          ),
        },
      });
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException(
          'يوجد حساب أو طلب تسجيل بهذا البريد الإلكتروني.',
        );
      }
      throw error;
    }

    await this.deliverVerificationEmail(input.email, code);
    return GENERIC_VERIFICATION_RESPONSE;
  }

  private generateVerificationCode(): string {
    return randomInt(0, 1_000_000).toString().padStart(6, '0');
  }

  private async deliverVerificationEmail(email: string, code: string) {
    try {
      await this.emailService.sendVerificationEmail(email, code);
    } catch (error) {
      const getErrorCode = (key: 'responseCode' | 'code') => {
        if (typeof error !== 'object' || error === null || !(key in error)) {
          return undefined;
        }
        const value = error[key];
        return typeof value === 'string' || typeof value === 'number'
          ? value
          : undefined;
      };

      this.logger.warn(
        JSON.stringify({
          event: 'registration_verification_email_failed',
          phase: 'email_delivery',
          errorType: error instanceof Error ? error.name : typeof error,
          smtpCode: getErrorCode('responseCode') ?? getErrorCode('code') ?? null,
        }),
      );
    }
  }

  private async cleanupExpiredPendingRegistrations() {
    const expired = await this.prisma.pendingRegistration.findMany({
      where: { expiresAt: { lte: new Date() } },
      select: {
        id: true,
        expiresAt: true,
        verificationTokenHash: true,
        identityFrontPath: true,
        identityBackPath: true,
        businessFrontPath: true,
      },
    });

    for (const registration of expired) {
      const deleted = await this.prisma.pendingRegistration.deleteMany({
        where: {
          id: registration.id,
          expiresAt: registration.expiresAt,
          verificationTokenHash: registration.verificationTokenHash,
        },
      });
      if (deleted.count === 1) {
        await this.removePendingDocuments([
          registration.identityFrontPath,
          registration.identityBackPath,
          registration.businessFrontPath,
        ]);
      }
    }
  }

  private async removePendingDocuments(paths: Array<string | null>) {
    const uploadDirectory = join(
      process.cwd(),
      'uploads',
      'verification-documents',
    );
    for (const path of paths) {
      if (!path) continue;
      const prefix = 'verification-documents/';
      const filename = path.startsWith(prefix) ? path.slice(prefix.length) : '';
      if (
        !filename ||
        basename(filename) !== filename ||
        !/^[a-f0-9-]{36}\.(?:jpg|jpeg|png)$/i.test(filename)
      ) {
        throw new Error('Invalid pending registration document path.');
      }

      try {
        await unlink(join(uploadDirectory, filename));
      } catch (error) {
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          error.code === 'ENOENT'
        ) {
          continue;
        }
        throw error;
      }
    }
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'P2002'
    );
  }

  // -----------------------------------------------------------
  // -----------------------------------------------------------
  // طلب استرجاع كلمة المرور — يُرسل رمزًا صالحًا لمدة ساعة.
  // -----------------------------------------------------------
  async forgotPassword(dto: ForgotPasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });

    // رسالة عامة سواء وُجد البريد أم لا — لمنع اكتشاف البريد المسجَّل (User Enumeration)
    const genericResponse = { message: 'إن كان هذا البريد مسجّلاً، ستصلك تعليمات إعادة التعيين.' };
    if (!user) return genericResponse;

    const code = this.generateVerificationCode();
    const hashedCode = await bcrypt.hash(code, SALT_ROUNDS);
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordResetToken: hashedCode,
        passwordResetExpiresAt: expiresAt,
        passwordResetAttempts: 0,
      },
    });

    try {
      await this.emailService.sendEmail({
        to: user.email,
        subject: 'إعادة تعيين كلمة المرور - مبروك',
        text: [
          'وصلنا طلب لإعادة تعيين كلمة المرور لحسابك في مبروك.',
          `رمز إعادة التعيين الخاص بك هو: ${code}`,
          'أدخل الرمز في طلب إعادة تعيين كلمة المرور خلال ساعة واحدة.',
          'إذا لم تطلب إعادة التعيين، يمكنك تجاهل هذه الرسالة.',
        ].join('\n\n'),
        html: `
          <div dir="rtl" lang="ar" style="margin:0;background:#6D1833;padding:32px 16px;font-family:Arial,sans-serif;color:#fff">
            <div style="max-width:560px;margin:auto;background:#6D1833;border:1px solid #9A5368;border-radius:12px;padding:28px">
              <h1 style="margin-top:0;color:#fff">إعادة تعيين كلمة المرور</h1>
              <p style="color:#fff;line-height:1.8">وصلنا طلب لإعادة تعيين كلمة المرور لحسابك في مبروك. أدخل الرمز التالي في طلب إعادة التعيين:</p>
              <div dir="ltr" style="margin:24px 0;padding:18px;background:#521127;border:1px solid #9A5368;border-radius:8px;text-align:center">
                <span style="color:#C6A667;font-size:36px;font-weight:bold;letter-spacing:8px;font-family:Arial,sans-serif">${code}</span>
              </div>
              <p style="color:#fff;line-height:1.8">الرمز صالح لمدة ساعة واحدة، ويمكن استخدامه مرة واحدة فقط. بعد 5 محاولات غير صحيحة اطلب رمزًا جديدًا.</p>
              <p style="color:#fff;line-height:1.8">إذا لم تطلب إعادة التعيين، يمكنك تجاهل هذه الرسالة.</p>
            </div>
          </div>
        `,
      });
    } catch (error) {
      let smtpCode: string | number | null = null;
      if (typeof error === 'object' && error !== null) {
        if ('responseCode' in error && typeof error.responseCode === 'number') {
          smtpCode = error.responseCode;
        } else if (
          'code' in error &&
          typeof error.code === 'string' &&
          /^[A-Z0-9_-]{1,32}$/.test(error.code)
        ) {
          smtpCode = error.code;
        }
      }

      this.logger.warn(
        JSON.stringify({
          event: 'password_reset_email_failed',
          phase: 'email_delivery',
          errorType: error instanceof Error ? error.name : typeof error,
          smtpCode,
        }),
      );
    }

    return genericResponse;
  }

  // -----------------------------------------------------------
  // إتمام إعادة التعيين باستخدام الرمز
  // -----------------------------------------------------------
  async resetPassword(dto: ResetPasswordDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    const now = new Date();
    if (
      !user?.passwordResetToken ||
      !user.passwordResetExpiresAt ||
      user.passwordResetExpiresAt <= now ||
      user.passwordResetAttempts >= PASSWORD_RESET_MAX_ATTEMPTS
    ) {
      throw new BadRequestException('رمز إعادة التعيين غير صالح أو منتهي الصلاحية.');
    }

    const attempt = await this.prisma.user.updateMany({
      where: {
        id: user.id,
        passwordResetToken: user.passwordResetToken,
        passwordResetExpiresAt: { gt: now },
        passwordResetAttempts: { lt: PASSWORD_RESET_MAX_ATTEMPTS },
      },
      data: { passwordResetAttempts: { increment: 1 } },
    });
    if (attempt.count !== 1) {
      throw new BadRequestException('رمز إعادة التعيين غير صالح أو منتهي الصلاحية.');
    }

    if (!(await bcrypt.compare(dto.code, user.passwordResetToken))) {
      throw new BadRequestException('رمز إعادة التعيين غير صالح أو منتهي الصلاحية.');
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, SALT_ROUNDS);
    const result = await this.prisma.user.updateMany({
      where: {
        id: user.id,
        passwordResetToken: user.passwordResetToken,
        passwordResetExpiresAt: { gt: now },
        passwordResetAttempts: { lte: PASSWORD_RESET_MAX_ATTEMPTS },
      },
      data: {
        passwordHash,
        passwordResetToken: null,
        passwordResetExpiresAt: null,
        passwordResetAttempts: 0,
      },
    });
    if (result.count !== 1) {
      throw new BadRequestException('رمز إعادة التعيين غير صالح أو منتهي الصلاحية.');
    }

    return { message: 'تم تغيير كلمة المرور بنجاح. يمكنك تسجيل الدخول الآن.' };
  }

  // -----------------------------------------------------------
  private async ensureEmailIsFree(email: string) {
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('هذا البريد الإلكتروني مستخدم بالفعل.');
    }
  }

  private issueToken(user: {
    id: number;
    email: string;
    role: string;
    accountStatus: string;
    firstName: string;
    lastName: string;
    phone: string | null;
  }) {
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      accountStatus: user.accountStatus,
    };

    return {
      accessToken: this.jwtService.sign(payload),
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        phone: user.phone,
        email: user.email,
        role: user.role,
        accountStatus: user.accountStatus,
      },
    };
  }
}