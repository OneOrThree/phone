/**
 * 환경변수 단일 창구.
 *
 * <p>값을 읽는 자리가 흩어지면 「빠뜨려도 조용히 도는」 설정이 생긴다 — 실제로 구 구현에서
 * `link.store-ios-url` 플레이스홀더가 그렇게 깨진 링크를 서빙했다(GROMO-1086). 여기서는
 * ① 필수값은 부재 시 즉시 던지고, ② 선택값은 «켜짐/꺼짐»을 타입으로 드러낸다.
 */

/** 필수값 — 없으면 부팅/첫 요청에서 바로 드러낸다. */
export function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    throw new Error(`필수 환경변수가 없습니다: ${name}`);
  }
  return value;
}

/** 선택값 — 없으면 undefined. 호출부가 «꺼짐» 분기를 명시하게 만든다. */
export function optional(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value.trim() === '' ? undefined : value;
}

export function optionalInt(name: string, fallback: number): number {
  const raw = optional(name);
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`환경변수 ${name} 는 정수여야 합니다: ${raw}`);
  }
  return parsed;
}

/** 매치 시간창(시간). 구 구현의 `link.match-window-hours` 기본 3시간을 그대로 잇는다. */
export function matchWindowHours(): number {
  return optionalInt('LINK_MATCH_WINDOW_HOURS', 3);
}

/** 링크 자기 도메인. AASA 를 서빙하는 호스트와 같아야 iOS 가 Universal Link 를 발화시킨다. */
export function baseUrl(): string {
  return required('LINK_BASE_URL').replace(/\/+$/, '');
}
