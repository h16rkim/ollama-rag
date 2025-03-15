// src/common/services/response-handler.service.ts
import { Injectable } from '@nestjs/common';
import { Response } from 'express';
import { StreamSource } from '../types/stream.types';
import { StreamHandlerFactoryService, StreamType } from './stream/stream-handler-factory.service';

@Injectable()
export class ResponseHandlerService {
  constructor(
    private readonly streamHandlerFactory: StreamHandlerFactoryService
  ) {}

  /**
   * 채팅 스트림 응답을 SSE 형식으로 변환하여 전달합니다.
   */
  handleChatStreamAsSSE(stream: StreamSource, res: Response, model: string): void {
    const handler = this.streamHandlerFactory.getHandler(StreamType.CHAT);
    handler.handleStream(stream, res, model);
  }

  /**
   * Generate API 스트림 응답을 SSE 형식으로 변환하여 전달합니다.
   */
  handleGenerateStreamAsSSE(stream: StreamSource, res: Response, model: string): void {
    const handler = this.streamHandlerFactory.getHandler(StreamType.GENERATE);
    handler.handleStream(stream, res, model);
  }
}
