// src/ollama/ollama.controller.ts
import { Controller, Post, Body, Res, Logger } from '@nestjs/common';
import { Response } from 'express';
import { OllamaService } from './ollama.service';
import { ChatRequest, GenerateRequest, EmbeddingRequest } from '../common/interfaces/ollama.interface';

@Controller()
export class OllamaController {
  private readonly logger = new Logger(OllamaController.name);

  constructor(private readonly ollamaService: OllamaService) {}

  /**
   * 스트림 응답을 SSE 형식으로 변환하여 전달합니다.
   */
  private passStreamAsSSE(
    stream: any,
    res: Response,
    model: string
  ): void {
    let responseId = `chatcmpl-${Date.now()}`;
    let buffer = '';
    
    stream.data.on('data', (chunk: Buffer) => {
      // 버퍼에 새 데이터 추가
      buffer += chunk.toString();
      
      // 줄바꿈으로 분리하여 각 JSON 객체 처리
      const lines = buffer.split('\n');
      
      // 마지막 줄은 완전한 JSON이 아닐 수 있으므로 버퍼에 남김
      buffer = lines.pop() || '';
      
      for (const line of lines) {
        if (!line.trim()) continue;
        
        try {
          const data = JSON.parse(line);
          
          // 메시지 내용 추출
          const content = data.message?.content || '';
          
          if (content) {
            // OpenAI 형식으로 SSE 이벤트 구성
            const eventData = {
              id: responseId,
              object: "chat.completion.chunk",
              created: Math.floor(Date.now() / 1000),
              model: model,
              choices: [
                {
                  delta: { content },
                  index: 0,
                  finish_reason: null
                }
              ]
            };
            
            // SSE 형식으로 전송
            res.write(`data: ${JSON.stringify(eventData)}\n\n`);
          }
          
          // 완료 신호가 있는 경우
          if (data.done) {
            // 완료 메시지 전송
            const finalChunk = {
              id: responseId,
              object: "chat.completion.chunk",
              created: Math.floor(Date.now() / 1000),
              model: model,
              choices: [
                {
                  delta: {},
                  index: 0,
                  finish_reason: "stop"
                }
              ]
            };
            
            res.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
            res.write(`data: [DONE]\n\n`);
          }
        } catch (parseError) {
          this.logger.error("JSON 파싱 오류:", parseError, "원본 데이터:", line);
          // 파싱 오류는 무시하고 다음 줄 처리
        }
      }
    });

    stream.data.on('end', () => {
      // 버퍼에 남은 데이터가 있으면 처리
      if (buffer.trim()) {
        try {
          const data = JSON.parse(buffer);
          
          if (data.message?.content) {
            const eventData = {
              id: responseId,
              object: "chat.completion.chunk",
              created: Math.floor(Date.now() / 1000),
              model: model,
              choices: [
                {
                  delta: { content: data.message.content },
                  index: 0,
                  finish_reason: null
                }
              ]
            };
            
            res.write(`data: ${JSON.stringify(eventData)}\n\n`);
          }
          
          if (data.done) {
            const finalChunk = {
              id: responseId,
              object: "chat.completion.chunk",
              created: Math.floor(Date.now() / 1000),
              model: model,
              choices: [
                {
                  delta: {},
                  index: 0,
                  finish_reason: "stop"
                }
              ]
            };
            
            res.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
            res.write(`data: [DONE]\n\n`);
          }
        } catch (e) {
          this.logger.error("버퍼 처리 중 오류:", e);
        }
      }
      
      res.end();
    });
  }

