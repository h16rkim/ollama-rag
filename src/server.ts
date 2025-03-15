// ollama-code-server.ts
import express, { Request, Response } from 'express';
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

interface OllamaResponseMessage {
  role: string;
  content: string;
}

interface OllamaResponse {
  message: OllamaResponseMessage;
}

interface OpenAIResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: {
    index: number;
    message: OllamaResponseMessage;
    finish_reason: string;
  }[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// ChromaDB와 호환 가능한 메타데이터 타입
interface ChromaMetadata {
  [key: string]: any;
}

const app = express();

// 미들웨어 설정
app.use(cors());
app.use(express.json());

// Ollama 임베딩 함수
async function generateEmbedding(text: string): Promise<number[]> {
  try {
    const response = await axios.post(`${CONFIG.ollama.baseUrl}/api/embeddings`, {
      model: CONFIG.ollama.embeddingModel,
      prompt: text
    });
    return response.data.embedding;
  } catch (error) {
    console.error('임베딩 생성 오류:', (error as Error).message);
    throw error;
  }
}

// ChromaDB 초기화
let collection: Collection | null = null;
async function initChromaDB(): Promise<void> {
  // Docker에서 실행 중인 ChromaDB 서버에 연결
  console.log(`ChromaDB 서버에 연결 중: ${CONFIG.chroma.url}`);
  const client = new ChromaClient({
    path: CONFIG.chroma.url
  });

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

// Ollama 인터페이스 API
app.post('/v1/chat/completions', async (req: Request, res: Response) => {
  try {
    const { messages, model } = req.body as ChatRequest;

    // 사용자 메시지 추출
    const userMessage = messages.find(m => m.role === 'user')?.content || '';

    if (!collection) {
      return res.status(500).json({ error: '벡터 DB가 초기화되지 않았습니다' });
    }

    // 벡터 DB에서 관련 코드 검색
    const queryResult = await collection.query({
      queryTexts: [userMessage],
      nResults: 5
    });

    // 관련 코드를 컨텍스트로 추가
    const codeContext = queryResult.documents[0].join("\n\n");

    // 시스템 메시지 추가 또는 강화
    let systemMessage = messages.find(m => m.role === 'system');
    let updatedMessages = [...messages];

    if (systemMessage) {
      // 기존 시스템 메시지 강화
      const enhancedSystemMessage: ChatMessage = {
        ...systemMessage,
        content: `${systemMessage.content}\n\n다음은 개발자의 코드 예제들입니다. 이 스타일을 참고하세요:\n\n${codeContext}`
      };

      // 기존 시스템 메시지 교체
      updatedMessages = updatedMessages.map(m =>
        m.role === 'system' ? enhancedSystemMessage : m
      );
    } else {
      // 시스템 메시지가 없으면 새로 추가
      const newSystemMessage: ChatMessage = {
        role: 'system',
        content: `당신은 특정 개발자의 코딩 스타일을 학습한 코딩 어시스턴트입니다. 다음 코드 예제들의 스타일을 참고하세요:\n\n${codeContext}`
      };

      // 시스템 메시지를 맨 앞에 추가
      updatedMessages = [newSystemMessage, ...updatedMessages];
    }


    // Ollama API 호출
    const ollamaResponse = await axios.post<OllamaResponse>(`${CONFIG.ollama.baseUrl}/api/chat`, {
      // 모델이 gpt-4 로 와서 강제로 qwen 사용하도록 수정
      // model: model || CONFIG.ollama.model,
      model: CONFIG.ollama.model,
      messages: updatedMessages,
      stream: false
    });

    // Ollama 응답을 OpenAI 형식으로 변환
    const formattedResponse: OpenAIResponse = {
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: model || CONFIG.ollama.model,
      choices: [
        {
          index: 0,
          message: ollamaResponse.data.message,
          finish_reason: 'stop'
        }
      ],
      usage: {
        prompt_tokens: -1,
        completion_tokens: -1,
        total_tokens: -1
      }
    };

    res.header('Content-Type', 'application/json')
    res.json(formattedResponse);
  } catch (error: any) {
    console.error('API 오류:', (error as Error).message);
    console.error(error)
    res.status(500).json({ error: '서버 오류', details: (error as Error).message });
  }
});

// 서버 시작
async function startServer(): Promise<void> {
  try {
    await initChromaDB();

    app.listen(CONFIG.serverPort, () => {
      console.log(`OpenAI 호환 API 서버가 http://localhost:${CONFIG.serverPort}에서 실행 중입니다`);
      console.log(`이 서버는 Jetbrains AI Assistant와 연동할 수 있습니다.`);
      console.log(`ChromaDB 연결: ${CONFIG.chroma.url}, 컬렉션: ${CONFIG.chroma.collectionName}`);
    });
  } catch (error) {
    console.error('서버 초기화 오류:', (error as Error).message);
    process.exit(1);
  }
}

startServer();
