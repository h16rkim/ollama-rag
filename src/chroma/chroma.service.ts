// src/chroma/chroma.service.ts
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ChromaClient, Collection } from 'chromadb';
import { ConfigService } from '../config/config.service';
import axios from 'axios';

@Injectable()
export class ChromaService implements OnModuleInit {
  private readonly logger = new Logger(ChromaService.name);
  private collection: Collection | null = null;

  constructor(private readonly configService: ConfigService) {}

  /**
   * 모듈 초기화 시 ChromaDB에 연결합니다
   */
  async onModuleInit() {
    await this.initChromaDB();
  }

  /**
   * ChromaDB를 초기화합니다
   */
  private async initChromaDB(): Promise<void> {
    const chromaConfig = this.configService.get('chroma');
    const ollamaConfig = this.configService.get('ollama');
    
    this.logger.log(`ChromaDB 서버에 연결 중: ${chromaConfig.url}`);
    
    const client = new ChromaClient({
      path: chromaConfig.url
    });

    const embeddingFunction = {
      generate: async (texts: string[]): Promise<number[][]> => {
        return Promise.all(texts.map(async text => {
          const response = await axios.post(`${ollamaConfig.baseUrl}/api/embeddings`, {
            model: ollamaConfig.embeddingModel,
            prompt: text
          });
          return response.data.embedding;
        }));
      }
    };

    try {
      this.collection = await client.getCollection({
        name: chromaConfig.collectionName,
        embeddingFunction
      });
      this.logger.log(`컬렉션 "${chromaConfig.collectionName}" 연결됨`);
    } catch (error) {
      this.logger.error('컬렉션 초기화 오류:', (error as Error).message);
      throw error;
    }
  }

  /**
   * 사용자 쿼리에 관련된 코드 컨텍스트를 검색합니다
   */
  async fetchRelevantCodeContext(userMessage: string): Promise<string> {
    if (!this.collection) {
      throw new Error('벡터 DB가 초기화되지 않았습니다');
    }
    
    const queryResult = await this.collection.query({
      queryTexts: [userMessage],
      nResults: 5
    });
    
    return queryResult.documents[0].join("\n\n");
  }

  /**
   * 프롬프트에 코드 컨텍스트를 추가합니다
   */
  async enhancePromptWithCodeContext(prompt: string): Promise<string> {
    const codeContext = await this.fetchRelevantCodeContext(prompt);
    return `다음은 개발자의 코드 예제들입니다. 이 스타일을 참고하세요:\n\n${codeContext}\n\n프롬프트: ${prompt}`;
  }

  /**
   * 컬렉션이 초기화되었는지 확인합니다
   */
  isCollectionInitialized(): boolean {
    return this.collection !== null;
  }
}
