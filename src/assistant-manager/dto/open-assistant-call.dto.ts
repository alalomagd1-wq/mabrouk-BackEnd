import { IsInt, Min } from 'class-validator';

export class OpenAssistantCallDto {
  @IsInt()
  @Min(1, { message: 'يجب طلب مدير مساعد واحد على الأقل.' })
  slotsNeeded: number;
}