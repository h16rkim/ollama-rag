// ollama-code-server.ts (stream 모드 추가)
import express, {query, Request, Response} from 'express';
import axios from 'axios';
import { ChromaClient, Collection } from 'chromadb';
import cors from 'cors';
import CONFIG from './config';

// 인터페이스 정의
interface ChatMessage {
  role: string;
  content: string;
}

interface ChatRequest {
  messages: ChatMessage[];
  model?: string;
}

interface OpenAIResponseChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: {
    index: number;
    delta: {
      content?: string;
    };
    finish_reason: string | null;
  }[];
}

const app = express();

// 미들웨어 설정
app.use(cors());
app.use(express.json());

// ChromaDB 초기화
let collection: Collection | null = null;

async function initChromaDB(): Promise<void> {
  console.log(`ChromaDB 서버에 연결 중: ${CONFIG.chroma.url}`);
  const client = new ChromaClient({
    path: CONFIG.chroma.url
  });

  const embeddingFunction = {
    generate: async (texts: string[]): Promise<number[][]> => {
      return Promise.all(texts.map(async text => {
        const response = await axios.post(`${CONFIG.ollama.baseUrl}/api/embeddings`, {
          model: CONFIG.ollama.embeddingModel,
          prompt: text
        });
        return response.data.embedding;
      }));
    }
  };

  try {
    collection = await client.getCollection({
      name: CONFIG.chroma.collectionName,
      embeddingFunction
    });
    console.log(`컬렉션 "${CONFIG.chroma.collectionName}" 연결됨`);
  } catch (error) {
    console.error('컬렉션 초기화 오류:', (error as Error).message);
    throw error;
  }
}

/**
 * 사용자 쿼리에 관련된 코드 컨텍스트를 검색합니다.
 */
async function fetchRelevantCodeContext(userMessage: string): Promise<string> {
  if (!collection) {
    throw new Error('벡터 DB가 초기화되지 않았습니다');
  }
  
  const queryResult = await collection.query({
    queryTexts: [userMessage],
    nResults: 5
  });
  
  return queryResult.documents[0].join("\n\n");
}

/**
 * 코드 컨텍스트를 포함하도록 메시지를 업데이트합니다.
 */
function updateMessagesWithContext(messages: ChatMessage[], codeContext: string): ChatMessage[] {
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
 * OpenAI 호환 응답 청크를 생성합니다.
 */
function createOpenAIResponseChunk(
  responseId: string, 
  createdTimestamp: number, 
  model: string, 
  content?: string, 
  isComplete: boolean = false
): OpenAIResponseChunk {
  return {
    id: responseId,
    object: "chat.completion.chunk",
    created: createdTimestamp,
    model: model,
    choices: [
      {
        index: 0,
        delta: content ? { content } : {},
        finish_reason: isComplete ? "stop" : null
      }
    ]
  };
}

/**
 * Ollama 응답 스트림을 처리합니다.
 */
function handleOllamaStream(
  stream: any, 
  res: Response, 
  responseId: string, 
  createdTimestamp: number, 
  model: string
): void {
  // 데이터 스트림 변환 및 전송
  stream.data.on('data', (chunk: Buffer) => {
    try {
      const jsonString = chunk.toString().trim();
      if (!jsonString) return; // 빈 데이터 방지

      // Ollama의 메시지 구조를 OpenAI 형식으로 변환
      const parsedData = JSON.parse(jsonString);
      if (!parsedData.message?.content) return; // 유효한 메시지가 아닐 경우 무시

      const openAIFormattedResponse = createOpenAIResponseChunk(
        responseId, 
        createdTimestamp, 
        model, 
        parsedData.message.content
      );

      // OpenAI 스트리밍 형식으로 전송
      const responseChunk = `data: ${JSON.stringify(openAIFormattedResponse)}\n\n`;
      console.log(responseChunk); // 디버깅용

      res.write(responseChunk);
    } catch (error) {
      console.error("스트리밍 데이터 처리 중 오류:", error);
    }
  });

  // 스트리밍 종료 감지
  stream.data.on('end', () => {
    const doneMessage = createOpenAIResponseChunk(
      responseId, 
      createdTimestamp, 
      model, 
      undefined, 
      true
    );

    res.write(`data: ${JSON.stringify(doneMessage)}\n\n`);
    res.write("data: [DONE]\n\n");
    res.end();
  });
}

/**
 * 채팅 완성 API 엔드포인트 핸들러
 */
app.post('/v1/chat/completions', async (req: Request, res: Response) => {
  try {
    const { messages, model } = req.body as ChatRequest;
    const userMessage = messages.find(m => m.role === 'user')?.content || '';
    const modelToUse = model || CONFIG.ollama.model;

    if (!collection) {
      return res.status(500).json({ error: '벡터 DB가 초기화되지 않았습니다' });
    }

    // 벡터 DB에서 관련 코드 검색
    const codeContext = await fetchRelevantCodeContext(userMessage);

    // 관련 코드를 컨텍스트로 추가
    const updatedMessages = updateMessagesWithContext(messages, codeContext);

    // 스트리밍 응답 설정 (필수 헤더)
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    console.log("요청 보내기");

    // Ollama API 요청 (스트리밍 모드)
    const stream = await axios.post(`${CONFIG.ollama.baseUrl}/api/chat`, {
      model: modelToUse,
      messages: updatedMessages,
      stream: true
    }, { responseType: 'stream' });

    // OpenAI 호환 ID 생성
    const responseId = `chatcmpl-${Date.now()}`;
    const createdTimestamp = Math.floor(Date.now() / 1000);

    // 스트림 처리 시작
    handleOllamaStream(stream, res, responseId, createdTimestamp, modelToUse);

  } catch (error: any) {
    console.error('API 오류:', error.message);
    res.status(500).json({ error: '서버 오류', details: error.message });
  }
});

// 서버 시작
async function startServer(): Promise<void> {
  try {
    await initChromaDB();

    app.listen(CONFIG.serverPort, () => {
      console.log(`OpenAI 호환 API 서버가 http://localhost:${CONFIG.serverPort}에서 실행 중 (Stream Mode)`);
    });
  } catch (error) {
    console.error('서버 초기화 오류:', (error as Error).message);
    process.exit(1);
  }
}

startServer();
