// src/common/types/response.types.ts
export interface JsonResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  [key: string]: unknown;
}

export interface ChatCompletionChunkResponse extends JsonResponse {
  choices: {
    delta: {
      content?: string;
    };
    index: number;
    finish_reason: string | null;
  }[];
}

export interface TextCompletionChunkResponse extends JsonResponse {
  choices: {
    text: string;
    index: number;
    logprobs: null;
    finish_reason: string | null;
  }[];
}

export interface ChatCompletionResponse extends JsonResponse {
  choices: {
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface TextCompletionResponse extends JsonResponse {
  choices: {
    text: string;
    index: number;
    logprobs: null;
    finish_reason: string;
  }[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}
