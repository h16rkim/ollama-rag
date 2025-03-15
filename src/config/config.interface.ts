// src/config/config.interface.ts

// ChromaDB 설정 인터페이스
export interface ChromaConfig {
  collectionName: string;
  host: string;
  port: number | string;
  url: string;
}

// Ollama 설정 인터페이스
export interface OllamaConfig {
  baseUrl: string;
  model: string;
  embeddingModel: string;
}

// 애플리케이션 설정 인터페이스
export interface AppConfig {
  serverPort: number;
  ignorePatterns: string[];
  allowedExtensions: string[];
  chroma: ChromaConfig;
  ollama: OllamaConfig;
  chunkSize: number;
  chunkOverlap: number;
}
