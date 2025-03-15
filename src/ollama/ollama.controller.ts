// src/ollama/ollama.controller.ts
import { Controller, Post, Body, Res, HttpException, HttpStatus, Logger } from '@nestjs/common';
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
      try {
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
      } catch (error) {
        this.logger.error("스트리밍 데이터 처리 중 오류:", error);
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
   * 스트림 응답을 그대로 전달합니다
   */
  private passRawStream(stream: any, res: Response): void {
    stream.data.on('data', (chunk: Buffer) => {
      try {
        const jsonString = chunk.toString().trim();
        if (!jsonString) return;

        // Ollama 응답을 그대로 전달
        res.write(jsonString + '\n');
      } catch (error) {
        this.logger.error("스트리밍 데이터 처리 중 오류:", error);
      }
    });

    stream.data.on('end', () => {
      res.end();
    });
  }

  /**
   * 채팅 API 엔드포인트 핸들러 (Ollama 원본 형식)
   */
  @Post('/api/chat')
  async chat(@Body() chatRequest: ChatRequest, @Res() res: Response) {
    try {
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
        // Ollama 응답 그대로 반환
        res.json(response.data);
      }
    } catch (error) {
      this.logger.error('Chat API 오류:', error.message);
      throw new HttpException({
        error: '서버 오류',
        details: error.message
      }, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * 채팅 완료 API 엔드포인트 핸들러 (OpenAI 호환)
   */
  @Post('/api/chat/completions')
  async chatCompletions(@Body() chatRequest: ChatRequest, @Res() res: Response) {
    try {
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
        
        res.json(formattedResponse);
      }
    } catch (error) {
      this.logger.error('Chat Completions API 오류:', error.message);
      throw new HttpException({
        error: '서버 오류',
        details: error.message
      }, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Generate API 엔드포인트 핸들러 (Ollama 원본 형식)
   */
  @Post('/api/generate')
  async generate(@Body() generateRequest: GenerateRequest, @Res() res: Response) {
    try {
      const { response, isStream } = await this.ollamaService.sendGenerateRequest(generateRequest);
      const modelToUse = generateRequest.model || 'default';
      
      if (isStream) {
        // 응답 헤더 설정
        res.status(200)
          .setHeader('Content-Type', 'text/event-stream')
          .setHeader('Cache-Control', 'no-cache')
          .setHeader('Connection', 'keep-alive');
        
        // 스트림 데이터 처리
        let buffer = '';
        
        response.data.on('data', (chunk: Buffer) => {
          try {
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
                
                // 응답 텍스트 처리
                if ('response' in data) {
                  // SSE 형식으로 전송
                  const eventData = {
                    text: data.response,
                    done: data.done || false
                  };
                  
                  res.write(`data: ${JSON.stringify(eventData)}\n\n`);
                }
                
                // 완료 신호가 있는 경우
                if (data.done) {
                  res.write('data: [DONE]\n\n');
                }
              } catch (parseError) {
                this.logger.error("JSON 파싱 오류:", parseError, "원본 데이터:", line);
                // 파싱 오류는 무시하고 다음 줄 처리
              }
            }
          } catch (error) {
            this.logger.error("스트리밍 데이터 처리 중 오류:", error);
          }
        });
        
        response.data.on('end', () => {
          res.end();
        });
      } else {
        // Ollama 응답 그대로 반환
        res.json(response.data);
      }
    } catch (error) {
      this.logger.error('Generate API 오류:', error.message);
      throw new HttpException({
        error: '서버 오류',
        details: error.message
      }, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * 임베딩 API 엔드포인트 핸들러
   */
  @Post('/api/embeddings')
  async embeddings(@Body() embeddingRequest: EmbeddingRequest) {
    try {
      const response = await this.ollamaService.sendEmbeddingRequest(embeddingRequest);
      return response;
    } catch (error) {
      this.logger.error('Embeddings API 오류:', error.message);
      throw new HttpException({
        error: '서버 오류',
        details: error.message
      }, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
