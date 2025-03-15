import { Injectable } from '@nestjs/common';
import { StreamHandlerInterface } from './stream-handler.interface';
import { ChatStreamHandlerService } from './chat-stream-handler.service';
import { GenerateStreamHandlerService } from './generate-stream-handler.service';

export enum StreamType {
  CHAT = 'chat',
  GENERATE = 'generate'
}

@Injectable()
export class StreamHandlerFactory {
  constructor(
    private readonly chatStreamHandler: ChatStreamHandlerService,
    private readonly generateStreamHandler: GenerateStreamHandlerService
  ) {}

  /**
   * 스트림 타입에 따라 적절한 핸들러를 반환합니다.
   */
  getHandler(type: StreamType): StreamHandlerInterface {
    switch (type) {
      case StreamType.CHAT:
        return this.chatStreamHandler;
      case StreamType.GENERATE:
        return this.generateStreamHandler;
      default:
        throw new Error(`지원하지 않는 스트림 타입: ${type}`);
    }
  }
}
