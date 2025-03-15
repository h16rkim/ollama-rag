// src/ollama/ollama.service.ts
import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { ConfigService } from '../config/config.service';
import { ChromaService } from '../chroma/chroma.service';
import { ChatMessage, ChatRequest, GenerateRequest, EmbeddingRequest } from '../common/interfaces/ollama.interface';

@Injectable()
export class OllamaService {
  private readonly logger = new Logger(OllamaService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly chromaService: ChromaService,
  ) {}

  /**
   * 코드 컨텍스트를 포함하도록 메시지를 업데이트합니다
   */
  async updateMessagesWithContext(messages: ChatMessage[], codeContext: string): Promise<ChatMessage[]> {
    const updatedMessages = [...messages];
    const systemMessage = messages.find(m => m.role === 'system');

    if (systemMessage) {
      return updatedMessages.map(m =>
        m.role === 'system'
          ? { ...m, content: `${m.content}\n\n다음은 개발자의 코드 예제들입니다. 이 스타일을 참고하세요:\n\n${codeContext}` }
          : m
      );
    } else {
      return [
        { role: 'system', content: `코딩 스타일을 참고하세요:\n\n${codeContext}` }, 
        ...updatedMessages
      ];
    }
  }

  /**
   * Ollama 채팅 API로 요청을 보냅니다
   */
  async sendChatRequest(chatRequest: ChatRequest) {
    const { messages, model, stream = false, options } = chatRequest;
    const userMessage = messages.find(m => m.role === 'user')?.content || '';
    const modelToUse = model || this.configService.get('ollama').model;
    
    if (!this.chromaService.isCollectionInitialized()) {
      throw new Error('벡터 DB가 초기화되지 않았습니다');
    }
    
    // 벡터 DB에서 관련 코드 검색
    const codeContext = await this.chromaService.fetchRelevantCodeContext(userMessage);
    
    // 관련 코드를 컨텍스트로 추가
    const updatedMessages = await this.updateMessagesWithContext(messages, codeContext);
    
    // 요청 데이터 구성
    const requestData: any = {
      model: modelToUse,
      messages: updatedMessages,
      stream
    };
    
    // 옵션이 있으면 추가
    if (options) {
      requestData.options = options;
    }
    
    this.logger.log(`/api/chat 요청: ${modelToUse}, 스트리밍: ${stream}`);
    
      // Ollama API 요청
      const response = await axios.post(
        `${this.configService.get('ollama').baseUrl}/api/chat`, 
        requestData,
        stream ? { responseType: 'stream' } : {}
      );
      
      return {
        response,
        isStream: stream
      };
  }

  /**
   * Ollama 생성 API로 요청을 보냅니다
   */
  async sendGenerateRequest(generateRequest: GenerateRequest) {
    const { model, prompt, system, template, context, options, stream = false } = generateRequest;
    
    if (!prompt) {
      throw new Error('프롬프트가 필요합니다');
    }
    
    const modelToUse = model || this.configService.get('ollama').model;
    
    let enhancedPrompt = prompt;
    
    // 벡터 DB가 초기화되어 있으면 코드 컨텍스트 추가
    if (this.chromaService.isCollectionInitialized()) {
      try {
        enhancedPrompt = await this.chromaService.enhancePromptWithCodeContext(prompt);
      } catch (error) {
        this.logger.warn('코드 컨텍스트 추가 실패, 원본 프롬프트 사용:', error);
      }
    }
    
    // 요청 데이터 구성
    const requestData: any = {
      model: modelToUse,
      prompt: enhancedPrompt,
      stream
    };
    
    // 옵션이 있으면 추가
    if (options) {
      requestData.options = options;
    }
    
    // 시스템 프롬프트가 있으면 추가
    if (system) {
      requestData.system = system;
    }
    
    // 템플릿이 있으면 추가
    if (template) {
      requestData.template = template;
    }
    
    // 컨텍스트가 있으면 추가
    if (context) {
      requestData.context = context;
    }
    
    this.logger.log(`/api/generate 요청: ${modelToUse}, 스트리밍: ${stream}`);
    
    try {
      // Ollama API 요청
      const response = await axios.post(
        `${this.configService.get('ollama').baseUrl}/api/generate`, 
        requestData,
        stream ? { 
          responseType: 'stream',
          timeout: 30000,
          validateStatus: (status) => true
        } : {
          timeout: 30000,
          validateStatus: (status) => true
        }
      );
      
      return {
        response,
        isStream: stream
      };
    } catch (error) {
      this.logger.error('Generate API 오류:', error.message);
      throw error;
    }
  }

  /**
   * Ollama 임베딩 API로 요청을 보냅니다
   */
  async sendEmbeddingRequest(embeddingRequest: EmbeddingRequest) {
    const { model, prompt } = embeddingRequest;
    
    if (!prompt) {
      throw new Error('프롬프트가 필요합니다');
    }
    
    const modelToUse = model || this.configService.get('ollama').embeddingModel;
    
    try {
      // Ollama API로 임베딩 요청 전달
      const response = await axios.post(
        `${this.configService.get('ollama').baseUrl}/api/embeddings`, 
        {
          model: modelToUse,
          prompt
        }
      );
      
      return response.data;
    } catch (error) {
      this.logger.error('Embeddings API 오류:', error.message);
      throw error;
    }
  }
}
