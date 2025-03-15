// src/ollama/ollama.module.ts
import { Module } from '@nestjs/common';
import { OllamaController } from './ollama.controller';
import { OllamaService } from './ollama.service';
import { ChromaModule } from '../chroma/chroma.module';
import { ConfigModule } from '../config/config.module';
import { ResponseHandlerService } from '../common/services/response-handler.service';
import { StreamHandlersModule } from '../common/services/stream/stream-handlers.module';

@Module({
  imports: [ConfigModule, ChromaModule, StreamHandlersModule],
  controllers: [OllamaController],
  providers: [OllamaService, ResponseHandlerService],
  exports: [OllamaService],
})
export class OllamaModule {}
