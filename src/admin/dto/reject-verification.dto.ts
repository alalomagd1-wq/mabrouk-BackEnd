import { IsString, MinLength } from 'class-validator';

export class RejectVerificationDto {
  @IsString()
  @MinLength(5, { message: 'سبب الرفض يجب أن يكون 5 أحرف على الأقل.' })
  reason: string;
}