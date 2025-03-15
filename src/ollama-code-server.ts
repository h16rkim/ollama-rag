// ollama-code-server.ts
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
  stream?: boolean;
  options?: any;
}

interface GenerateRequest {
  model?: string;
  prompt: string;
  system?: string;
  template?: string;
  context?: string[];
  options?: {
    temperature?: number;
    top_p?: number;
    top_k?: number;
    num_predict?: number;
    stop?: string[];
  };
  stream?: boolean;
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
 * 프롬프트에 코드 컨텍스트를 추가합니다.
 */
async function enhancePromptWithCodeContext(prompt: string): Promise<string> {
  const codeContext = await fetchRelevantCodeContext(prompt);
  return `다음은 개발자의 코드 예제들입니다. 이 스타일을 참고하세요:\n\n${codeContext}\n\n프롬프트: ${prompt}`;
}

/**
 * 스트림 응답을 그대로 전달합니다.
 */
function passRawStream(
  stream: any,
  res: Response
): void {
  stream.data.on('data', (chunk: Buffer) => {
    try {
      const jsonString = chunk.toString().trim();
      if (!jsonString) return;

      // Ollama 응답을 그대로 전달
      res.write(jsonString + '\n');
    } catch (error) {
      console.error("스트리밍 데이터 처리 중 오류:", error);
    }
  });

  stream.data.on('end', () => {
    res.end();
  });
}

/**
 * 채팅 API 엔드포인트 핸들러 (Ollama 원본 형식)
 */
app.post('/api/chat', async (req: Request, res: Response) => {
  try {
    const { messages, model, stream = false, options } = req.body as ChatRequest;
    const userMessage = messages.find(m => m.role === 'user')?.content || '';
    const modelToUse = model || CONFIG.ollama.model;

    if (!collection) {
      return res.status(500).json({ error: '벡터 DB가 초기화되지 않았습니다' });
    }

    // 벡터 DB에서 관련 코드 검색
    const codeContext = await fetchRelevantCodeContext(userMessage);

    // 관련 코드를 컨텍스트로 추가
    const updatedMessages = updateMessagesWithContext(messages, codeContext);

    // 요청 데이터 구성
    const requestData: any = {
      model: modelToUse,
      messages: updatedMessages,
      stream
    };

    // 옵션이 있으면 추가
    if (options) {
      requestData.options = options;
    }

    console.log(`/api/chat 요청: ${modelToUse}, 스트리밍: ${stream}`);

    // 스트리밍 모드
    if (stream) {
      // 응답 헤더 설정
      res.setHeader('Content-Type', 'application/x-ndjson');
      
      // Ollama API 요청 (스트리밍 모드)
      const ollamaStream = await axios.post(
        `${CONFIG.ollama.baseUrl}/api/chat`, 
        requestData, 
        { responseType: 'stream' }
      );
      
      // 스트림 데이터 그대로 전달
      passRawStream(ollamaStream, res);
    } 
    // 비스트리밍 모드
    else {
      // Ollama API 요청
      const response = await axios.post(
        `${CONFIG.ollama.baseUrl}/api/chat`, 
        requestData
      );
      
      // Ollama 응답 그대로 반환
      res.json(response.data);
    }
  } catch (error: any) {
    console.error('Chat API 오류:', error.message);
    res.status(500).json({ error: '서버 오류', details: error.message });
  }
});

/**
 * Generate API 엔드포인트 핸들러 (Ollama 원본 형식)
 */
app.post('/api/generate', async (req: Request, res: Response) => {
  try {
    const { model, prompt, system, template, context, options, stream = false } = req.body as GenerateRequest;
    
    if (!prompt) {
      return res.status(400).json({ error: '프롬프트가 필요합니다' });
    }

    const modelToUse = model || CONFIG.ollama.model;
    
    let enhancedPrompt = prompt;
    
    // 벡터 DB가 초기화되어 있으면 코드 컨텍스트 추가
    if (collection) {
      try {
        enhancedPrompt = await enhancePromptWithCodeContext(prompt);
      } catch (error) {
        console.warn('코드 컨텍스트 추가 실패, 원본 프롬프트 사용:', error);
      }
    }
    
    // 요청 데이터 구성
    const requestData: any = {
      model: modelToUse,
      prompt: enhancedPrompt,
      stream
    };
    
    // 옵션이 있으면 추가
    if (options) {
      requestData.options = options;
    }
    
    // 시스템 프롬프트가 있으면 추가
    if (system) {
      requestData.system = system;
    }
    
    // 템플릿이 있으면 추가
    if (template) {
      requestData.template = template;
    }
    
    // 컨텍스트가 있으면 추가
    if (context) {
      requestData.context = context;
    }
    
    console.log(`/api/generate 요청: ${modelToUse}, 스트리밍: ${stream}`);
    
    // 스트리밍 모드
    if (stream) {
      // 응답 헤더 설정
      res.setHeader('Content-Type', 'application/x-ndjson');
      
      try {
        // Ollama API 요청 (스트리밍 모드)
        const ollamaStream = await axios.post(
          `${CONFIG.ollama.baseUrl}/api/generate`, 
          requestData, 
          { 
            responseType: 'stream',
            timeout: 30000,
            validateStatus: (status) => true // 모든 상태 코드 허용
          }
        );
        
        // 스트림 데이터 그대로 전달
        passRawStream(ollamaStream, res);
      } catch (error: any) {
        console.error('Generate API 스트리밍 오류:', error);
        if (error.response) {
          console.error('응답 데이터:', error.response.data);
          console.error('응답 상태:', error.response.status);
          console.error('응답 헤더:', error.response.headers);
        }
        res.status(500).json({ error: '스트림 처리 중 오류가 발생했습니다.', details: error.message });
      }
    } 
    // 비스트리밍 모드
    else {
      try {
        // Ollama API 요청
        const response = await axios.post(
          `${CONFIG.ollama.baseUrl}/api/generate`, 
          requestData,
          {
            timeout: 30000,
            validateStatus: (status) => true // 모든 상태 코드 허용
          }
        );
        
        console.log('응답 상태 코드:', response.status);
        
        // Ollama 응답 그대로 반환
        res.json(response.data);
      } catch (error: any) {
        console.error('Generate API 요청 오류:', error);
        if (error.response) {
          console.error('응답 데이터:', error.response.data);
          console.error('응답 상태:', error.response.status);
        }
        res.status(500).json({ error: '요청 처리 중 오류가 발생했습니다.', details: error.message });
      }
    }
  } catch (error: any) {
    console.error('Generate API 오류:', error.message);
    res.status(500).json({ error: '서버 오류', details: error.message });
  }
});

/**
 * 임베딩 API 엔드포인트 핸들러
 */
app.post('/api/embeddings', async (req: Request, res: Response) => {
  try {
    const { model, prompt } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: '프롬프트가 필요합니다' });
    }

    const modelToUse = model || CONFIG.ollama.embeddingModel;

    // Ollama API로 임베딩 요청 전달
    const response = await axios.post(
      `${CONFIG.ollama.baseUrl}/api/embeddings`,
      {
        model: modelToUse,
        prompt
      }
    );

    // Ollama 응답 그대로 반환
    res.json(response.data);
  } catch (error: any) {
    console.error('Embeddings API 오류:', error.message);
    res.status(500).json({ error: '서버 오류', details: error.message });
  }
});

// 서버 시작
async function startServer(): Promise<void> {
  try {
    await initChromaDB();

    app.listen(CONFIG.serverPort, () => {
      console.log(`Ollama 프록시 서버가 http://localhost:${CONFIG.serverPort}에서 실행 중`);
      console.log(`지원 엔드포인트: /api/chat, /api/generate, /api/embeddings`);
    });
  } catch (error) {
    console.error('서버 초기화 오류:', (error as Error).message);
    process.exit(1);
  }
}

startServer();
