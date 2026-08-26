// 서버 날짜 버킷 존 캐시 — GROMO-1252 코드리뷰 4차 ②·5차 ②.
// 러너 TZ는 KST 고정(jest.config.js) = 기기 로컬은 항상 KST다.
import {
  getServerZone,
  resetServerZone,
  serverZoneAlignedWithLocal,
  setServerZone,
} from './serverZone';

afterEach(() => {
  resetServerZone();
});

it('빈 값·비문자열은 무시하고 직전 값을 유지한다(구버전 서버 응답)', () => {
  setServerZone('Europe/London');
  setServerZone(undefined);
  setServerZone('');
  setServerZone(42);
  expect(getServerZone()).toBe('Europe/London');
});

it('계정 핸드오프 리셋 — 이전 계정 존이 남지 않고 서버 폴백(Asia/Seoul)으로 돌아간다', () => {
  // GB 계정 → KR 계정 전환 중 프로필 조회가 실패하면 setServerZone(undefined)는 값을 유지하므로,
  // 리셋이 없으면 새 계정의 tick이 런던 날짜 키로 업로드된다.
  setServerZone('Europe/London');
  resetServerZone();
  setServerZone(undefined); // 전환 후 프로필 실패
  expect(getServerZone()).toBe('Asia/Seoul');
});

it('경계 일치 판정은 라벨이 아니라 벽시계(오프셋) 기준이다', () => {
  expect(serverZoneAlignedWithLocal()).toBe(true); // 폴백 Asia/Seoul == 기기 KST
  setServerZone('Asia/Tokyo');
  expect(serverZoneAlignedWithLocal()).toBe(true); // 같은 UTC+9 — 자정이 겹친다
  setServerZone('Europe/London');
  expect(serverZoneAlignedWithLocal()).toBe(false);
  setServerZone('Asia/Kathmandu');
  expect(serverZoneAlignedWithLocal()).toBe(false); // +05:45 — 45분 오프셋도 구분
});
