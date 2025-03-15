import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { ChromaModule } from './chroma/chroma.module';
import { OllamaModule } from './ollama/ollama.module';

@Module({
  imports: [
    ConfigModule,
    ChromaModule,
    OllamaModule,
  ],
})
export class AppModule {}
