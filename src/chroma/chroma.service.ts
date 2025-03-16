// src/chroma/chroma.service.ts
import {Injectable, Logger, OnModuleInit} from '@nestjs/common';
import {ChromaClient, Collection, IncludeEnum} from 'chromadb';
import {ConfigService} from '../config/config.service';
import axios from 'axios';
import * as path from 'path';
import {
  calculateFileNameSimilarity,
  extractFilePath,
  generateTestFilePatterns,
  getLanguageFromFilePath,
  getLanguageTypeFromExtension,
  hasTestKeywords
} from './chroma.utils';

// 문서와 메타데이터를 포함하는 타입 정의
interface DocumentWithMetadata {
  document: string;
  metadata: any;
}

// 검색 결과 타입 정의
type SearchResult = DocumentWithMetadata[];

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
   * 컬렉션이 초기화되었는지 확인합니다
   */
  private ensureCollectionInitialized(): void {
    if (!this.collection) {
      throw new Error('벡터 DB가 초기화되지 않았습니다');
    }
  }

  /**
   * 검색 결과를 처리하고 로깅합니다
   */
  private processSearchResult(
    result: { documents?: string[], metadatas?: Record<string, unknown>[] }, 
    searchType: string,
    searchValue: string
  ): SearchResult {
    const documents: SearchResult = this.processDocumentsAndMetadata(
      result.documents,
      result.metadatas
    );
    
    this.logSearchResult(documents, searchType, searchValue);
    
    return documents;
  }
  
  /**
   * 검색 결과를 로깅합니다
   */
  private logSearchResult(documents: SearchResult, searchType: string, searchValue: string): void {
    if (documents.length > 0) {
      this.logger.log(`${searchType} '${searchValue}'로 ${documents.length}개 문서를 찾았습니다.`);
    } else {
      this.logger.log(`${searchType} '${searchValue}'로 문서를 찾지 못했습니다.`);
    }
  }

  /**
   * 문서와 메타데이터를 처리합니다
   */
  private processDocumentsAndMetadata(
    documents: string[] | undefined,
    metadatas: Record<string, unknown>[] | undefined
  ): SearchResult {
    const result: SearchResult = [];
    
    if (!documents) return result;
    
    for (let i = 0; i < documents.length; i++) {
      const doc = documents[i];
      if(doc.startsWith("import")) {
        continue;
      }
      const metadata = metadatas?.[i] || {};
      
      if (doc) {
        result.push({ document: doc, metadata });
      }
    }
    
    return result;
  }

  /**
   * 문서가 중복되는지 확인합니다
   */
  private isDocumentDuplicate(
    document: string,
    existingDocuments: SearchResult
  ): boolean {
    return existingDocuments.some(item => item.document === document);
  }

  /**
   * 중복 제거하며 문서를 병합합니다
   */
  private mergeDocumentsWithoutDuplicates(
    targetArray: SearchResult, 
    documentsToAdd: SearchResult
  ): void {
    for (const doc of documentsToAdd) {
      if (!this.isDocumentDuplicate(doc.document, targetArray)) {
        targetArray.push(doc);
      }
    }
  }

  /**
   * 관련 코드 컨텍스트에 가중치를 적용하고 정렬합니다
   */
  private applyWeightsAndSort(
    documents: SearchResult,
    targetLanguage: string,
    targetFileName: string
  ): string[] {
    // 가중치가 적용된 문서 배열
    const weightedDocs = documents.map(item => {
      let weight = 1; // 기본 가중치

      // 언어 일치에 따른 가중치 부여
      const fileExtension = item.metadata?.filePath
        ? path.extname(item.metadata.filePath).toLowerCase()
        : '';

      const docLanguage = getLanguageTypeFromExtension(fileExtension);
      if (docLanguage === targetLanguage) {
        weight *= 3; // 언어 일치 시 가중치 3배
      }

      // 파일명 유사도에 따른 가중치 부여
      const fileName = item.metadata?.fileName || '';
      const similarity = calculateFileNameSimilarity(fileName, targetFileName);

      // 유사도가 낮을수록(더 비슷할수록) 가중치 높게
      const similarityWeight = Math.max(5 - similarity, 1);
      weight *= similarityWeight;

      return {
        document: item.document,
        weight,
        similarity, // 디버깅용
        language: docLanguage // 디버깅용
      };
    });

    // 가중치 기준으로 내림차순 정렬
    weightedDocs.sort((a, b) => b.weight - a.weight);

    // 정렬된 문서 배열에서 문서만 추출하여 반환
    return weightedDocs.map(item => item.document);
  }

  /**
   * 추출된 언어 타입을 기반으로 사용자 메시지에서 언어를 추정합니다
   */
  private inferLanguageFromMessage(userMessage: string): string {
    const languageKeywords = {
      kotlin: ['kotlin', '.kt', 'suspend', 'val', 'var', 'fun'],
      typescript: ['typescript', '.ts', 'interface', 'type', 'const', 'let'],
      java: ['java', '.java', 'public class', 'extends', 'implements']
    };

    for (const [lang, keywords] of Object.entries(languageKeywords)) {
      if (keywords.some(keyword => userMessage.toLowerCase().includes(keyword.toLowerCase()))) {
        return lang;
      }
    }
    
    return 'unknown';
  }

  /**
   * 파일 경로를 기반으로 검색합니다
   */
  private async searchByExactFilePath(
    filePath: string, 
    limit: number
  ): Promise<SearchResult> {
    try {
      const pathResult = await this.collection!.get({
        where: { filePath: filePath },
        limit
      });

      return this.processSearchResult(pathResult, '파일 경로', filePath);
    } catch (e) {
      this.logger.error('정확한 파일 경로 검색 오류:', (e as Error).message);
      return [];
    }
  }

  /**
   * 언어에 해당하는 확장자 목록을 반환합니다
   */
  private getExtensionsForLanguage(language: string): string[] {
    switch (language.toLowerCase()) {
      case 'kotlin':
        return ['kt', 'kts'];
      case 'typescript':
        return ['ts', 'tsx'];
      case 'javascript':
        return ['js', 'jsx'];
      case 'java':
        return ['java'];
      default:
        return [];
    }
  }

  /**
   * 일반 텍스트 쿼리를 수행합니다
   */
  private async performGeneralQuery(
    queryText: string,
    limit: number
  ): Promise<SearchResult> {
    try {
      const queryResult = await this.collection!.query({
        queryTexts: [queryText],
        nResults: limit,
      });
      
      // 결과 처리
      const documents: SearchResult = [];
      
      if (queryResult.documents[0] && queryResult.documents[0].length > 0) {
        for (let i = 0; i < queryResult.documents[0].length; i++) {
          const doc = queryResult.documents[0][i];
          const metadata = queryResult.metadatas?.[0]?.[i] || {};

          if (doc) {
            documents.push({ document: doc, metadata });
          }
        }
        this.logger.log(`일반 쿼리로 ${queryResult.documents[0].length}개 문서를 찾았습니다.`);
      } else {
        this.logger.log('일반 쿼리로 문서를 찾지 못했습니다.');
      }
      
      return documents;
    } catch (e) {
      this.logger.error('일반 쿼리 검색 오류:', (e as Error).message);
      return [];
    }
  }

  /**
   * 사용자 쿼리에 관련된 코드 컨텍스트를 검색합니다
   */
  async fetchRelevantCodeContext(userMessage: string): Promise<string> {
    this.ensureCollectionInitialized();
    this.logger.log(`userMessage : ${userMessage}`);

    try {
      // 컬렉션에 데이터가 있는지 확인
      const collectionCount = await this.collection!.count();
      this.logger.log(`컬렉션에 ${collectionCount}개의 항목이 있습니다.`);

      if (collectionCount === 0) {
        return "컬렉션에 데이터가 없습니다. 먼저 데이터를 적재해주세요.";
      }

      // 결과를 저장할 배열 (메타데이터 포함)
      const documentsWithMeta: SearchResult = [];

      // 1. 파일 경로 추출 시도
      const filePath = extractFilePath(userMessage);
      let targetLanguage = 'unknown';
      let targetFileName = '';

      if (filePath) {
        this.logger.log(`File Path가 감지되었습니다: ${filePath}`);
        targetLanguage = getLanguageFromFilePath(filePath);
        targetFileName = path.basename(filePath);

        // 파일 경로로 직접 검색
        const filePathResults = await this.searchByFilePathWithMetadata(filePath, 5);
        this.mergeDocumentsWithoutDuplicates(documentsWithMeta, filePathResults);

        // 2. 테스트 키워드가 포함되어 있거나 테스트 파일 검색 요청됨
        if (hasTestKeywords(userMessage) || documentsWithMeta.length === 0) {
          const testPatterns = generateTestFilePatterns(filePath);
          this.logger.log(`테스트 파일 패턴 생성: ${testPatterns.join(', ')}`);

          for (const pattern of testPatterns) {
            const testResults = await this.searchByFileNameWithMetadata(pattern, 10);
            if (testResults.length > 0) {
              this.mergeDocumentsWithoutDuplicates(documentsWithMeta, testResults);
              this.logger.log(`테스트 파일 패턴 '${pattern}'으로 ${testResults.length}개 문서를 찾았습니다.`);
            }
          }
        }
      } else {
        // 파일 경로가 없는 경우, 사용자 메시지에서 언어 타입 추정
        targetLanguage = this.inferLanguageFromMessage(userMessage);
      }

      // 3. 일반 쿼리 시도
      if (documentsWithMeta.length < 5) {
        const queryResults = await this.performGeneralQuery(userMessage, 100);
        this.mergeDocumentsWithoutDuplicates(documentsWithMeta, queryResults);
      }

      // 결과가 없는 경우
      if (documentsWithMeta.length === 0) {
        return "관련 코드 컨텍스트를 찾을 수 없습니다.";
      }

      // 가중치 적용 및 정렬
      const sortedDocuments = this.applyWeightsAndSort(
        documentsWithMeta,
        targetLanguage,
        targetFileName
      );

      // 상위 10개만 반환
      return sortedDocuments.slice(0, 10).join("\n\n");
    } catch (error) {
      this.logger.error('검색 오류:', (error as Error).message);
      return `검색 중 오류가 발생했습니다: ${(error as Error).message}`;
    }
  }

  /**
   * 파일 경로로 관련 코드를 검색합니다 (메타데이터 포함)
   */
  async searchByFilePathWithMetadata(filePath: string, limit = 5): Promise<SearchResult> {
    this.ensureCollectionInitialized();

    try {
      const fileName = path.basename(filePath);

      // 결과를 저장할 배열
      let matchedDocuments: SearchResult = [];

      // 1. 정확한 파일 경로로 검색
      const exactPathResults = await this.searchByExactFilePath(filePath, limit);
      matchedDocuments = [...exactPathResults.filter(it => !it.document.startsWith("import"))];

      // 2. 파일명으로 검색 (이미 찾은 문서가 부족한 경우)
      if (matchedDocuments.length < limit) {
        const nameResults = await this.searchByFileNameWithMetadata(fileName, limit);
        this.mergeDocumentsWithoutDuplicates(matchedDocuments, nameResults);
      }

      return matchedDocuments;
    } catch (error) {
      this.logger.error('파일 경로 검색 오류:', (error as Error).message);
      return [];
    }
  }

  /**
   * 파일명으로 관련 코드를 검색합니다 (메타데이터 포함)
   */
  async searchByFileNameWithMetadata(fileName: string, limit = 5): Promise<SearchResult> {
    this.ensureCollectionInitialized();

    try {
      // 정확한 파일명 일치 검색
      const fileNameResult = await this.collection!.get({
        where: { fileName: fileName },
        limit
      });

      return this.processSearchResult(fileNameResult, '파일명', fileName);
    } catch (error) {
      this.logger.error('파일명 검색 오류:', (error as Error).message);
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
}
