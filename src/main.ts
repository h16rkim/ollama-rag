import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';
import { ConfigService as CustomConfigService } from './config/config.service';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);
  
  // CORS 설정
  app.enableCors();
  
  // 직접 ConfigService 인스턴스 가져오기
  const configService = app.get(CustomConfigService);
  const port = configService.get('serverPort');
  
  await app.listen(port);
  
  logger.log(`Ollama 프록시 서버가 http://localhost:${port}에서 실행 중`);
  logger.log(`지원 엔드포인트: /api/chat, /api/generate, /api/embeddings`);
}
bootstrap();
