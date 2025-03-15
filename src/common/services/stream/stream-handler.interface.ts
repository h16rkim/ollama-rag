// src/common/services/stream/stream-handler.interface.ts
import { Response } from 'express';
import { StreamSource } from '../../types/stream.types';

export interface StreamHandlerInterface {
  handleStream(stream: StreamSource, res: Response, model: string): void;
}
