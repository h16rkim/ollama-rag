// src/common/services/stream/stream-handlers.module.ts
import { Module } from '@nestjs/common';
import { ChatStreamHandlerService } from './chat-stream-handler.service';
import { GenerateStreamHandlerService } from './generate-stream-handler.service';
import { StreamHandlerFactory } from './stream-handler.factory';

@Module({
  providers: [
    ChatStreamHandlerService,
    GenerateStreamHandlerService,
    StreamHandlerFactory
  ],
  exports: [
    ChatStreamHandlerService,
    GenerateStreamHandlerService,
    StreamHandlerFactory
  ]
})
export class StreamHandlersModule {}