  /**
   * Generate API 스트림 응답을 SSE 형식으로 변환하여 전달합니다.
   */
  private passGenerateStreamAsSSE(
    stream: any,
    res: Response,
    model: string
  ): void {
    let responseId = `cmpl-${Date.now()}`;
    let buffer = '';
    let fullResponse = '';
    
    // 코드 블록 및 불필요한 형식을 제거하는 함수
    const extractCodeContent = (text: string): string => {
      // 마크다운 코드 블록 제거
      let cleaned = text;
      
      // ```언어명 형식의 코드 블록 제거
      cleaned = cleaned.replace(/^```(?:javascript|typescript|js|ts|json)?\s*\n([\s\S]*?)```$/gm, '$1');
      
      // 여전히 JSON 형식이라면 파싱 시도
      if (cleaned.trim().startsWith('{') && cleaned.trim().endsWith('}')) {
        try {
          const parsedJson = JSON.parse(cleaned);
          // JSON 내에 response 필드가 있으면 그 값을 사용
          if (parsedJson.response) {
            return parsedJson.response;
          }
          // result 필드가 있으면 그 값을 사용
          if (parsedJson.result) {
            return parsedJson.result;
          }
          // code 필드가 있으면 그 값을 사용
          if (parsedJson.code) {
            return parsedJson.code;
          }
        } catch (e) {
          // JSON 파싱 실패 시 원본 텍스트 사용
        }
      }
      
      return cleaned.trim();
    };
    
    stream.data.on('data', (chunk: Buffer) => {
      // 버퍼에 새 데이터 추가
      const chunkStr = chunk.toString();
      buffer += chunkStr;
      
      // 디버깅을 위한 로그 추가
      this.logger.debug(`받은 청크: ${chunkStr}`);
      
      // 줄바꿈으로 분리하여 각 JSON 객체 처리
      const lines = buffer.split('\n');
      
      // 마지막 줄은 완전한 JSON이 아닐 수 있으므로 버퍼에 남김
      buffer = lines.pop() || '';
      
      for (const line of lines) {
        if (!line.trim()) continue;
        
        try {
          const data = JSON.parse(line);
          
          // 응답 텍스트 추출
          if (data.response !== undefined) {
            // 응답 텍스트 정리 - 불필요한 마크다운 및 중첩 구조 제거
            const cleanedResponse = extractCodeContent(data.response);
            
            // 이전 응답과의 차이를 계산하여 델타만 전송
            const delta = cleanedResponse.substring(fullResponse.length);
            fullResponse = cleanedResponse;
            
            if (delta) {
              // IDE가 기대하는 형식으로 이벤트 구성
              const eventData = {
                id: responseId,
                object: "text_completion.chunk",
                created: Math.floor(Date.now() / 1000),
                model: model,
                choices: [
                  {
                    text: delta,
                    index: 0,
                    logprobs: null,
                    finish_reason: null
                  }
                ]
              };
              
              // SSE 형식으로 전송
              res.write(`data: ${JSON.stringify(eventData)}\n\n`);
              
              // 디버깅을 위한 로그 추가
              this.logger.debug(`전송된 코드(delta): ${delta}`);
            }
          }
          
          // 완료 신호가 있는 경우
          if (data.done) {
            // 완료 메시지 전송
            const finalChunk = {
              id: responseId,
              object: "text_completion.chunk",
              created: Math.floor(Date.now() / 1000),
              model: model,
              choices: [
                {
                  text: "",
                  index: 0,
                  logprobs: null,
                  finish_reason: "stop"
                }
              ]
            };
            
            res.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
            res.write(`data: [DONE]\n\n`);
            
            // 디버깅을 위한 로그 추가
            this.logger.debug('응답 완료');
          }
        } catch (parseError) {
          this.logger.error("JSON 파싱 오류:", parseError, "원본 데이터:", line);
          // 파싱 오류는 무시하고 다음 줄 처리
        }
      }
    });

    stream.data.on('end', () => {
      // 버퍼에 남은 데이터가 있으면 처리
      if (buffer.trim()) {
        try {
          const data = JSON.parse(buffer);
          
          if (data.response !== undefined) {
            // 응답 텍스트 정리
            const cleanedResponse = extractCodeContent(data.response);
            
            // 이전 응답과의 차이를 계산하여 델타만 전송
            const delta = cleanedResponse.substring(fullResponse.length);
            
            if (delta) {
              const eventData = {
                id: responseId,
                object: "text_completion.chunk",
                created: Math.floor(Date.now() / 1000),
                model: model,
                choices: [
                  {
                    text: delta,
                    index: 0,
                    logprobs: null,
                    finish_reason: null
                  }
                ]
              };
              
              res.write(`data: ${JSON.stringify(eventData)}\n\n`);
            }
          }
          
          if (data.done) {
            const finalChunk = {
              id: responseId,
              object: "text_completion.chunk",
              created: Math.floor(Date.now() / 1000),
              model: model,
              choices: [
                {
                  text: "",
                  index: 0,
                  logprobs: null,
                  finish_reason: "stop"
                }
              ]
            };
            
            res.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
            res.write(`data: [DONE]\n\n`);
          }
        } catch (e) {
          this.logger.error("버퍼 처리 중 오류:", e);
        }
      }
      
      res.end();
    });
    
    // 오류 처리
    stream.data.on('error', (error) => {
      this.logger.error('스트림 데이터 오류:', error);
      
      // 클라이언트에 오류 알림
      const errorEvent = {
        id: responseId,
        object: "text_completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model: model,
        choices: [
          {
            text: "\n\n[오류 발생: 생성이 중단되었습니다]",
            index: 0,
            logprobs: null,
            finish_reason: "error"
          }
        ],
        error: {
          message: error.message || "스트림 처리 중 오류가 발생했습니다",
          type: "server_error"
        }
      };
      
      res.write(`data: ${JSON.stringify(errorEvent)}\n\n`);
      res.write(`data: [DONE]\n\n`);
      
      res.end();
    });
  }

