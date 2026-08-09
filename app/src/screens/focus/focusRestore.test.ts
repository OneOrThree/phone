// 복원 적립의 '오늘 몫' 산정 — GROMO-1252 코드리뷰 3차 ①·5차 ①.
//
// 서버가 완료 시점에 확정한 날짜별 분포를 내려주므로, 복원 경로가 구간을 다시 벽시계로 자르던
// 추정(일시정지가 자정을 걸치면 어제 몫까지 오늘로 들어옴)을 대체한다. 단 그 분포의 축은 서버 존이고
// 소비처는 로컬 자정 리셋 스토어라, 두 축의 경계가 겹칠 때만 쓰고 아니면 겹침 추정으로 폴백한다.
//
// 러너 TZ는 KST 고정(jest.config.js) = 기기 로컬은 항상 KST다. 그래서 서버 존만 바꿔 가며
// '경계 일치/불일치'를 만든다.
jest.mock('@/services/focusApi', () => ({
  getAllFocusSessions: jest.fn(),
  getFocusTags: jest.fn(),
}));

import { todayRestoreSeconds } from './focusRestore';
import { resetServerZone, setServerZone } from '@/utils/serverZone';
import type { FocusSessionResponse } from '@/types/dto/focus';

const session = (over: Partial<FocusSessionResponse> = {}): FocusSessionResponse => ({
  focusTagId: null,
  startedAt: '2026-08-07T23:50:00+09:00',
  endedAt: '2026-08-08T00:15:00+09:00',
  totalDistractionSeconds: 0,
  ...over,
});

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-08-08T10:00:00+09:00'));
  resetServerZone(); // 기기(KST)와 경계가 겹치는 기본값
});
afterEach(() => {
  jest.useRealTimers();
});

it('서버 분포가 있으면 그 값(오늘 키)을 쓴다 — 일시정지가 자정을 걸쳐도 정확', () => {
  // 23:50~23:55 집중 → 일시정지 → 00:10~00:15 집중 = 실제 오늘 몫 300초.
  // 구간 겹침 추정은 00:00~00:15 = 900초로 3배 부풀었다.
  const s = session({ focusSecondsByDate: { '2026-08-07': 300, '2026-08-08': 300 } });
  expect(todayRestoreSeconds(s)).toBe(300);
});

it('오늘 키가 없는 분포(어제로 끝난 세션)는 0', () => {
  const s = session({ focusSecondsByDate: { '2026-08-07': 600 } });
  expect(todayRestoreSeconds(s)).toBe(0);
});

it('분포 미기록(레거시 세션)이면 구간 겹침 추정으로 폴백', () => {
  expect(todayRestoreSeconds(session())).toBe(15 * 60);
});

it('서버 존 경계가 기기 로컬과 어긋나면 서버 분포를 쓰지 않는다 — GB 유저 + KST 기기(5차 ①)', () => {
  // 4차까지는 게이트가 KST 고정(kstLocalSameDay)이라 이 조합에서 게이트가 열린 채
  // Europe/London 키 맵을 KST 날짜('2026-08-08')로 인덱싱했다.
  setServerZone('Europe/London');
  const s = session({ focusSecondsByDate: { '2026-08-07': 300, '2026-08-08': 300 } });
  expect(todayRestoreSeconds(s)).toBe(15 * 60);
});

it('서버 존이 KST가 아니어도 경계가 겹치면 그 축의 오늘 키를 쓴다 — 기기 KST + Asia/Tokyo', () => {
  // 도쿄는 KST와 같은 UTC+9라 자정 경계가 정확히 겹친다 — 4차 게이트(오프셋 -540 고정)와 결과는
  // 같지만, 이제 판정 근거가 '서버 존과의 경계 일치'라는 걸 고정한다.
  setServerZone('Asia/Tokyo');
  const s = session({ focusSecondsByDate: { '2026-08-07': 300, '2026-08-08': 300 } });
  expect(todayRestoreSeconds(s)).toBe(300);
});
