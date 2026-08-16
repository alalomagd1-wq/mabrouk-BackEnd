import { IsInt, IsString, MinLength } from 'class-validator';

export class ReplaceServiceOwnerDto {
  @IsInt()
  newBusinessServiceId: number;

  @IsString()
  @MinLength(5, { message: 'يجب كتابة سبب الاستبدال (5 أحرف على الأقل).' })
  reason: string;
}