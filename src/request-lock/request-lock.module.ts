import { Global, Module } from '@nestjs/common';
import { RequestLockService } from './request-lock.service';

@Global()
@Module({
  providers: [RequestLockService],
  exports: [RequestLockService],
})
export class RequestLockModule {}