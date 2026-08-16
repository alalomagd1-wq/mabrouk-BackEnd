import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class CreateEventDto {
  @IsString()
  @MinLength(3)
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsDateString()
  eventDate: string;

  @IsString()
  @MinLength(3)
  location: string;

  // معرّفات BusinessService التي اختارها العميل (كل عنصر = خدمة من منشأة محددة)
  @IsArray()
  @ArrayMinSize(1, { message: 'يجب اختيار خدمة واحدة على الأقل.' })
  @Type(() => Number)
  @IsInt({ each: true })
  businessServiceIds: number[];
}