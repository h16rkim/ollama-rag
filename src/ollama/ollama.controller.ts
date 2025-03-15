// src/ollama/ollama.controller.ts
import { Controller, Post, Body, Res, Logger } from '@nestjs/common';
import { Response } from 'express';
import { OllamaService } from './ollama.service';
import { ChatRequest, GenerateRequest, EmbeddingRequest } from '../common/interfaces/ollama.interface';
import { ResponseHandlerService } from '../common/services/response-handler.service';
import { ChatCompletionResponseDto, TextCompletionResponseDto } from '../common/dto/response.dto';
import { isCodeCompletionRequest, extractCodeContent } from '../common/utils/string-utils';
import { ResponseHeaders } from '../common/types/stream.types';

@Controller()
export class OllamaController {
  private readonly logger = new Logger(OllamaController.name);

  constructor(
    private readonly ollamaService: OllamaService,
    private readonly responseHandler: ResponseHandlerService
  ) {}

  /**
   * 채팅 API 엔드포인트 핸들러 (Ollama 원본 형식)
   */
  @Post('/api/chat')
  async chat(@Body() chatRequest: ChatRequest, @Res() res: Response) {
    const { response, isStream } = await this.ollamaService.sendChatRequest(chatRequest);
    const modelToUse = chatRequest.model || 'default';
    
    if (isStream) {
      // SSE 형식으로 스트림 데이터 전달
      this.responseHandler.handleChatStreamAsSSE(response, res, modelToUse);
    } else {
      // 응답 코드 200으로 설정
      res.status(200).json(response.data);
    }
  }

  /**
   * 채팅 완료 API 엔드포인트 핸들러 (OpenAI 호환)
   */
  @Post('/api/chat/completions')
  async chatCompletions(@Body() chatRequest: ChatRequest, @Res() res: Response) {
    const { response, isStream } = await this.ollamaService.sendChatRequest(chatRequest);
    const modelToUse = chatRequest.model || 'default';
    
    if (isStream) {
      // SSE 형식으로 스트림 데이터 전달
      this.responseHandler.handleChatStreamAsSSE(response, res, modelToUse);
    } else {
      // Ollama 응답을 OpenAI 형식으로 변환
      const responseDto = new ChatCompletionResponseDto(
        `chatcmpl-${Date.now()}`,
        modelToUse,
        response.data.message
      );
      
      // 응답 코드 200으로 설정
      res.status(200).json(responseDto.toJSON());
    }
  }

  /**
   * Generate API 엔드포인트 핸들러 (Ollama 원본 형식)
   */
  @Post('/api/generate')
  async generate(@Body() generateRequest: GenerateRequest, @Res() res: Response) {
    // 디버깅용 로그 추가
    this.logger.log(`Generate API 요청 수신: ${JSON.stringify(generateRequest)}`);
    
    // 요청 본문이 비어있는 경우
    if (this.isInvalidGenerateRequest(generateRequest, res)) {
      return;
    }
    
    // 코드 자동완성 요청인지 확인
    const isCodeCompletionReq = isCodeCompletionRequest(generateRequest.prompt);
    
    // 코드 자동완성 요청에 최적화된 프롬프트 설정
    if (isCodeCompletionReq && !generateRequest.system) {
      generateRequest.system = "당신은 코드를 정확하게 자동완성하는 AI 모델입니다. 코드 스니펫을 계속해서 완성해 주세요. 마크다운 코드 블록이나 주석 없이 코드만 생성해야 합니다.";
    }
    
    const { response, isStream } = await this.ollamaService.sendGenerateRequest(generateRequest);
    const modelToUse = generateRequest.model || 'default';
    
    // 디버깅을 위한 로그 추가
    this.logger.log(`Generate API 응답 받음: 스트리밍=${isStream}, 상태 코드=${response.status}, 코드 자동완성=${isCodeCompletionReq}`);
    
    if (isStream) {
      // 코드 자동완성 요청인 경우 특수 처리
      this.responseHandler.handleGenerateStreamAsSSE(response, res, modelToUse);
    } else {
      // 비스트리밍 모드에서는 OpenAI 호환 형식으로 변환하여 반환
      let responseText = response.data.response || '';
      
      // 마크다운 코드 블록 제거
      responseText = extractCodeContent(responseText);
      
      // OpenAI 형식으로 변환
      const responseDto = new TextCompletionResponseDto(
        `cmpl-${Date.now()}`,
        modelToUse,
        responseText
      );
      
      // SSE 헤더 설정 및 응답 전송
      this.setupSSEHeaders(res);
      res.write(`data: ${JSON.stringify(responseDto.toJSON())}\n\n`);
      res.write(`data: [DONE]\n\n`);
      res.end();
      
      // 디버깅을 위한 로그 추가
      this.logger.debug(`비스트리밍 SSE 응답: ${JSON.stringify(responseDto.toJSON())}`);
    }
  }

  /**
   * 임베딩 API 엔드포인트 핸들러
   */
  @Post('/api/embeddings')
  async embeddings(@Body() embeddingRequest: EmbeddingRequest) {
    const response = await this.ollamaService.sendEmbeddingRequest(embeddingRequest);
    return response;
  }

  /**
   * Generate 요청이 유효한지 확인합니다.
   */
  private isInvalidGenerateRequest(generateRequest: GenerateRequest, res: Response): boolean {
    if (!generateRequest || !generateRequest.prompt) {
      this.logger.error('Generate API 요청 본문이 비어 있거나 prompt 필드가 없습니다');
      
      if (res.req && res.req.headers) {
        this.logger.error(`요청 헤더: ${JSON.stringify(res.req.headers as ResponseHeaders)}`);
      }
      
      // 여기서 예외를 직접 던지지 않고 예외 필터가 처리하도록 함
      throw new Error('요청 본문이 비어 있거나 prompt 필드가 없습니다');
    }
    
    return false;
  }

  /**
   * SSE 응답을 위한 헤더 설정
   */
  private setupSSEHeaders(res: Response): void {
    res.status(200)
      .setHeader('Content-Type', 'text/event-stream')
      .setHeader('Cache-Control', 'no-cache')
      .setHeader('Connection', 'keep-alive');
  }
}
