// src/common/services/stream/stream-handlers.module.ts
import { Module, Provider } from '@nestjs/common';
import { ChatStreamHandlerService } from './chat-stream-handler.service';
import { GenerateStreamHandlerService } from './generate-stream-handler.service';
import { StreamHandlerFactory } from './stream-handler.factory';
import { PROVIDER_TOKENS } from '../../constants/provider-tokens.constants';

const baseStreamHandlerProvider: Provider = {
  provide: PROVIDER_TOKENS.BASE_STREAM_HANDLER,
  useExisting: ChatStreamHandlerService
};

@Module({
  providers: [
    ChatStreamHandlerService,
    GenerateStreamHandlerService,
    StreamHandlerFactory,
    baseStreamHandlerProvider
  ],
  exports: [
    ChatStreamHandlerService,
    GenerateStreamHandlerService,
    StreamHandlerFactory,
    baseStreamHandlerProvider
  ]
})
export class StreamHandlersModule {}
