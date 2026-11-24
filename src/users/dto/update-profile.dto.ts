import { IsEmail, IsOptional, IsString, Matches, MinLength } from 'class-validator';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  lastName?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\+?[0-9\s().-]{7,20}$/, {
    message: 'رقم الهاتف غير صالح.',
  })
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;
}