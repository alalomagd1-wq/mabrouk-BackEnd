import { IsEmail, IsString, Matches, MinLength } from 'class-validator';

export class RegisterCustomerDto {
  @IsString()
  @MinLength(2)
  firstName: string;

  @IsString()
  @MinLength(2)
  lastName: string;

  @IsString()
  @Matches(/^\+?[0-9\s().-]{7,10}$/, {
    message: 'رقم الهاتف غير صالح.',
  })
  phone: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8, { message: 'كلمة المرور يجب أن تكون 8 أحرف على الأقل' })
  password: string;
}