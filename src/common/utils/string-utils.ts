// src/common/utils/string-utils.ts

/**
 * 문자열이 JSON 형식인지 확인합니다.
 */
export function isJsonString(text: string): boolean {
  if (!text || typeof text !== 'string') {
    return false;
  }
  
  const trimmed = text.trim();
  // JSON 형식은 반드시 { 로 시작하고 } 로 끝나거나, [ 로 시작하고 ] 로 끝나야 함
  if (
    !(trimmed.startsWith('{') && trimmed.endsWith('}')) && 
    !(trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    return false;
  }
  
  try {
    JSON.parse(trimmed);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * 마크다운 코드 블록을 제거합니다.
 */
export function removeCodeBlocks(text: string): string {
  if (!text) return '';
  
  // ```언어명 형식의 코드 블록 제거
  return text.replace(/^```(?:\w+)?\s*\n([\s\S]*?)```$/gm, '$1').trim();
}

/**
 * JSON 객체에서 특정 키를 가진 값을 추출합니다.
 */
export function extractValueFromJson(
  jsonObj: Record<string, unknown>, 
  keys: string[]
): string | undefined {
  for (const key of keys) {
    if (key in jsonObj && typeof jsonObj[key] === 'string') {
      return jsonObj[key] as string;
    }
  }
  return undefined;
}

/**
 * 코드 블록 및 불필요한 형식을 제거하는 함수
 */
export function extractCodeContent(text: string): string {
  // 마크다운 코드 블록 제거
  let cleaned = removeCodeBlocks(text);
  
  // 여전히 JSON 형식이라면 파싱 시도
  if (isJsonString(cleaned)) {
    try {
      const parsedJson = JSON.parse(cleaned) as Record<string, unknown>;
      // 다양한 필드 확인
      const keysToCheck = ['response', 'result', 'code'];
      const extractedValue = extractValueFromJson(parsedJson, keysToCheck);
      
      if (extractedValue) {
        return extractedValue;
      }
    } catch (e) {
      // JSON 파싱 실패 시 원본 텍스트 사용
    }
  }
  
  return cleaned.trim();
}

/**
 * 코드 자동완성 요청인지 확인합니다.
 */
export function isCodeCompletionRequest(prompt: string): boolean {
  if (!prompt) return false;
  
  const codeIndicators = [
    'function', 
    'class', 
    'export', 
    'import', 
    'const', 
    'let', 
    'var',
    'interface',
    'type',
    'enum'
  ];
  
  return codeIndicators.some(indicator => prompt.includes(indicator));
}
