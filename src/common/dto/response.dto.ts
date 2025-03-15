// src/common/dto/response.dto.ts
import {
  ChatCompletionChunkResponse,
  TextCompletionChunkResponse,
  ChatCompletionResponse,
  TextCompletionResponse
} from '../types/response.types';

/**
 * 모든 응답 DTO의 기본 클래스
 */
export abstract class BaseResponseDto {
  id: string;
  object: string;
  created: number;
  model: string;

  constructor(id: string, model: string, objectType: string) {
    this.id = id;
    this.object = objectType;
    this.created = Math.floor(Date.now() / 1000);
    this.model = model;
  }

  abstract toJSON(): unknown;
}

/**
 * 토큰 사용량 정보를 포함하는 DTO의 기본 클래스
 */
export abstract class BaseCompletionResponseDto extends BaseResponseDto {
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };

  constructor(id: string, model: string, objectType: string) {
    super(id, model, objectType);
    this.usage = {
      prompt_tokens: -1,
      completion_tokens: -1,
      total_tokens: -1
    };
  }
}

export class ChatCompletionChunkDto extends BaseResponseDto {
  choices: {
    delta: {
      content?: string;
    };
    index: number;
    finish_reason: string | null;
  }[];

  constructor(id: string, model: string, content?: string, finish_reason: string | null = null) {
    super(id, model, "chat.completion.chunk");
    this.choices = [
      {
        delta: content ? { content } : {},
        index: 0,
        finish_reason
      }
    ];
  }

  toJSON(): ChatCompletionChunkResponse {
    return {
      id: this.id,
      object: this.object,
      created: this.created,
      model: this.model,
      choices: this.choices
    };
  }
}

export class TextCompletionChunkDto extends BaseResponseDto {
  choices: {
    text: string;
    index: number;
    logprobs: null;
    finish_reason: string | null;
  }[];

  constructor(id: string, model: string, text: string = "", finish_reason: string | null = null) {
    super(id, model, "text_completion.chunk");
    this.choices = [
      {
        text,
        index: 0,
        logprobs: null,
        finish_reason
      }
    ];
  }

  toJSON(): TextCompletionChunkResponse {
    return {
      id: this.id,
      object: this.object,
      created: this.created,
      model: this.model,
      choices: this.choices
    };
  }
}

export class ChatCompletionResponseDto extends BaseCompletionResponseDto {
  choices: {
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }[];

  constructor(id: string, model: string, message: { role: string; content: string }) {
    super(id, model, "chat.completion");
    this.choices = [
      {
        index: 0,
        message,
        finish_reason: "stop"
      }
    ];
  }

  toJSON(): ChatCompletionResponse {
    return {
      id: this.id,
      object: this.object,
      created: this.created,
      model: this.model,
      choices: this.choices,
      usage: this.usage
    };
  }
}

export class TextCompletionResponseDto extends BaseCompletionResponseDto {
  choices: {
    text: string;
    index: number;
    logprobs: null;
    finish_reason: string;
  }[];

  constructor(id: string, model: string, text: string) {
    super(id, model, "text_completion");
    this.choices = [
      {
        text,
        index: 0,
        logprobs: null,
        finish_reason: "stop"
      }
    ];
  }

  toJSON(): TextCompletionResponse {
    return {
      id: this.id,
      object: this.object,
      created: this.created,
      model: this.model,
      choices: this.choices,
      usage: this.usage
    };
  }
}
