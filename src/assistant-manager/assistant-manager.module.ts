import { Module } from '@nestjs/common';
import { AssistantManagerController } from './assistant-manager.controller';
import { AssistantManagerService } from './assistant-manager.service';

@Module({
  controllers: [AssistantManagerController],
  providers: [AssistantManagerService],
})
export class AssistantManagerModule {}