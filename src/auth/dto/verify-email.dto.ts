import { IsEmail, Matches } from 'class-validator';

export class VerifyEmailDto {
  @IsEmail()
  email: string;

  @Matches(/^\d{6}$/, {
    message: 'يجب أن يتكون رمز التحقق من 6 أرقام.',
  })
  code: string;
}
