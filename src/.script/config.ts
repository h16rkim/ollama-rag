// config.ts - 통합 설정 파일
import * as os from 'os';
import * as path from 'path';

export interface ChromaConfig {
  collectionName: string;
  host: string;
  port: number | string;
  url: string;
}

export interface OllamaConfig {
  baseUrl: string;
  model: string;
  embeddingModel: string;
}

export interface AppConfig {
  directoryPaths: string[];
  serverPort: number;
  ignorePatterns: string[];
  allowedExtensions: string[];
  chroma: ChromaConfig;
  ollama: OllamaConfig;
  chunkSize: number;
  chunkOverlap: number;
}

// 경로에서 틸드(~)를 사용자 홈 디렉토리로 확장
function expandTilde(filePath: string): string {
  if (filePath.startsWith('~/') || filePath === '~') {
    return filePath.replace(/^~/, os.homedir());
  }
  return filePath;
}

// 환경변수에서 디렉토리 경로 리스트 가져오기
function getDirectoryPaths(): string[] {
  const dirPathsStr = process.env.DIRECTORY_PATHS;

  if(!dirPathsStr) {
    throw new Error("DIRECTORY_PATHS 를 입력하세요. ex)~/path1,~/path2")
  }

  // 쉼표로 구분된 경로 목록을 배열로 분할하고 틸드 확장
  return dirPathsStr.split(',')
    .map(path => path.trim())
    .map(expandTilde);
}

const CONFIG: AppConfig = {
  // 벡터화할 코드가 있는 디렉토리 경로 리스트 (환경변수에서 가져옴)
  directoryPaths: getDirectoryPaths(),
  // 서버 포트
  serverPort: parseInt(process.env.PORT || '3000'),
  // 무시할 파일/폴더 패턴
  ignorePatterns: [
    'node_modules',
    'scripts',
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

export default CONFIG;
