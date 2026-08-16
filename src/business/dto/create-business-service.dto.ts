import { IsEnum, IsInt, IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';
import { ServiceCategory } from '../../admin/dto/create-service-catalog.dto';

export class CreateBusinessServiceDto {
  // الخيار 1: اربط بخدمة موجودة فعليًا في الكتالوج
  @IsOptional()
  @IsInt()
  serviceId?: number;

  // الخيار 2: لم تجد الخدمة في الكتالوج؟ اكتب اسمًا جديدًا + اختر الفئة، وسيُنشأ تلقائيًا
  @IsOptional()
  @IsString()
  @MinLength(2)
  serviceName?: string;

  @IsOptional()
  @IsEnum(ServiceCategory, {
    message: `category يجب أن تكون إحدى القيم: ${Object.values(ServiceCategory).join(', ')}`,
  })
  category?: ServiceCategory;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  price: number;

  @IsOptional()
  @IsString()
  description?: string;
}