  /**
   * 스트림 응답을 그대로 전달합니다
   */
  private passRawStream(stream: any, res: Response): void {
    stream.data.on('data', (chunk: Buffer) => {
      const jsonString = chunk.toString().trim();
      if (!jsonString) return;

      // Ollama 응답을 그대로 전달
      res.write(jsonString + '\n');
    });

    stream.data.on('end', () => {
      res.end();
    });
  }

  /**
   * 코드 블록 및 불필요한 형식을 제거하는 함수 (비스트리밍 모드용)
   */
  private extractCodeContent(text: string): string {
    // 마크다운 코드 블록 제거
    let cleaned = text;
    
    // ```언어명 형식의 코드 블록 제거
    cleaned = cleaned.replace(/^```(?:javascript|typescript|js|ts|json)?\s*\n([\s\S]*?)\n```$/gm, '$1');
    
    // 여전히 JSON 형식이라면 파싱 시도
    if (cleaned.trim().startsWith('{') && cleaned.trim().endsWith('}')) {
      try {
        const parsedJson = JSON.parse(cleaned);
        // JSON 내에 response 필드가 있으면 그 값을 사용
        if (parsedJson.response) {
          return parsedJson.response;
        }
        // result 필드가 있으면 그 값을 사용
        if (parsedJson.result) {
          return parsedJson.result;
        }
        // code 필드가 있으면 그 값을 사용
        if (parsedJson.code) {
          return parsedJson.code;
        }
      } catch (e) {
        // JSON 파싱 실패 시 원본 텍스트 사용
      }
    }
    
    return cleaned.trim();
  }

