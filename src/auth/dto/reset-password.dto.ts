import { IsEmail, IsString, Matches, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @IsEmail()
  email: string;

  @IsString()
  @Matches(/^\d{6}$/, {
    message: 'يجب أن يتكون رمز إعادة التعيين من 6 أرقام.',
  })
  code: string;

  @IsString()
  @MinLength(8, { message: 'كلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل.' })
  newPassword: string;
}