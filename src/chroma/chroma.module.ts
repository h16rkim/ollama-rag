// src/chroma/chroma.module.ts
import { Module } from '@nestjs/common';
import { ChromaService } from './chroma.service';
import { ConfigModule } from '../config/config.module';

@Module({
  imports: [ConfigModule],
  providers: [ChromaService],
  exports: [ChromaService],
})
export class ChromaModule {}
