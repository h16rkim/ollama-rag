// src/ollama/ollama.module.ts
import { Module } from '@nestjs/common';
import { OllamaController } from './ollama.controller';
import { OllamaService } from './ollama.service';
import { ChromaModule } from '../chroma/chroma.module';
import { ConfigModule } from '../config/config.module';

@Module({
  imports: [ConfigModule, ChromaModule],
  controllers: [OllamaController],
  providers: [OllamaService],
  exports: [OllamaService],
})
export class OllamaModule {}
