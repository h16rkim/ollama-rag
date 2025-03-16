// src/chroma/chroma.utils.ts
import * as path from 'path';

/**
 * 텍스트에서 파일 경로 정보를 추출합니다
 */
export function extractFilePath(text: string): string | null {
  const filePathMatch = text.match(/File Path: ([^\n]+)/);
  if (filePathMatch && filePathMatch[1]) {
    return filePathMatch[1].trim();
  }
  return null;
}

/**
 * 테스트 관련 키워드가 포함되어 있는지 확인합니다
 */
export function hasTestKeywords(text: string): boolean {
  const testKeywords = ['테스트', 'spec', 'Test', 'test'];
  return testKeywords.some(keyword => text.includes(keyword));
}

/**
 * 파일 경로에서 파일명(확장자 없음)을 추출합니다
 */
export function extractFileNameWithoutExtension(filePath: string): string {
  const basename = path.basename(filePath);
  const extname = path.extname(basename);
  return basename.substring(0, basename.length - extname.length);
}

/**
 * 파일 경로에서 언어 유형을 추출합니다
 */
export function getLanguageFromFilePath(filePath: string): string {
  const extname = path.extname(filePath).toLowerCase();
  if (['.kt', '.kts'].includes(extname)) {
    return 'kotlin';
  } else if (['.ts', '.tsx'].includes(extname)) {
    return 'typescript';
  } else if (['.js', '.jsx'].includes(extname)) {
    return 'javascript';
  } else if (['.java'].includes(extname)) {
    return 'java';
  }
  return 'unknown';
}

/**
 * 유사도 점수를 계산합니다 (파일명 유사도)
 * 낮을수록 더 유사
 */
export function calculateFileNameSimilarity(name1: string, name2: string): number {
  const n1 = name1.toLowerCase();
  const n2 = name2.toLowerCase();

  // 완전 일치하면 최고 점수
  if (n1 === n2) return 0;

  // 하나가 다른 것을 포함하면 두 번째로 높은 점수
  if (n1.includes(n2) || n2.includes(n1)) return 1;

  // 레벤슈타인 거리 계산 (간단한 구현)
  let distance = 0;
  const commonLength = Math.min(n1.length, n2.length);

  for (let i = 0; i < commonLength; i++) {
    if (n1[i] !== n2[i]) {
      distance++;
    }
  }

  // 나머지 길이 차이도 거리에 추가
  distance += Math.abs(n1.length - n2.length);

  return distance;
}

/**
 * 파일 경로에서 관련 테스트 파일명 패턴을 생성합니다
 */
export function generateTestFilePatterns(filePath: string): string[] {
  const fileNameWithoutExt = extractFileNameWithoutExtension(filePath);
  const language = getLanguageFromFilePath(filePath);

  let patterns = [];

  // 언어별 패턴을 우선적으로 추가
  if (language === 'kotlin') {
    patterns = [
      `${fileNameWithoutExt}.kt`,
      `${fileNameWithoutExt}Test.kt`,
      `${fileNameWithoutExt}IntegrationTest.kt`,
      `${fileNameWithoutExt}UnitTest.kt`,
      `Test${fileNameWithoutExt}.kt`,
      `${fileNameWithoutExt}ServiceTest.kt`,
      `${fileNameWithoutExt}RepositoryTest.kt`,
      `${fileNameWithoutExt}ControllerTest.kt`,
    ];
  } else if (language === 'typescript' || language === 'javascript') {
    patterns = [
      `${fileNameWithoutExt}.spec.ts`,
      `${fileNameWithoutExt}.test.ts`,
      `${fileNameWithoutExt}Test.ts`,
      `Test${fileNameWithoutExt}.ts`,
      `${fileNameWithoutExt}.spec.js`,
      `${fileNameWithoutExt}.test.js`,
      `${fileNameWithoutExt}Test.js`,
      `Test${fileNameWithoutExt}.js`,
    ];
  } else if (language === 'java') {
    patterns = [
      `${fileNameWithoutExt}Test.java`,
      `${fileNameWithoutExt}IT.java`,
      `${fileNameWithoutExt}IntegrationTest.java`,
      `${fileNameWithoutExt}UnitTest.java`,
      `Test${fileNameWithoutExt}.java`,
    ];
  } else {
    // 알 수 없는 언어일 경우 모든 패턴 추가
    patterns = [
      // TypeScript/JavaScript 테스트 패턴
      `${fileNameWithoutExt}.spec.ts`,
      `${fileNameWithoutExt}.spec.js`,
      `${fileNameWithoutExt}Test.ts`,
      `${fileNameWithoutExt}Test.js`,
      `${fileNameWithoutExt}.test.ts`,
      `${fileNameWithoutExt}.test.js`,
      `Test${fileNameWithoutExt}.ts`,
      `Test${fileNameWithoutExt}.js`,

      // Kotlin 테스트 패턴
      `${fileNameWithoutExt}.kt`,
      `${fileNameWithoutExt}Test.kt`,
      `${fileNameWithoutExt}IntegrationTest.kt`,
      `${fileNameWithoutExt}UnitTest.kt`,
      `Test${fileNameWithoutExt}.kt`,

      // Java 테스트 패턴
      `${fileNameWithoutExt}Test.java`,
      `${fileNameWithoutExt}IT.java`,
      `${fileNameWithoutExt}IntegrationTest.java`,
      `${fileNameWithoutExt}UnitTest.java`,
      `Test${fileNameWithoutExt}.java`
    ];
  }

  return patterns;
}

/**
 * 파일 확장자에서 언어 타입을 반환합니다
 */
export function getLanguageTypeFromExtension(extension: string): string {
  if (['.kt', '.kts'].includes(extension)) {
    return 'kotlin';
  } else if (['.ts', '.tsx'].includes(extension)) {
    return 'typescript';
  } else if (['.js', '.jsx'].includes(extension)) {
    return 'javascript';
  } else if (['.java'].includes(extension)) {
    return 'java';
  }
  return 'unknown';
}
