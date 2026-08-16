import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class UpdateBusinessServiceDto {
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  price?: number;

  @IsOptional()
  @IsString()
  description?: string;
}