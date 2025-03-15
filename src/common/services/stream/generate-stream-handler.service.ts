// src/common/services/stream/generate-stream-handler.service.ts
import { Injectable } from '@nestjs/common';
import { Response } from 'express';
import { BaseStreamHandlerService } from './base-stream-handler.service';
import { StreamData, StreamSource, StreamProcessor, StreamErrorResponse } from '../../types/stream.types';
import { TextCompletionChunkDto } from '../../dto/response.dto';
import { extractCodeContent } from '../../utils/string-utils';
import { TextCompletionChunkResponse } from '../../types/response.types';

@Injectable()
export class GenerateStreamHandlerService extends BaseStreamHandlerService {
  constructor() {
    super(GenerateStreamHandlerService.name);
  }

  /**
   * Generate API 스트림 응답을 SSE 형식으로 변환하여 전달합니다.
   */
  handleStream(stream: StreamSource, res: Response, model: string): void {
    const responseId = `cmpl-${Date.now()}`;
    let buffer = '';
    let fullResponse = '';
    
    this.setupSSEHeaders(res);
    
    // Generate 스트림 데이터 핸들러 설정
    stream.data.on('data', (chunk: Buffer) => {
      const result = this.processStreamChunk(chunk, buffer, fullResponse, res, responseId, model);
      buffer = result.buffer;
      fullResponse = result.fullResponse;
    });

    // Generate 완료 핸들러 설정
    const processData: StreamProcessor = (data) => {
      this.processStreamEnd(data, res, responseId, model, fullResponse);
    };

    this.handleStreamEnd(stream, res, buffer, processData);
    
    // 오류 처리
    stream.data.on('error', (error: Error) => {
      this.handleStreamError(error, res, responseId, model);
    });
  }

  /**
   * Generate 스트림의 각 청크를 처리합니다.
   */
  private processStreamChunk(
    chunk: Buffer,
    buffer: string,
    fullResponse: string,
    res: Response,
    responseId: string,
    model: string
  ): { buffer: string; fullResponse: string } {
    // 버퍼에 새 데이터 추가
    const chunkStr = chunk.toString();
    buffer += chunkStr;
    
    // 디버깅을 위한 로그 추가
    this.logger.debug(`받은 청크: ${chunkStr}`);
    
    // 줄바꿈으로 분리하여 각 JSON 객체 처리
    const lines = buffer.split('\n');
    
    // 마지막 줄은 완전한 JSON이 아닐 수 있으므로 버퍼에 남김
    const remainingBuffer = lines.pop() || '';
    
    for (const line of lines) {
      if (!line.trim()) continue;
      
      try {
        const data = JSON.parse(line) as StreamData;
        fullResponse = this.processDataLine(data, fullResponse, res, responseId, model);
      } catch (parseError) {
        this.logger.error("JSON 파싱 오류:", parseError, "원본 데이터:", line);
      }
    }
    
    return { buffer: remainingBuffer, fullResponse };
  }

  /**
   * Generate 스트림의 단일 데이터 라인을 처리합니다.
   */
  private processDataLine(
    data: StreamData,
    fullResponse: string,
    res: Response,
    responseId: string,
    model: string
  ): string {
    // 응답 텍스트 추출
    if (data.response !== undefined) {
      return this.processResponse(data.response, fullResponse, res, responseId, model);
    }
    
    // 완료 신호가 있는 경우
    if (data.done) {
      this.sendCompletionFinalChunk(res, responseId, model);
    }
    
    return fullResponse;
  }

  /**
   * Generate 응답 텍스트를 처리하고 델타를 전송합니다.
   */
  private processResponse(
    responseText: string,
    fullResponse: string,
    res: Response,
    responseId: string,
    model: string
  ): string {
    // 응답 텍스트 정리 - 불필요한 마크다운 및 중첩 구조 제거
    const cleanedResponse = extractCodeContent(responseText);
    
    // 이전 응답과의 차이를 계산하여 델타만 전송
    const delta = cleanedResponse.substring(fullResponse.length);
    const updatedFullResponse = cleanedResponse;
    
    if (delta) {
      // IDE가 기대하는 형식으로 이벤트 구성
      const eventData = new TextCompletionChunkDto(responseId, model, delta);
      
      // SSE 형식으로 전송
      this.sendSSEEvent(res, eventData.toJSON());
      
      // 디버깅을 위한 로그 추가
      this.logger.debug(`전송된 코드(delta): ${delta}`);
    }
    
    return updatedFullResponse;
  }

  /**
   * Generate 완료의 최종 청크를 전송합니다.
   */
  private sendCompletionFinalChunk(res: Response, responseId: string, model: string): void {
    // 완료 메시지 전송
    const finalChunk = new TextCompletionChunkDto(responseId, model, "", "stop");
    
    this.sendSSEEvent(res, finalChunk.toJSON());
    this.sendDoneEvent(res);
    
    // 디버깅을 위한 로그 추가
    this.logger.debug('응답 완료');
  }

  /**
   * Generate 스트림 종료 시 처리합니다.
   */
  private processStreamEnd(
    data: StreamData,
    res: Response,
    responseId: string,
    model: string,
    fullResponse: string
  ): void {
    if (data.response !== undefined) {
      this.processResponse(data.response, fullResponse, res, responseId, model);
    }
    
    if (data.done) {
      this.sendCompletionFinalChunk(res, responseId, model);
    }
  }

  /**
   * 스트림 오류 처리
   */
  private handleStreamError(error: Error, res: Response, responseId: string, model: string): void {
    this.logger.error('스트림 데이터 오류:', error);
    
    // 클라이언트에 오류 알림
    const errorEvent = new TextCompletionChunkDto(responseId, model, "\n\n[오류 발생: 생성이 중단되었습니다]", "error");
    const errorResponse: TextCompletionChunkResponse & { error: StreamErrorResponse } = {
      ...errorEvent.toJSON(),
      error: {
        message: error.message || "스트림 처리 중 오류가 발생했습니다",
        type: "server_error"
      }
    };
    
    this.sendSSEEvent(res, errorResponse);
    this.sendDoneEvent(res);
    
    res.end();
  }
}
