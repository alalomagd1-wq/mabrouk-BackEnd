import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomBytes, createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterCustomerDto } from './dto/register-customer.dto';
import { RegisterProfessionalDto } from './dto/register-professional.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

const SALT_ROUNDS = 10;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  // -----------------------------------------------------------
  // تسجيل عميل (Customer) — يُفعَّل الحساب مباشرة، بلا Verification
  // -----------------------------------------------------------
  async registerCustomer(dto: RegisterCustomerDto) {
    await this.ensureEmailIsFree(dto.email);
    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);

    const user = await this.prisma.user.create({
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        email: dto.email,
        passwordHash,
        role: 'CUSTOMER',
        accountStatus: 'APPROVED',
      },
    });

    await this.prisma.activityLog.create({
      data: {
        userId: user.id,
        activityType: 'ACCOUNT_REGISTERED', // راجع Activity_Logs.docx لمطابقة الكود الدقيق (AL-001)
        description: 'Customer account registered and activated automatically.',
      },
    });

    return this.issueToken(user);
  }

  // -----------------------------------------------------------
  // تسجيل حساب احترافي (Event Manager / Service Owner)
  // يبقى Pending Verification حتى مراجعة الإدارة لمستند الهوية
  // -----------------------------------------------------------
  async registerProfessional(dto: RegisterProfessionalDto, documentPath: string) {
    if (!documentPath) {
      throw new ConflictException('يجب رفع مستند إثبات الهوية.');
    }
    await this.ensureEmailIsFree(dto.email);
    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);

    const user = await this.prisma.user.create({
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        email: dto.email,
        passwordHash,
        role: dto.role,
        accountStatus: 'PENDING_VERIFICATION',
      },
    });

    await this.prisma.verificationRequest.create({
      data: {
        userId: user.id,
        documentPath,
        status: 'PENDING',
      },
    });

    await this.prisma.activityLog.create({
      data: {
        userId: user.id,
        activityType: 'ACCOUNT_SUBMITTED_FOR_VERIFICATION', // راجع AL-002
        description: `${dto.role} account submitted for identity verification.`,
      },
    });

    return this.issueToken(user);
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
    if (!passwordMatches) {
      throw new UnauthorizedException('البريد الإلكتروني أو كلمة المرور غير صحيحة.');
    }

    if (user.accountStatus === 'REJECTED') {
      throw new UnauthorizedException('تم رفض هذا الحساب. تواصل مع الإدارة لمزيد من التفاصيل.');
    }

    return this.issueToken(user);
  }

  // -----------------------------------------------------------
  // -----------------------------------------------------------
  // طلب استرجاع كلمة المرور — يولّد token صالح لمدة ساعة
  // ⚠️ TODO قبل الإنتاج: أرسل الـ token بالبريد الإلكتروني الحقيقي، ولا تُعده
  // في استجابة الـ API إطلاقًا كما هو الآن (هذا فقط للتطوير/الاختبار المحلي).
  // -----------------------------------------------------------
  async forgotPassword(dto: ForgotPasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });

    // رسالة عامة سواء وُجد البريد أم لا — لمنع اكتشاف البريد المسجَّل (User Enumeration)
    const genericResponse = { message: 'إن كان هذا البريد مسجّلاً، ستصلك تعليمات إعادة التعيين.' };
    if (!user) return genericResponse;

    const rawToken = randomBytes(32).toString('hex');
    const hashedToken = createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // ساعة واحدة

    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordResetToken: hashedToken, passwordResetExpiresAt: expiresAt },
    });

    return {
      ...genericResponse,
      devOnlyToken: rawToken, // ⚠️ احذف هذا الحقل نهائيًا عند ربط بريد إلكتروني حقيقي
    };
  }

  // -----------------------------------------------------------
  // إتمام إعادة التعيين باستخدام الـ token
  // -----------------------------------------------------------
  async resetPassword(dto: ResetPasswordDto) {
    const hashedToken = createHash('sha256').update(dto.token).digest('hex');

    const user = await this.prisma.user.findFirst({
      where: { 
        AND: [
          { passwordResetToken: hashedToken },
          { passwordResetExpiresAt: { gt: new Date() } }
        ]
      },
    });
    if (!user) {
      throw new BadRequestException('رمز إعادة التعيين غير صالح أو منتهي الصلاحية.');
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, SALT_ROUNDS);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, passwordResetToken: null, passwordResetExpiresAt: null },
    });

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
        email: user.email,
        role: user.role,
        accountStatus: user.accountStatus,
      },
    };
  }
}