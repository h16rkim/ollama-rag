// ollama-code-server.js
const express = require('express');
const axios = require('axios');
const { ChromaClient } = require('chromadb');
const cors = require('cors');
const CONFIG = require('./config');

const app = express();

// 미들웨어 설정
app.use(cors());
app.use(express.json());

// Ollama 임베딩 함수
async function generateEmbedding(text) {
  try {
    const response = await axios.post(`${CONFIG.ollama.baseUrl}/api/embeddings`, {
      model: CONFIG.ollama.embeddingModel,
      prompt: text
    });
    return response.data.embedding;
  } catch (error) {
    console.error('임베딩 생성 오류:', error.message);
    throw error;
  }
}

// ChromaDB 초기화
let collection = null;
async function initChromaDB() {
  // Docker에서 실행 중인 ChromaDB 서버에 연결
  console.log(`ChromaDB 서버에 연결 중: ${CONFIG.chroma.url}`);
  const client = new ChromaClient({
    path: CONFIG.chroma.url
  });

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
    collection = await client.getCollection({
      name: CONFIG.chroma.collectionName,
      embeddingFunction
    });
    console.log(`컬렉션 "${CONFIG.chroma.collectionName}" 연결됨`);
  } catch (error) {
    console.error('컬렉션 초기화 오류:', error.message);
    throw error;
  }
}

// Ollama 인터페이스 API
app.post('/v1/chat/completions', async (req, res) => {
  try {
    const { messages, model } = req.body;

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
      const enhancedSystemMessage = {
        ...systemMessage,
        content: `${systemMessage.content}\n\n다음은 개발자의 코드 예제들입니다. 이 스타일을 참고하세요:\n\n${codeContext}`
      };

      // 기존 시스템 메시지 교체
      updatedMessages = updatedMessages.map(m =>
        m.role === 'system' ? enhancedSystemMessage : m
      );
    } else {
      // 시스템 메시지가 없으면 새로 추가
      const newSystemMessage = {
        role: 'system',
        content: `당신은 특정 개발자의 코딩 스타일을 학습한 코딩 어시스턴트입니다. 다음 코드 예제들의 스타일을 참고하세요:\n\n${codeContext}`
      };

      // 시스템 메시지를 맨 앞에 추가
      updatedMessages = [newSystemMessage, ...updatedMessages];
    }

    // Ollama API 호출
    const ollamaResponse = await axios.post(`${CONFIG.ollama.baseUrl}/api/chat`, {
      model: CONFIG.ollama.model,
      messages: updatedMessages,
      stream: false
    });

    // Ollama 응답을 OpenAI 형식으로 변환
    const formattedResponse = {
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: CONFIG.ollama.model,
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

    res.json(formattedResponse);
  } catch (error) {
    console.error('API 오류:', error.message);
    res.status(500).json({ error: '서버 오류', details: error.message });
  }
});

// 서버 시작
async function startServer() {
  try {
    await initChromaDB();

    app.listen(CONFIG.serverPort, () => {
      console.log(`OpenAI 호환 API 서버가 http://localhost:${CONFIG.serverPort}에서 실행 중입니다`);
      console.log(`이 서버는 Jetbrains AI Assistant와 연동할 수 있습니다.`);
      console.log(`ChromaDB 연결: ${CONFIG.chroma.url}, 컬렉션: ${CONFIG.chroma.collectionName}`);
    });
  } catch (error) {
    console.error('서버 초기화 오류:', error.message);
    process.exit(1);
  }
}

startServer();
