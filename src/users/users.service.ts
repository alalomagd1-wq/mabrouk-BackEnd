import { ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

const SALT_ROUNDS = 10;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  // -----------------------------------------------------------
  // عرض ملفي الشخصي
  // -----------------------------------------------------------
  async getProfile(userId: number) {
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
      },
    });
    if (!user) throw new NotFoundException('المستخدم غير موجود.');
    return user;
  }

  // -----------------------------------------------------------
  // تعديل الاسم/البريد (لا يمكن تعديل role أو accountStatus من هنا إطلاقًا)
  // -----------------------------------------------------------
  async updateProfile(userId: number, dto: UpdateProfileDto) {
    if (dto.email) {
      const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
      if (existing && existing.id !== userId) {
        throw new ConflictException('هذا البريد الإلكتروني مستخدم بالفعل من حساب آخر.');
      }
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.firstName ? { firstName: dto.firstName } : {}),
        ...(dto.lastName ? { lastName: dto.lastName } : {}),
        ...(dto.email ? { email: dto.email } : {}),
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        role: true,
        accountStatus: true,
      },
    });
  }

  // -----------------------------------------------------------
  // تغيير كلمة المرور — يتطلب كلمة المرور الحالية للتأكيد
  // -----------------------------------------------------------
  async changePassword(userId: number, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('المستخدم غير موجود.');

    const matches = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!matches) {
      throw new UnauthorizedException('كلمة المرور الحالية غير صحيحة.');
    }

    const newHash = await bcrypt.hash(dto.newPassword, SALT_ROUNDS);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash: newHash } });

    return { message: 'تم تغيير كلمة المرور بنجاح.' };
  }
}