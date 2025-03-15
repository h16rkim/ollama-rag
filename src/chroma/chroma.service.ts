// src/chroma/chroma.service.ts
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ChromaClient, Collection } from 'chromadb';
import { ConfigService } from '../config/config.service';
import axios from 'axios';
import * as path from 'path';

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
      
      // 컬렉션 항목 수 확인
      const count = await this.collection.count();
      this.logger.log(`컬렉션에 ${count}개의 항목이 있습니다.`);
    } catch (error) {
      this.logger.error('컬렉션 초기화 오류:', (error as Error).message);
      throw error;
    }
  }

  /**
   * 텍스트에서 파일 경로 정보를 추출합니다
   */
  private extractFilePath(text: string): string | null {
    const filePathMatch = text.match(/File Path: ([^\n]+)/);
    if (filePathMatch && filePathMatch[1]) {
      return filePathMatch[1].trim();
    }
    return null;
  }

  /**
   * 테스트 관련 키워드가 포함되어 있는지 확인합니다
   */
  private hasTestKeywords(text: string): boolean {
    const testKeywords = ['테스트', 'spec', 'Test', 'test'];
    return testKeywords.some(keyword => text.includes(keyword));
  }

  /**
   * 파일 경로에서 파일명(확장자 없음)을 추출합니다
   */
  private extractFileNameWithoutExtension(filePath: string): string {
    const basename = path.basename(filePath);
    const extname = path.extname(basename);
    return basename.substring(0, basename.length - extname.length);
  }

  /**
   * 파일 경로에서 관련 테스트 파일명 패턴을 생성합니다
   */
  private generateTestFilePatterns(filePath: string): string[] {
    const fileNameWithoutExt = this.extractFileNameWithoutExtension(filePath);
    return [
      `${fileNameWithoutExt}.spec.ts`,
      `${fileNameWithoutExt}.spec.js`,
      `${fileNameWithoutExt}Test.ts`,
      `${fileNameWithoutExt}Test.js`,
      `${fileNameWithoutExt}.test.ts`,
      `${fileNameWithoutExt}.test.js`,
      `Test${fileNameWithoutExt}.ts`,
      `Test${fileNameWithoutExt}.js`
    ];
  }

  /**
   * 사용자 쿼리에 관련된 코드 컨텍스트를 검색합니다
   */
  async fetchRelevantCodeContext(userMessage: string): Promise<string> {
    if (!this.collection) {
      throw new Error('벡터 DB가 초기화되지 않았습니다');
    }
    
    try {
      // 컬렉션에 데이터가 있는지 확인
      const collectionCount = await this.collection.count();
      this.logger.log(`컬렉션에 ${collectionCount}개의 항목이 있습니다.`);
      
      if (collectionCount === 0) {
        return "컬렉션에 데이터가 없습니다. 먼저 데이터를 적재해주세요.";
      }
      
      // 결과를 저장할 Set (중복 제거)
      const documents = new Set<string>();
      
      // 1. 파일 경로 추출 시도
      const filePath = this.extractFilePath(userMessage);
      
      if (filePath) {
        this.logger.log(`File Path가 감지되었습니다: ${filePath}`);
        
        // 파일 경로로 직접 검색
        const filePathResult = await this.searchByFilePath(filePath, 5);
        if (filePathResult.length > 0) {
          filePathResult.forEach(doc => documents.add(doc));
          this.logger.log(`파일 경로로 ${filePathResult.length}개 문서를 찾았습니다.`);
        } else {
          this.logger.log('파일 경로로 문서를 찾지 못했습니다.');
        }
        
        // 2. 테스트 키워드가 포함되어 있거나 테스트 파일 검색 요청됨
        if (this.hasTestKeywords(userMessage) || documents.size === 0) {
          const testPatterns = this.generateTestFilePatterns(filePath);
          this.logger.log(`테스트 파일 패턴 생성: ${testPatterns.join(', ')}`);
          
          for (const pattern of testPatterns) {
            const testResults = await this.searchByFileName(pattern, 2);
            if (testResults.length > 0) {
              testResults.forEach(doc => documents.add(doc));
              this.logger.log(`테스트 파일 패턴 '${pattern}'으로 ${testResults.length}개 문서를 찾았습니다.`);
            }
          }
        }
      }
      
      // 3. 일반 쿼리 시도 (문서가 충분하지 않은 경우)
      if (documents.size < 3) {
        const queryResult = await this.collection.query({
          queryTexts: [userMessage],
          nResults: 5
        });
        
        if (queryResult.documents[0] && queryResult.documents[0].length > 0) {
          queryResult.documents[0].forEach(doc => {
            if (doc) documents.add(doc);
          });
          this.logger.log(`일반 쿼리로 ${queryResult.documents[0].length}개 문서를 찾았습니다.`);
        } else {
          this.logger.log('일반 쿼리로 문서를 찾지 못했습니다.');
        }
      }
      
      // 4. 여전히 문서가 충분하지 않은 경우, 랜덤 문서 10개 추가
      if (documents.size < 3) {
        const randomDocs = await this.fetchRandomDocumentsArray(10);
        randomDocs.forEach(doc => documents.add(doc));
        this.logger.log(`랜덤 문서 ${randomDocs.length}개를 추가했습니다.`);
      }
      
      // 결과가 없으면 랜덤 문서만 반환
      if (documents.size === 0) {
        const randomDocs = await this.fetchRandomDocumentsArray(10);
        return randomDocs.join("\n\n");
      }
      
      return Array.from(documents).join("\n\n");
    } catch (error) {
      this.logger.error('검색 오류:', (error as Error).message);
      return `검색 중 오류가 발생했습니다: ${(error as Error).message}`;
    }
  }

  /**
   * 파일 경로로 관련 코드를 검색합니다
   */
  async searchByFilePath(filePath: string, limit = 5): Promise<string[]> {
    if (!this.collection) {
      throw new Error('벡터 DB가 초기화되지 않았습니다');
    }
    
    try {
      const fileName = path.basename(filePath);
      const dirName = path.dirname(filePath);
      
      // 결과를 저장할 배열
      const matchedDocuments: string[] = [];
      
      // 1. 정확한 파일 경로로 검색
      try {
        const pathResult = await this.collection.get({
          where: { filePath: filePath },
          limit
        });
        
        if (pathResult.documents && pathResult.documents.length > 0) {
          pathResult.documents.forEach(doc => {
            if (doc) matchedDocuments.push(doc);
          });
        }
      } catch (e) {
        this.logger.error('정확한 파일 경로 검색 오류:', (e as Error).message);
      }
      
      // 2. 파일명으로 검색 (이미 찾은 문서가 부족한 경우)
      if (matchedDocuments.length < limit) {
        const nameResults = await this.searchByFileName(fileName, limit);
        nameResults.forEach(doc => {
          if (!matchedDocuments.includes(doc)) {
            matchedDocuments.push(doc);
          }
        });
      }
      
      // 3. 디렉토리 검색 (이미 찾은 문서가 부족한 경우)
      if (matchedDocuments.length < limit) {
        // 많은 문서를 검색한 다음 클라이언트 측에서 필터링
        const allItems = await this.collection.peek({ limit: 50 });
        
        if (allItems.metadatas && allItems.documents) {
          for (let i = 0; i < allItems.metadatas.length; i++) {
            if (matchedDocuments.length >= limit) break;
            
            const metadata = allItems.metadatas[i];
            const document = allItems.documents[i];
            
            if (metadata && document) {
              const metaFilePath = metadata.filePath || '';
              
              if (typeof metaFilePath === 'string' && metaFilePath.includes(dirName)) {
                if (!matchedDocuments.includes(document)) {
                  matchedDocuments.push(document);
                }
              }
            }
          }
        }
      }
      
      return matchedDocuments;
    } catch (error) {
      this.logger.error('파일 경로 검색 오류:', (error as Error).message);
      return [];
    }
  }

  /**
   * 파일명으로 관련 코드를 검색합니다
   */
  async searchByFileName(fileName: string, limit = 5): Promise<string[]> {
    if (!this.collection) {
      throw new Error('벡터 DB가 초기화되지 않았습니다');
    }
    
    try {
      // 결과를 저장할 배열
      const matchedDocuments: string[] = [];
      
      // 1. 벡터 검색 (의미적 유사성)
      const semanticResult = await this.collection.query({
        queryTexts: [fileName],
        nResults: limit
      });
      
      // 벡터 검색 결과 추가
      if (semanticResult.documents[0]) {
        semanticResult.documents[0].forEach(doc => {
          if (doc) matchedDocuments.push(doc);
        });
      }
      
      // 2. 메타데이터 기반 검색 - 클라이언트 측 필터링
      // 더 많은 결과를 가져와서 필터링
      const allItems = await this.collection.peek({ limit: 50 });
      
      if (allItems.metadatas && allItems.documents) {
        for (let i = 0; i < allItems.metadatas.length; i++) {
          if (matchedDocuments.length >= limit * 2) break; // 더 많은 문서를 찾아도 중단
          
          const metadata = allItems.metadatas[i];
          const document = allItems.documents[i];
          
          if (metadata && document) {
            const metaFileName = metadata.fileName || '';
            const metaFilePath = metadata.filePath || '';
            
            if (
              (typeof metaFileName === 'string' && metaFileName.toLowerCase().includes(fileName.toLowerCase())) ||
              (typeof metaFilePath === 'string' && metaFilePath.toLowerCase().includes(fileName.toLowerCase()))
            ) {
              if (!matchedDocuments.includes(document)) {
                matchedDocuments.push(document);
              }
            }
          }
        }
      }
      
      // 검색된 문서 수 제한
      return matchedDocuments.slice(0, limit);
    } catch (error) {
      this.logger.error('파일명 검색 오류:', (error as Error).message);
      return [];
    }
  }

  /**
   * 코드 내용으로 유사한 코드를 검색합니다
   */
  async searchByCodeContent(codeSnippet: string, limit = 5): Promise<string[]> {
    if (!this.collection) {
      throw new Error('벡터 DB가 초기화되지 않았습니다');
    }
    
    try {
      // 벡터 검색을 사용한 의미적 유사성 검색
      const queryResult = await this.collection.query({
        queryTexts: [codeSnippet],
        nResults: limit
      });
      
      if (!queryResult.documents[0] || queryResult.documents[0].length === 0) {
        return [];
      }
      
      // null 아닌 문서만 반환
      return queryResult.documents[0].filter(doc => doc !== null) as string[];
    } catch (error) {
      this.logger.error('코드 검색 오류:', (error as Error).message);
      return [];
    }
  }
  
  /**
   * 파일 확장자로 필터링하여 검색합니다
   */
  async searchByFileExtension(extension: string, searchText: string, limit = 5): Promise<string[]> {
    if (!this.collection) {
      throw new Error('벡터 DB가 초기화되지 않았습니다');
    }
    
    try {
      // 결과를 저장할 배열
      const matchedDocuments: string[] = [];
      
      // 확장자로 필터링하면서 의미적 유사성 검색 시도
      try {
        const queryResult = await this.collection.query({
          queryTexts: [searchText],
          where: { fileExtension: extension.startsWith('.') ? extension : `.${extension}` },
          nResults: limit
        });
        
        if (queryResult.documents[0] && queryResult.documents[0].length > 0) {
          queryResult.documents[0].forEach(doc => {
            if (doc) matchedDocuments.push(doc);
          });
        }
      } catch (e) {
        this.logger.error('확장자 필터링 검색 오류:', (e as Error).message);
      }
      
      // 결과가 충분하지 않으면 클라이언트측 필터링 시도
      if (matchedDocuments.length < limit) {
        const semanticResult = await this.collection.query({
          queryTexts: [searchText],
          nResults: 20  // 더 많은 결과를 검색하여 필터링
        });
        
        if (semanticResult.documents[0] && semanticResult.documents[0].length > 0) {
          // 확장자로 클라이언트측 필터링
          for (let i = 0; i < semanticResult.metadatas[0].length; i++) {
            if (matchedDocuments.length >= limit) break;
            
            const metadata = semanticResult.metadatas[0][i];
            const document = semanticResult.documents[0][i];
            
            if (metadata && document) {
              const fileExt = metadata.fileExtension || '';
              const normalizedExt = extension.startsWith('.') ? extension : `.${extension}`;
              
              if (fileExt === normalizedExt && !matchedDocuments.includes(document)) {
                matchedDocuments.push(document);
              }
            }
          }
        }
      }
      
      return matchedDocuments;
    } catch (error) {
      this.logger.error('확장자 검색 오류:', (error as Error).message);
      return [];
    }
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
  
  /**
   * 컬렉션의 모든 항목을 확인합니다 (디버깅용)
   */
  async listAllItems(limit = 10): Promise<any> {
    if (!this.collection) {
      throw new Error('벡터 DB가 초기화되지 않았습니다');
    }
    
    try {
      return await this.collection.peek({ limit });
    } catch (error) {
      this.logger.error('항목 조회 오류:', (error as Error).message);
      throw error;
    }
  }
  
  /**
   * 무작위 문서를 조회합니다 (배열 형태)
   */
  async fetchRandomDocumentsArray(count = 10): Promise<string[]> {
    if (!this.collection) {
      throw new Error('벡터 DB가 초기화되지 않았습니다');
    }
    
    try {
      const collectionCount = await this.collection.count();
      if (collectionCount === 0) {
        return [];
      }
      
      // 일반적인 프로그래밍 키워드로 검색
      const keywords = ["function", "class", "import", "const", "let", "var"];
      const randomKeyword = keywords[Math.floor(Math.random() * keywords.length)];
      
      const results = await this.collection.query({
        queryTexts: [randomKeyword],
        nResults: count
      });
      
      if (results.documents[0] && results.documents[0].length > 0) {
        return results.documents[0].filter(doc => doc !== null) as string[];
      }
      
      // 메타데이터 기반으로 검색 시도
      const allItems = await this.collection.peek({ limit: count });
      if (allItems.documents && allItems.documents.length > 0) {
        return allItems.documents.filter(doc => doc !== null) as string[];
      }
      
      return [];
    } catch (error) {
      this.logger.error('랜덤 문서 조회 오류:', (error as Error).message);
      return [];
    }
  }
  
  /**
   * 무작위 문서를 조회합니다 (문자열 형태)
   */
  async fetchRandomDocuments(count = 10): Promise<string> {
    const documents = await this.fetchRandomDocumentsArray(count);
    return documents.join("\n\n");
  }
}
