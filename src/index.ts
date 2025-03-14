// code-rag-ollama.ts
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import axios from 'axios';
import { ChromaClient, Collection, Metadata, Metadatas } from 'chromadb';
import CONFIG from './config';

// 인터페이스 정의
interface ChunkMetadata {
  source: string;
  language: string;
  chunkIndex?: number;
  totalChunks?: number;
  fileName?: string;
  filePath?: string;
  [key: string]: any; // 인덱스 시그니처 추가 - ChromaDB 호환성 위해
}

interface Chunk {
  content: string;
  metadata: ChunkMetadata;
}

// 경로에서 틸드(~)를 사용자 홈 디렉토리로 확장
function expandTilde(filePath: string): string {
  if (filePath.startsWith('~/') || filePath === '~') {
    return filePath.replace(/^~/, os.homedir());
  }
  return filePath;
}

// 환경변수 값 로깅 - 원래 경로(틸드 포함)와 확장된 경로 모두 표시
console.log('⚙️ 구성 설정:');
console.log(`- 코드 디렉토리 목록 (원본): ${CONFIG.directoryPaths.join(', ')}`);
// 시스템 경로 표시
const expandedPaths = CONFIG.directoryPaths.map(dir => path.resolve(dir));
console.log(`- 코드 디렉토리 목록 (확장): ${expandedPaths.join(', ')}`);
console.log(`- Ollama 모델: ${CONFIG.ollama.model}`);
console.log(`- 청크 크기: ${CONFIG.chunkSize}`);
console.log(`- 청크 오버랩: ${CONFIG.chunkOverlap}`);
console.log(`- ChromaDB URL: ${CONFIG.chroma.url}`);

// Ollama API를 통해 임베딩 생성
async function generateEmbedding(text: string): Promise<number[]> {
  try {
    const response = await axios.post(`${CONFIG.ollama.baseUrl}/api/embeddings`, {
      model: CONFIG.ollama.embeddingModel,
      prompt: text
    });

    return response.data.embedding;
  } catch (error) {
    console.error('임베딩 생성 중 오류:', (error as Error).message);
    throw error;
  }
}

// ChromaDB 클라이언트 초기화
async function initChromaDB(): Promise<Collection> {
  // Docker에서 실행 중인 ChromaDB 서버에 연결
  console.log(`ChromaDB 서버에 연결 중: ${CONFIG.chroma.url}`);
  const client = new ChromaClient({
    path: CONFIG.chroma.url
  });

  // 커스텀 임베딩 함수 (Ollama 사용)
  const embeddingFunction = {
    generate: async (texts: string[]): Promise<number[][]> => {
      const embeddings: number[][] = [];
      for (const text of texts) {
        const embedding = await generateEmbedding(text);
        embeddings.push(embedding);
      }
      return embeddings;
    }
  };

  try {
    await client.deleteCollection({ name: CONFIG.chroma.collectionName });
    console.log(`기존 컬렉션 삭제: ${CONFIG.chroma.collectionName}`);
  } catch (error) {
    console.log(`컬렉션 삭제 중 오류 (무시됨): ${(error as Error).message}`);
    // 컬렉션이 없는 경우 무시
  }

  // 새 컬렉션 생성
  const collection = await client.createCollection({
    name: CONFIG.chroma.collectionName,
    embeddingFunction
  });

  console.log(`ChromaDB 컬렉션 '${CONFIG.chroma.collectionName}' 생성 완료`);
  return collection;
}

// 파일 내용 읽기
async function readFile(filePath: string): Promise<string | null> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return content;
  } catch (error) {
    console.error(`파일 읽기 오류 (${filePath}):`, (error as Error).message);
    return null;
  }
}

// 디렉토리가 존재하는지 확인
async function directoryExists(dirPath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(dirPath);
    return stats.isDirectory();
  } catch (error) {
    return false;
  }
}

// 디렉토리를 재귀적으로 순회하며 코드 파일 찾기
async function findCodeFiles(dir: string): Promise<string[]> {
  const files: string[] = [];

  try {
    // 경로가 존재하는지 확인
    const exists = await directoryExists(dir);
    if (!exists) {
      console.error(`디렉토리가 존재하지 않습니다: ${dir}`);
      return [];
    }

    async function traverse(currentDir: string): Promise<void> {
      const entries = await fs.readdir(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);

        // 무시할 패턴인지 확인
        if (CONFIG.ignorePatterns.some(pattern => {
          if (pattern.startsWith('*.')) {
            const ext = pattern.replace('*.', '');
            return entry.name.endsWith(`.${ext}`);
          }
          return entry.name === pattern || fullPath.includes(`/${pattern}/`);
        })) {
          continue;
        }

        if (entry.isDirectory()) {
          await traverse(fullPath);
        } else if (CONFIG.allowedExtensions.some(ext => entry.name.endsWith(ext))) {
          files.push(fullPath);
        }
      }
    }

    await traverse(dir);
    return files;
  } catch (error) {
    console.error(`디렉토리 스캔 오류 (${dir}):`, (error as Error).message);
    return [];
  }
}

