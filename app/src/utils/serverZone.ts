// serverZone.ts
// 서버가 이 유저의 날짜 버킷을 자르는 IANA 존 (GROMO-1252 코드리뷰 4차 ②).
//
// 서버는 country_code에서 존을 파생한다(CountryZoneResolver — KR/JP/GB 매핑 + Asia/Seoul 폴백).
// 앱이 그 매핑을 복제하면 정본이 둘이 되므로, 서버가 프로필 응답(GET /users/me → timeZone)에
// 존 문자열을 실어 주고 앱은 받은 문자열을 그대로 쓴다.
//
// 폴백은 Asia/Seoul — 서버 CountryZoneResolver의 폴백과 같은 값이다. 프로필을 아직 못 받은
// 시점(온보딩 중 첫 세션·오프라인 첫 실행·구버전 서버)에는 이 값으로 업로드 키를 만든다. 서버도
// country_code가 null이면 같은 폴백을 쓰므로 그 구간의 유저(=프로필 미등록)와는 축이 일치한다.
//
// 재실행 시엔 App.tsx가 캐시된 유저(gromo:user)에서 먼저 넣어 준다 — 네트워크 없이도 지난 값 유지.
import { zoneDateStr, zoneSameWallClock } from '@/utils/localDate';

const FALLBACK_ZONE = 'Asia/Seoul';

let serverZone: string = FALLBACK_ZONE;

// 프로필 응답/캐시에서 받은 값 반영. 문자열이 아니거나 빈 값이면(구버전 서버·미병합) 무시하고
// 직전 값을 유지한다 — 저장소 값이 unknown 타입이라 여기서 한 번에 걸러 낸다.
export function setServerZone(zone: unknown): void {
  if (typeof zone === 'string' && zone.length > 0) serverZone = zone;
}

// 로그아웃·계정 전환 시 폴백으로 되돌린다 (GROMO-1252 5차 ②).
// setServerZone은 값이 없으면 직전 값을 유지하므로, 전환 직후 프로필 조회가 실패하면 이전 계정 존이
// 그대로 남아 새 계정의 집중 tick이 남의 날짜 키로 업로드된다(GB → KR 전환 시 서버가 폐기·오귀속).
// 리셋 값이 서버 폴백(CountryZoneResolver)과 같아서, 프로필을 못 받은 구간의 축도 서버와 일치한다.
export function resetServerZone(): void {
  serverZone = FALLBACK_ZONE;
}

export function getServerZone(): string {
  return serverZone;
}

// 서버 존 기준 오늘 "YYYY-MM-DD" — 업로드한 날짜 키와 같은 축으로 '오늘'을 판정할 때 쓴다.
export function serverTodayStr(): string {
  return zoneDateStr(new Date(), serverZone);
}

// 서버 존 날짜 버킷과 기기 로컬 하루의 경계가 지금 겹치는가 (GROMO-1252 5차 ①).
// 서버가 내려준 날짜별 값(분포)을 로컬 자정 리셋 스토어에 그대로 넣어도 되는지의 게이트 —
// 경계가 다르면 인접 버킷 시간이 섞이므로 소비처가 다른 추정으로 폴백해야 한다.
export function serverZoneAlignedWithLocal(): boolean {
  return zoneSameWallClock(serverZone);
}
