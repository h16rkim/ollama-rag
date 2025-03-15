// src/config/config.service.ts
import { Injectable } from '@nestjs/common';
import * as os from 'os';
import * as path from 'path';
import { AppConfig, ChromaConfig, OllamaConfig } from './config.interface';

@Injectable()
export class ConfigService {
  private readonly config: AppConfig;

  constructor() {
    this.config = this.loadConfig();
  }

  /**
   * 설정 정보를 로드합니다
   */
  private loadConfig(): AppConfig {
    return {
      // 서버 포트
      serverPort: parseInt(process.env.PORT || '3000'),
      
      // 무시할 파일/폴더 패턴
      ignorePatterns: [
        'node_modules',
        '.gradle',
        '.git',
        '.husky',
        '.idea',
        '.vscode',
        'env',
        'dist',
        'build',
        '.env',
        '*.log',
        '*.lock',
        'package-lock.json',
        '.json', '.yaml', '.yml'
      ],
      
      // 처리할 파일 확장자 (TypeScript, Kotlin, Java 중심)
      allowedExtensions: [
        '.ts', '.tsx', '.js', '.jsx',
        '.kt', '.java',
      ],
      
      // ChromaDB 설정
      chroma: {
        collectionName: process.env.COLLECTION_NAME || 'code_farm',
        host: process.env.CHROMA_HOST || 'localhost',
        port: process.env.CHROMA_PORT || 8000,
        // Docker 컨테이너에서 실행 중인 ChromaDB 서버에 연결
        url: process.env.CHROMA_URL || 'http://localhost:8000'
      },
      
      // Ollama 설정
      ollama: {
        baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
        model: process.env.OLLAMA_MODEL || 'qwen2.5-coder:7b-instruct-q4_K_M',
        embeddingModel: process.env.OLLAMA_EMBEDDING_MODEL || 'qwen2.5-coder:7b-instruct-q4_K_M'
      },
      
      // 텍스트 분할 설정
      chunkSize: parseInt(process.env.CHUNK_SIZE || '1000'),
      chunkOverlap: parseInt(process.env.CHUNK_OVERLAP || '200')
    };
  }


  /**
   * 경로에서 틸드(~)를 사용자 홈 디렉토리로 확장합니다
   */
  private expandTilde(filePath: string): string {
    if (filePath.startsWith('~/') || filePath === '~') {
      return filePath.replace(/^~/, os.homedir());
    }
    return filePath;
  }

  /**
   * 설정 값을 가져옵니다
   */
  get<K extends keyof AppConfig>(key: K): AppConfig[K] {
    return this.config[key];
  }

  /**
   * 전체 설정을 가져옵니다
   */
  getConfig(): AppConfig {
    return this.config;
  }
}