// 모든 디렉토리에서 코드 파일 찾기
async function findAllCodeFiles(directories: string[]): Promise<string[]> {
  let allFiles: string[] = [];
  
  for (const dir of directories) {
    // 확장된 경로 사용
    const expandedDir = expandTilde(dir);
    console.log(`디렉토리 스캔 중: ${dir} (확장: ${expandedDir})`);
    
    try {
      const dirFiles = await findCodeFiles(expandedDir);
      console.log(`- ${dir}에서 ${dirFiles.length}개 파일 발견`);
      allFiles = [...allFiles, ...dirFiles];
    } catch (error) {
      console.error(`${dir} 디렉토리 처리 중 오류:`, (error as Error).message);
    }
  }
  
  return allFiles;
}

// 텍스트를 청크로 분할
function splitTextIntoChunks(text: string, filepath: string): Chunk[] {
  const lines = text.split('\n');
  const chunks: Chunk[] = [];
  let currentChunk: string[] = [];
  let currentLength = 0;

  for (const line of lines) {
    // 빈 줄은 건너뛰기
    if (line.trim() === '') {
      currentChunk.push(line);
      continue;
    }

    // 현재 청크가 chunkSize를 초과하면 새 청크 시작
    if (currentLength + line.length > CONFIG.chunkSize && currentChunk.length > 0) {
      chunks.push({
        content: currentChunk.join('\n'),
        metadata: {
          source: filepath,
          language: path.extname(filepath).substring(1),
        }
      });

      // 청크 오버랩 적용
      const overlapLines = currentChunk.slice(-Math.floor(currentChunk.length * (CONFIG.chunkOverlap / currentLength)));
      currentChunk = [...overlapLines, line];
      currentLength = overlapLines.join('\n').length + line.length;
    } else {
      currentChunk.push(line);
      currentLength += line.length;
    }
  }

  // 마지막 청크 추가
  if (currentChunk.length > 0) {
    chunks.push({
      content: currentChunk.join('\n'),
      metadata: {
        source: filepath,
        language: path.extname(filepath).substring(1),
      }
    });
  }

  return chunks;
}

// 메인 함수
async function main(): Promise<void> {
  try {
    // 환경변수가 제대로 설정되었는지 확인 (CONFIG 사용)
    if (CONFIG.directoryPaths.length === 0 || 
        (CONFIG.directoryPaths.length === 1 && CONFIG.directoryPaths[0] === './your-codebase-directory')) {
      console.warn('⚠️ 경고: DIRECTORY_PATHS 환경변수가 설정되지 않았습니다. 기본값을 사용합니다.');
    }

    console.log('📚 코드 파일 검색 중...');
    // 모든 디렉토리에서 코드 파일 찾기
    const codeFiles = await findAllCodeFiles(CONFIG.directoryPaths);
    console.log(`총 ${codeFiles.length}개의 코드 파일을 찾았습니다.`);

    if (codeFiles.length === 0) {
      console.warn('⚠️ 경고: 처리할 코드 파일이 없습니다. 디렉토리 경로를 확인하세요.');
      process.exit(0);
    }

    // ChromaDB 초기화
    const collection = await initChromaDB();
    console.log(`ChromaDB 컬렉션 연결: ${CONFIG.chroma.collectionName}`);

    // 각 파일 처리
    let processedChunks = 0;
    let totalFiles = codeFiles.length;

    for (let i = 0; i < codeFiles.length; i++) {
      const filePath = codeFiles[i];
      console.log(`파일 처리 중 (${i + 1}/${totalFiles}): ${filePath}`);

      // 파일 내용 읽기
      const content = await readFile(filePath);
      if (!content) continue;

      // 텍스트를 청크로 분할
      const chunks = splitTextIntoChunks(content, filePath);

      // 청크 처리를 위한 배열 준비
      const ids: string[] = [];
      const documents: string[] = [];
      const metadatas: Record<string, any>[] = []; // ChromaDB와 호환되는 타입으로 변경

      // 각 청크 처리
      for (let j = 0; j < chunks.length; j++) {
        const chunk = chunks[j];

        // 고유 ID 생성
        const id = `${path.basename(filePath)}_chunk_${j}_${Date.now()}`;
        ids.push(id);

        // 문서 내용
        documents.push(chunk.content);

        // 메타데이터 - Record<string, any> 타입으로 캐스팅
        metadatas.push({
          ...chunk.metadata,
          chunkIndex: j,
          totalChunks: chunks.length,
          fileName: path.basename(filePath),
          filePath: filePath,
        });

        processedChunks++;
      }

      // 청크를 한 번에 ChromaDB에 저장
      if (ids.length > 0) {
        await collection.add({
          ids: ids,
          documents: documents,
          metadatas: metadatas
        });
      }

      // 진행 상황 표시
      if ((i + 1) % 10 === 0 || i === codeFiles.length - 1) {
        console.log(`진행 상황: ${i + 1}/${totalFiles} 파일 처리됨.`);
      }
    }

    console.log(`✅ 총 ${codeFiles.length}개 파일, ${processedChunks}개 청크 처리 완료.`);

  } catch (error) {
    console.error('❌ 오류:', error);
    process.exit(1);
  }
}

// 스크립트 실행
main();
