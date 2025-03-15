// src/common/services/stream/stream-handlers.module.ts
import { Module } from '@nestjs/common';
import { ChatStreamHandlerService } from './chat-stream-handler.service';
import { GenerateStreamHandlerService } from './generate-stream-handler.service';
import { StreamHandlerFactoryService } from './stream-handler-factory.service';

@Module({
  providers: [
    ChatStreamHandlerService,
    GenerateStreamHandlerService,
    StreamHandlerFactoryService
  ],
  exports: [
    ChatStreamHandlerService,
    GenerateStreamHandlerService,
    StreamHandlerFactoryService
  ]
})
export class StreamHandlersModule {}
