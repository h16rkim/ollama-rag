// code-rag-ollama.js
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const { ChromaClient, OpenAIEmbeddingFunction } = require('chromadb');
const CONFIG = require('./config');

// 환경변수 값 로깅
console.log('⚙️ 구성 설정:');
console.log(`- 코드 디렉토리: ${CONFIG.directoryPath}`);
console.log(`- 벡터 DB 경로: ${CONFIG.vectorDbPath}`);
console.log(`- Ollama 모델: ${CONFIG.ollama.model}`);
console.log(`- 청크 크기: ${CONFIG.chunkSize}`);
console.log(`- 청크 오버랩: ${CONFIG.chunkOverlap}`);

// Ollama API를 통해 임베딩 생성
async function generateEmbedding(text) {
  try {
    const response = await axios.post(`${CONFIG.ollama.baseUrl}/api/embeddings`, {
      model: CONFIG.ollama.embeddingModel,
      prompt: text
    });

    return response.data.embedding;
  } catch (error) {
    console.error('임베딩 생성 중 오류:', error.message);
    throw error;
  }
}

// ChromaDB 클라이언트 초기화
async function initChromaDB() {
  const client = new ChromaClient();

  // 커스텀 임베딩 함수 (Ollama 사용)
  const embeddingFunction = {
    generate: async (texts) => {
      const embeddings = [];
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
    // 컬렉션이 없는 경우 무시
  }

  // 새 컬렉션 생성
  const collection = await client.createCollection({
    name: CONFIG.chroma.collectionName,
    embeddingFunction
  });

  return collection;
}

// 파일 내용 읽기
async function readFile(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return content;
  } catch (error) {
    console.error(`파일 읽기 오류 (${filePath}):`, error.message);
    return null;
  }
}

// 디렉토리를 재귀적으로 순회하며 코드 파일 찾기
async function findCodeFiles(dir) {
  const files = [];

  async function traverse(currentDir) {
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
}

// 텍스트를 청크로 분할
function splitTextIntoChunks(text, filepath) {
  const lines = text.split('\n');
  const chunks = [];
  let currentChunk = [];
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

// Ollama API로 쿼리 보내기
async function queryOllama(query, contexts) {
  try {
    // 컨텍스트에서 가장 관련성 높은 코드 예제 추출
    const relevantContext = contexts.join("\n\n");

    // Ollama 프롬프트 구성
    const systemPrompt = `당신은 코딩 스타일을 학습하고 비슷한 스타일로 코드를 생성하는 전문 코딩 어시스턴트입니다. 
다음 코드 예제들을 참고하여 사용자가 요청한 코드를 생성하세요. 사용자의 코딩 스타일과 패턴을 최대한 반영해야 합니다.`;

    // Ollama API 호출
    const response = await axios.post(`${CONFIG.ollama.baseUrl}/api/chat`, {
      model: CONFIG.ollama.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `다음은 내가 작성한 코드 예제들입니다:\n\n${relevantContext}\n\n이 코드 스타일을 참고하여 다음 요청에 맞는 코드를 작성해주세요: ${query}` }
      ],
      stream: false
    });

    return response.data.message.content;
  } catch (error) {
    console.error('Ollama 쿼리 중 오류:', error.message);
    return "Ollama 응답 오류 발생";
  }
}

// 메인 함수
async function main() {
  try {
    // 환경변수가 제대로 설정되었는지 확인 (CONFIG 사용)
    if (CONFIG.directoryPath === './your-codebase-directory') {
      console.warn('⚠️ 경고: directoryPath가 기본값으로 설정되어 있습니다. 환경변수 DIRECTORY_PATH를 설정하세요.');
    }

    if (CONFIG.vectorDbPath === './chroma-db') {
      console.warn('⚠️ 경고: vectorDbPath가 기본값으로 설정되어 있습니다. 환경변수 VECTOR_DB_PATH를 설정하세요.');
    }

    console.log('📚 코드 파일 검색 중...');
    const codeFiles = await findCodeFiles(CONFIG.directoryPath);
    console.log(`총 ${codeFiles.length}개의 코드 파일을 찾았습니다.`);

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
      const ids = [];
      const documents = [];
      const metadatas = [];

      // 각 청크 처리
      for (let j = 0; j < chunks.length; j++) {
        const chunk = chunks[j];

        // 고유 ID 생성
        const id = `${path.basename(filePath)}_chunk_${j}`;
        ids.push(id);

        // 문서 내용
        documents.push(chunk.content);

        // 메타데이터
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

    // 쿼리 테스트 (환경변수로 제어 가능)
    if (process.env.RUN_TEST_QUERY === 'true') {
      const testQuery = process.env.TEST_QUERY || "api를 구현하는 방법";
      console.log(`\n테스트 쿼리: "${testQuery}"`);

      const queryResult = await collection.query({
        queryTexts: [testQuery],
        nResults: 3
      });

      console.log("검색 결과:");
      for (let i = 0; i < queryResult.documents[0].length; i++) {
        console.log(`\n--- 결과 ${i + 1} ---`);
        console.log(`출처: ${queryResult.metadatas[0][i].filePath}`);
        console.log(`언어: ${queryResult.metadatas[0][i].language}`);
        console.log("내용 미리보기:");
        console.log(queryResult.documents[0][i].substring(0, 200) + "...");
      }

      // Ollama로 쿼리 테스트
      console.log("\nOllama로 쿼리 테스트 중...");
      const ollamaResponse = await queryOllama(testQuery, queryResult.documents[0]);
      console.log("\n--- Ollama 응답 ---");
      console.log(ollamaResponse);
    }

  } catch (error) {
    console.error('❌ 오류:', error);
    process.exit(1);
  }
}

// 스크립트 실행
main();
