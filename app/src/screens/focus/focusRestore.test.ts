// 복원 적립의 '오늘 몫' 산정 — GROMO-1252 코드리뷰 3차 ①.
//
// 서버가 완료 시점에 확정한 날짜별 분포를 내려주므로, 복원 경로가 구간을 다시 벽시계로 자르던
// 추정(일시정지가 자정을 걸치면 어제 몫까지 오늘로 들어옴)을 대체한다. 단 축이 서버 존이라
// 기기가 KST 축 위에 있을 때만 쓰고, 아니면 종전 겹침 추정으로 폴백한다.
jest.mock('@/services/focusApi', () => ({
  getAllFocusSessions: jest.fn(),
  getFocusTags: jest.fn(),
}));
// 러너가 process.env.TZ 변경을 반영하지 않아(TZ=Asia/Seoul 고정) 동축 게이트만 대체한다.
jest.mock('@/utils/localDate', () => ({
  ...jest.requireActual('@/utils/localDate'),
  kstLocalSameDay: jest.fn(() => true),
}));

import { todayRestoreSeconds } from './focusRestore';
import { kstLocalSameDay } from '@/utils/localDate';
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
  (kstLocalSameDay as jest.Mock).mockReturnValue(true);
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

it('기기가 KST 축 위에 있지 않으면 서버 분포를 쓰지 않는다(축 불일치 방지)', () => {
  (kstLocalSameDay as jest.Mock).mockReturnValue(false);
  const s = session({ focusSecondsByDate: { '2026-08-07': 300, '2026-08-08': 300 } });
  expect(todayRestoreSeconds(s)).toBe(15 * 60);
});
