// src/common/interfaces/ollama.interface.ts

// 채팅 메시지 인터페이스
export interface ChatMessage {
  role: string;
  content: string;
}

// 채팅 요청 인터페이스
export interface ChatRequest {
  messages: ChatMessage[];
  model?: string;
  stream?: boolean;
  options?: any;
}

// 생성 요청 인터페이스
export interface GenerateRequest {
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

// 임베딩 요청 인터페이스
export interface EmbeddingRequest {
  model?: string;
  prompt: string;
}
