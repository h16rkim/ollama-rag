// src/common/services/stream/base-stream-handler.service.ts
import { Logger } from '@nestjs/common';
import { Response } from 'express';
import { StreamData, StreamSource, StreamProcessor } from '../../types/stream.types';
import { StreamHandlerInterface } from './stream-handler.interface';

export abstract class BaseStreamHandlerService implements StreamHandlerInterface {
  protected readonly logger: Logger;

  constructor(loggerName: string) {
    this.logger = new Logger(loggerName);
  }

  /**
   * 스트림을 처리하는 추상 메서드
   */
  abstract handleStream(stream: StreamSource, res: Response, model: string): void;

  /**
   * SSE 응답을 위한 헤더 설정
   */
  public setupSSEHeaders(res: Response): void {
    res.status(200)
      .setHeader('Content-Type', 'text/event-stream')
      .setHeader('Cache-Control', 'no-cache')
      .setHeader('Connection', 'keep-alive');
  }

  /**
   * SSE 이벤트를 전송합니다.
   */
  protected sendSSEEvent(res: Response, data: unknown): void {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  /**
   * SSE 완료 이벤트를 전송합니다.
   */
  protected sendDoneEvent(res: Response): void {
    res.write(`data: [DONE]\n\n`);
  }

  /**
   * 스트림 종료 처리
   */
  protected handleStreamEnd(
    stream: StreamSource, 
    res: Response, 
    buffer: string, 
    processData: StreamProcessor
  ): void {
    stream.data.on('end', () => {
      // 버퍼에 남은 데이터가 있으면 처리
      if (buffer.trim()) {
        try {
          const data = JSON.parse(buffer) as StreamData;
          processData(data);
        } catch (e) {
          this.logger.error("버퍼 처리 중 오류:", e);
        }
      }
      
      res.end();
    });
  }
}
