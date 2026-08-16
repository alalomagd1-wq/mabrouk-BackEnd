import { IsOptional, IsString, MinLength } from 'class-validator';

export class CreateBusinessDto {
  @IsString()
  @MinLength(2)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsString()
  @MinLength(6)
  phone: string;

  @IsString()
  @MinLength(3)
  address: string;
}