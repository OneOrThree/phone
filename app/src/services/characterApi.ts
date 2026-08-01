import { api } from '@/services/api';

// 캐릭터 관련 백엔드 API 래퍼 — CharacterController 대응.
// api(axios)는 비2xx에서 throw하지만, 모더레이션은 저장 게이트의 필수 관문이라
// throw 대신 항상 명확한 결과 객체를 돌려준다(호출부가 사유별로 안내를 나눌 수 있게).

// 서버 모더레이션 응답 원형.
interface ModerationApiResponse {
  allowed: boolean;
  flaggedCategories: string[];
}

export interface ModerationResult {
  // 이 이미지로 캐릭터를 만들어도 되는지. 검사 불가(unavailable)일 때도 fail-safe로 false.
  allowed: boolean;
  // 서버가 지적한 위반 카테고리(예: 'nsfw'). 검사 불가면 빈 배열.
  flaggedCategories: string[];
  // 검사 자체가 불가능했는지(네트워크/타임아웃/비2xx). true면 "위반"이 아니라 "확인 실패"라
  // UI가 안내 문구를 구분할 수 있다. 정상 판정(allowed=true/false)일 땐 false.
  unavailable: boolean;
}

// 합성본(base64 PNG, data-uri 접두사 없이)을 서버에 보내 유해성 검사를 받는다.
// 실패(네트워크·타임아웃·비2xx)는 allowed=false로 취급(fail-safe, 서버 fail-closed와 일치)하되,
// unavailable=true로 표시해 UI가 "위반 차단"과 "검사 불가"를 구분해 안내하게 한다.
export async function moderateImage(base64: string): Promise<ModerationResult> {
  try {
    const { data } = await api.post<ModerationApiResponse>('/api/v1/character/moderation', {
      image: base64,
    });
    return {
      allowed: data.allowed === true,
      flaggedCategories: data.flaggedCategories ?? [],
      unavailable: false,
    };
  } catch {
    // 검사 결과를 신뢰할 수 없으면 통과시키지 않는다(fail-safe 차단).
    return { allowed: false, flaggedCategories: [], unavailable: true };
  }
}

// 캐릭터 생성 쿼터 응답 원형(서버 계약, GROMO-1045).
interface CharacterQuotaApiResponse {
  unlimited: boolean;
  remaining: number | null;
  resetAt: string | null;
}

export interface CharacterQuota {
  // 무제한 사용자면 true — 이때 remaining/resetAt은 null이다.
  unlimited: boolean;
  // 이번 주기에 남은 생성 횟수. unlimited면 null.
  remaining: number | null;
  // 쿼터가 초기화되는 시각(ISO 문자열). unlimited면 null.
  resetAt: string | null;
}

// 남은 캐릭터 생성 횟수를 조회한다. 모더레이션과 달리 쿼터는 '안전'이 아니라 '제한'이라,
// 조회 실패(네트워크·타임아웃·비2xx)를 throw하지 않고 null을 돌려준다 — 인프라 이슈로
// 생성을 막지 않도록 호출부가 fail-open(생성 허용)으로 처리하게 한다.
export async function getCharacterQuota(): Promise<CharacterQuota | null> {
  try {
    const { data } = await api.get<CharacterQuotaApiResponse>('/api/v1/character/quota');
    return {
      unlimited: data.unlimited === true,
      remaining: data.remaining ?? null,
      resetAt: data.resetAt ?? null,
    };
  } catch {
    return null;
  }
}

// 캐릭터 생성 1건을 서버에 기록한다(저장 성공 후 호출). best-effort — 실패해도 저장 흐름을
// 막지 않도록 조용히 삼킨다.
export async function recordCharacterGeneration(): Promise<void> {
  try {
    await api.post('/api/v1/character/generation');
  } catch {
    /* 기록 실패는 무시 */
  }
}
