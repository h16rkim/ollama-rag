// config.js - 통합 설정 파일

const CONFIG = {
  // 벡터화할 코드가 있는 디렉토리 경로 (환경변수에서 가져옴)
  directoryPath: process.env.DIRECTORY_PATH || './your-codebase-directory',
  // 벡터 DB 경로
  vectorDbPath: process.env.VECTOR_DB_PATH || './chroma-db',
  // 서버 포트
  serverPort: parseInt(process.env.PORT || '3000'),
  // 무시할 파일/폴더 패턴
  ignorePatterns: [
    'node_modules',
    '.git',
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
  // ChromaDB 설정 (환경변수에서 가져옴)
  chroma: {
    collectionName: process.env.COLLECTION_NAME || 'code_farm',
    // vectorDbPath 참조
    get path() { return CONFIG.vectorDbPath; }
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

module.exports = CONFIG;
