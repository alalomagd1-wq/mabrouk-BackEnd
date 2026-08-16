import { IsEmail, IsIn, IsString, MinLength } from 'class-validator';

export class RegisterProfessionalDto {
  @IsString()
  @MinLength(2)
  firstName: string;

  @IsString()
  @MinLength(2)
  lastName: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8, { message: 'كلمة المرور يجب أن تكون 8 أحرف على الأقل' })
  password: string;

  // فقط هذان الدوران يمرّان بمسار التحقق (Pending Verification)
  @IsIn(['EVENT_MANAGER', 'SERVICE_OWNER'], {
    message: 'role يجب أن يكون EVENT_MANAGER أو SERVICE_OWNER فقط',
  })
  role: 'EVENT_MANAGER' | 'SERVICE_OWNER';
}