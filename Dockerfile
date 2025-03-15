FROM node:20-alpine

WORKDIR /app

# pnpm 설치
RUN npm install -g pnpm

# 패키지 파일 복사 및 의존성 설치
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install

# 명시적으로 express 설치
RUN pnpm add express body-parser

# 소스 코드 복사
COPY . .

# 빌드
RUN pnpm build

# 포트 설정
EXPOSE 9007

# 앱 실행
CMD ["pnpm", "start:prod"]
