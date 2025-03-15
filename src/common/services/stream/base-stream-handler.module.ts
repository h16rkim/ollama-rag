// src/common/services/stream/base-stream-handler.module.ts
import { Module, Provider } from '@nestjs/common';
import { BaseStreamHandlerService } from './base-stream-handler.service';
import { ChatStreamHandlerService } from './chat-stream-handler.service';
import { PROVIDER_TOKENS } from '../../constants/provider-tokens.constants';

const baseStreamHandlerProvider: Provider = {
  provide: PROVIDER_TOKENS.BASE_STREAM_HANDLER,
  useExisting: ChatStreamHandlerService
};

@Module({
  providers: [ChatStreamHandlerService, baseStreamHandlerProvider],
  exports: [ChatStreamHandlerService, baseStreamHandlerProvider]
})
export class StreamHandlerModule {}
