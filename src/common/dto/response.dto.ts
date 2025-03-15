// src/common/dto/response.dto.ts
import {
  ChatCompletionChunkResponse,
  TextCompletionChunkResponse,
  ChatCompletionResponse,
  TextCompletionResponse
} from '../types/response.types';

export class ChatCompletionChunkDto {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: {
    delta: {
      content?: string;
    };
    index: number;
    finish_reason: string | null;
  }[];

  constructor(id: string, model: string, content?: string, finish_reason: string | null = null) {
    this.id = id;
    this.object = "chat.completion.chunk";
    this.created = Math.floor(Date.now() / 1000);
    this.model = model;
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

export class TextCompletionChunkDto {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: {
    text: string;
    index: number;
    logprobs: null;
    finish_reason: string | null;
  }[];

  constructor(id: string, model: string, text: string = "", finish_reason: string | null = null) {
    this.id = id;
    this.object = "text_completion.chunk";
    this.created = Math.floor(Date.now() / 1000);
    this.model = model;
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

export class ChatCompletionResponseDto {
  id: string;
  object: string;
  created: number;
  model: string;
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

  constructor(id: string, model: string, message: { role: string; content: string }) {
    this.id = id;
    this.object = "chat.completion";
    this.created = Math.floor(Date.now() / 1000);
    this.model = model;
    this.choices = [
      {
        index: 0,
        message,
        finish_reason: "stop"
      }
    ];
    this.usage = {
      prompt_tokens: -1,
      completion_tokens: -1,
      total_tokens: -1
    };
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

export class TextCompletionResponseDto {
  id: string;
  object: string;
  created: number;
  model: string;
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

  constructor(id: string, model: string, text: string) {
    this.id = id;
    this.object = "text_completion";
    this.created = Math.floor(Date.now() / 1000);
    this.model = model;
    this.choices = [
      {
        text,
        index: 0,
        logprobs: null,
        finish_reason: "stop"
      }
    ];
    this.usage = {
      prompt_tokens: -1,
      completion_tokens: -1,
      total_tokens: -1
    };
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
