import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
export { ServiceCategory } from '../../generated/prisma/enums';
import { ServiceCategory } from '../../generated/prisma/enums';

export class CreateServiceCatalogDto {
  @IsString()
  @MinLength(2)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsEnum(ServiceCategory, {
    message: `category يجب أن تكون إحدى القيم: ${Object.values(ServiceCategory).join(', ')}`,
  })
  category: ServiceCategory;
}