  /**
   * 채팅 API 엔드포인트 핸들러 (Ollama 원본 형식)
   */
  @Post('/api/chat')
  async chat(@Body() chatRequest: ChatRequest, @Res() res: Response) {
    const { response, isStream } = await this.ollamaService.sendChatRequest(chatRequest);
    const modelToUse = chatRequest.model || 'default';
    
    if (isStream) {
      // 응답 헤더 설정 (SSE 형식으로 변경)
      res.status(200)
        .setHeader('Content-Type', 'text/event-stream')
        .setHeader('Cache-Control', 'no-cache')
        .setHeader('Connection', 'keep-alive');
      
      // SSE 형식으로 스트림 데이터 전달
      this.passStreamAsSSE(response, res, modelToUse);
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
      // 응답 헤더 설정 (SSE 형식)
      res.status(200)
        .setHeader('Content-Type', 'text/event-stream')
        .setHeader('Cache-Control', 'no-cache')
        .setHeader('Connection', 'keep-alive');
      
      // SSE 형식으로 스트림 데이터 전달
      this.passStreamAsSSE(response, res, modelToUse);
    } else {
      // Ollama 응답을 OpenAI 형식으로 변환
      const formattedResponse = {
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: modelToUse,
        choices: [
          {
            index: 0,
            message: response.data.message,
            finish_reason: 'stop'
          }
        ],
        usage: {
          prompt_tokens: -1,
          completion_tokens: -1,
          total_tokens: -1
        }
      };
      
      // 응답 코드 200으로 설정
      res.status(200).json(formattedResponse);
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
    if (!generateRequest || !generateRequest.prompt) {
      this.logger.error('Generate API 요청 본문이 비어 있거나 prompt 필드가 없습니다');
      this.logger.error(`요청 본문: ${JSON.stringify(generateRequest)}`);
      this.logger.error(`요청 헤더: ${JSON.stringify(res.req.headers)}`);
      // 여기서 예외를 직접 던지지 않고 예외 필터가 처리하도록 함
      throw new Error('요청 본문이 비어 있거나 prompt 필드가 없습니다');
    }
    
    // 코드 자동완성 요청인지 확인 (프롬프트가 코드 스니펫으로 시작하는 경우)
    const isCodeCompletion = generateRequest.prompt && 
      (generateRequest.prompt.includes('function') || 
       generateRequest.prompt.includes('class') || 
       generateRequest.prompt.includes('export') ||
       generateRequest.prompt.includes('import') ||
       generateRequest.prompt.includes('const') ||
       generateRequest.prompt.includes('let') ||
       generateRequest.prompt.includes('var'));
    
    // 코드 자동완성 요청에 최적화된 프롬프트 설정
    if (isCodeCompletion && !generateRequest.system) {
      generateRequest.system = "당신은 코드를 정확하게 자동완성하는 AI 모델입니다. 코드 스니펫을 계속해서 완성해 주세요. 마크다운 코드 블록이나 주석 없이 코드만 생성해야 합니다.";
    }
    
    const { response, isStream } = await this.ollamaService.sendGenerateRequest(generateRequest);
    const modelToUse = generateRequest.model || 'default';
    
    // 디버깅을 위한 로그 추가
    this.logger.log(`Generate API 응답 받음: 스트리밍=${isStream}, 상태 코드=${response.status}, 코드 자동완성=${isCodeCompletion}`);
    
    if (isStream) {
      // 응답 헤더 설정 (SSE 형식) - 명시적으로 200 상태 코드 설정
      res.status(200)
        .setHeader('Content-Type', 'text/event-stream')
        .setHeader('Cache-Control', 'no-cache')
        .setHeader('Connection', 'keep-alive');
      
      // 코드 자동완성 요청인 경우 특수 처리
      this.passGenerateStreamAsSSE(response, res, modelToUse);
    } else {
      // 비스트리밍 모드에서는 OpenAI 호환 형식으로 변환하여 반환
      let responseText = response.data.response || '';
      
      // 마크다운 코드 블록 제거
      responseText = this.extractCodeContent(responseText);
      
      // OpenAI 형식으로 변환
      const formattedResponse = {
        id: `cmpl-${Date.now()}`,
        object: 'text_completion',
        created: Math.floor(Date.now() / 1000),
        model: modelToUse,
        choices: [
          {
            text: responseText,
            index: 0,
            logprobs: null,
            finish_reason: 'stop'
          }
        ],
        usage: {
          prompt_tokens: -1,
          completion_tokens: -1,
          total_tokens: -1
        }
      };
      
      // 응답 헤더 설정 - SSE 형식 사용
      res.status(200)
        .setHeader('Content-Type', 'text/event-stream')
        .setHeader('Cache-Control', 'no-cache')
        .setHeader('Connection', 'keep-alive');
      
      // SSE 형식으로 응답 전송 (data: 접두사 사용)
      res.write(`data: ${JSON.stringify(formattedResponse)}\n\n`);
      res.write(`data: [DONE]\n\n`);
      res.end();
      
      // 디버깅을 위한 로그 추가
      this.logger.debug(`비스트리밍 SSE 응답: ${JSON.stringify(formattedResponse)}`);
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
}
