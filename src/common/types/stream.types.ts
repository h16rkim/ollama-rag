// src/common/types/stream.types.ts
export interface StreamData {
  message?: {
    content: string;
  };
  response?: string;
  done?: boolean;
  [key: string]: unknown;
}

export interface StreamSource {
  data: {
    on(event: 'data' | 'end' | 'error', listener: (data: unknown) => void): void;
  };
}

export type StreamProcessor = (data: StreamData) => void;

export interface ResponseHeaders {
  [key: string]: string;
}

export interface StreamErrorResponse {
  message: string;
  type: string;
}
