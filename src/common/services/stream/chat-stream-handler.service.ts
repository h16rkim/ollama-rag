// src/common/services/stream/chat-stream-handler.service.ts
import { Injectable } from '@nestjs/common';
import { Response } from 'express';
import { BaseStreamHandlerService } from './base-stream-handler.service';
import { StreamData, StreamSource, StreamProcessor } from '../../types/stream.types';
import { ChatCompletionChunkDto } from '../../dto/response.dto';

@Injectable()
export class ChatStreamHandlerService extends BaseStreamHandlerService {
  constructor() {
    super(ChatStreamHandlerService.name);
  }

  /**
   * 채팅 스트림 응답을 SSE 형식으로 변환하여 전달합니다.
   */
  handleStream(stream: StreamSource, res: Response, model: string): void {
    const responseId = `chatcmpl-${Date.now()}`;
    let buffer = '';
    
    this.setupSSEHeaders(res);
    
    // 채팅 스트림 데이터 핸들러 설정
    stream.data.on('data', (chunk: Buffer) => {
      buffer = this.processStreamChunk(chunk, buffer, res, responseId, model);
    });

    // 채팅 완료 핸들러 설정
    const processData: StreamProcessor = (data) => {
      this.processStreamEnd(data, res, responseId, model);
    };

    this.handleStreamEnd(stream, res, buffer, processData);
  }

  /**
   * 채팅 스트림의 각 청크를 처리합니다.
   */
  private processStreamChunk(
    chunk: Buffer,
    buffer: string,
    res: Response,
    responseId: string,
    model: string
  ): string {
    // 버퍼에 새 데이터 추가
    buffer += chunk.toString();
    
    // 줄바꿈으로 분리하여 각 JSON 객체 처리
    const lines = buffer.split('\n');
    
    // 마지막 줄은 완전한 JSON이 아닐 수 있으므로 버퍼에 남김
    const remainingBuffer = lines.pop() || '';
    
    for (const line of lines) {
      if (!line.trim()) continue;
      
      try {
        const data = JSON.parse(line) as StreamData;
        this.sendCompletionChunk(data, res, responseId, model);
      } catch (parseError) {
        this.logger.error("JSON 파싱 오류:", parseError, "원본 데이터:", line);
      }
    }
    
    return remainingBuffer;
  }

  /**
   * 단일 채팅 완료 청크를 전송합니다.
   */
  private sendCompletionChunk(
    data: StreamData,
    res: Response,
    responseId: string,
    model: string
  ): void {
    // 메시지 내용 추출
    const content = data.message?.content || '';
    
    if (content) {
      // OpenAI 형식으로 SSE 이벤트 구성
      const eventData = new ChatCompletionChunkDto(responseId, model, content);
      
      // SSE 형식으로 전송
      this.sendSSEEvent(res, eventData.toJSON());
    }
    
    // 완료 신호가 있는 경우
    if (data.done) {
      this.sendCompletionFinalChunk(res, responseId, model);
    }
  }

  /**
   * 채팅 완료의 최종 청크를 전송합니다.
   */
  private sendCompletionFinalChunk(res: Response, responseId: string, model: string): void {
    // 완료 메시지 전송
    const finalChunk = new ChatCompletionChunkDto(responseId, model, undefined, "stop");
    
    this.sendSSEEvent(res, finalChunk.toJSON());
    this.sendDoneEvent(res);
  }

  /**
   * 채팅 스트림 종료 시 처리합니다.
   */
  private processStreamEnd(
    data: StreamData,
    res: Response,
    responseId: string,
    model: string
  ): void {
    if (data.message?.content) {
      const eventData = new ChatCompletionChunkDto(responseId, model, data.message.content);
      this.sendSSEEvent(res, eventData.toJSON());
    }
    
    if (data.done) {
      this.sendCompletionFinalChunk(res, responseId, model);
    }
  }
}
