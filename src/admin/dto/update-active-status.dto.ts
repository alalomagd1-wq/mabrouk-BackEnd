import { IsIn } from 'class-validator';

export class UpdateActiveStatusDto {
  @IsIn(['ACTIVE', 'INACTIVE'], { message: 'status يجب أن تكون ACTIVE أو INACTIVE.' })
  status: 'ACTIVE' | 'INACTIVE';
}