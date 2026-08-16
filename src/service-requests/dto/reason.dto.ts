import { IsString, MinLength } from 'class-validator';

export class ReasonDto {
  @IsString()
  @MinLength(5, { message: 'يجب كتابة سبب لا يقل عن 5 أحرف.' })
  reason: string;
}