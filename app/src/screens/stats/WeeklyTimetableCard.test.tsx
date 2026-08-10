// 주간 타임라인 공유 캡처의 **대기 기준 시각**(GROMO-1381 codex 리뷰) — 잠그는 것은 하나다:
// 진입 대기는 데이터가 도착한 순간이 아니라 **세션 블록이 실제로 마운트된 순간**부터 센다.
//
// 왜 이게 버그였나: 조회가 끝난 틱에는 plotW가 아직 0이라 블록(Animated.View)이 하나도 없다.
// 블록은 다음 레이아웃의 onLayout이 폭을 채운 뒤에야 마운트되고 growUp도 그때 시작한다.
// 데이터 도착 시각을 기준으로 삼으면 레이아웃이 밀린 만큼 대기가 짧아져, 느린 기기·바쁜 JS
// 스레드에서는 마지막 블록의 찌그러진 중간 프레임이 그대로 PNG에 구워진다.
//
// ⚠️ 여기서 단언하는 건 **캡처가 일어난 시각**이지 애니메이션의 중간 프레임·이징이 아니다
//    (워클릿은 목이라 프레임 단언은 거짓 안정감이다). 가짜 타이머로 시계를 직접 굴린다.
// ⚠️ jest에는 레이아웃 패스가 없어 onLayout이 저절로 오지 않는다 — 직접 발생시켜야
//    `plotW > 0` 분기가 실제로 렌더된다(charts.test.tsx와 동일).
import { Share } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { WeeklyTimetableCard } from './WeeklyTimetableCard';
import { WTT_BODY_H } from './constants';

const mockCaptureAt: number[] = [];
jest.mock('react-native-view-shot', () => ({
  captureRef: jest.fn(() => {
    mockCaptureAt.push(Date.now());
    return Promise.resolve('file://shot.png');
  }),
}));
jest.mock('@/services/analyticsEvents', () => ({ logStatsShared: jest.fn() }));
jest.mock('@/hooks/useReduceMotion', () => ({
  useReduceMotion: () => false,
  useReduceMotionReady: () => true,
}));
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (cb: () => void | (() => void)) => {
    const { useEffect } = require('react');
    useEffect(() => cb(), [cb]);
  },
}));
// 이번 주(KST 월요일 기준) 안의 세션 2건 — 폭이 잡히면 블록 2개가 마운트되며 growUp이 돈다
const mockSessions = [
  {
    startedAt: '2026-08-03T09:00:00+09:00',
    endedAt: '2026-08-03T10:30:00+09:00',
    focusTagId: null,
  },
  {
    startedAt: '2026-08-04T13:00:00+09:00',
    endedAt: '2026-08-04T14:00:00+09:00',
    focusTagId: null,
  },
];
jest.mock('@/services/focusApi', () => ({
  getAllFocusSessions: jest.fn(() => Promise.resolve(mockSessions)),
  getFocusTags: jest.fn(() => Promise.resolve([])),
}));
jest.mock('@/store/SubjectContext', () => ({ useSubjects: () => ({ subjects: [] }) }));
// 브랜드 캐릭터 이미지 로드는 이 테스트의 관심사가 아니다 — 완료 신호만 꺼내 두고 drain이 매 틱
// 흘려 준다(멱등). 그래야 캡처까지 남는 대기가 우리가 재려는 **진입 대기**뿐이다.
let mockCharReady: (() => void) | null = null;
jest.mock('./ShareBrandFooter', () => ({
  ShareBrandFooter: function MockShareBrandFooter({ onCharReady }: { onCharReady: () => void }) {
    mockCharReady = onCharReady;
    return null;
  },
}));

const ENTER_MS = 1160; // staggerDelay(6) 360 + M.dur.entrance 800

// 대기(진입 → 캐릭터 로드 → rAF 2회)를 흘려보낸다.
// ⚠️ 한 번에 크게 밀면 안 된다 — 각 단계의 타이머는 **앞 단계가 resolve된 뒤에야** 등록되므로,
//    시간을 잘게 밀면서 사이사이 마이크로태스크를 비워 줘야 다음 단계로 넘어간다.
async function drain(ms: number, step = 20) {
  for (let left = ms; left > 0; left -= step) {
    const tick = Math.min(step, left);
    await act(async () => {
      jest.advanceTimersByTime(tick);
      mockCharReady?.();
    });
  }
}

// 커밋·이펙트·마이크로태스크를 한 프레임치 흘린다.
// ⚠️ 빈 `await act(async () => {})`로 대체하지 말 것 — 가짜 타이머 아래에서는 React가 act
//    뒷정리로 거는 태스크가 실행되지 않아 act 스코프가 열린 채 남는다. 시간을 같이 밀어야 닫힌다.
const flush = () => drain(20);

// 카드를 그리고 조회 프라미스를 해소한다. 이 시점의 plotW는 0 — 격자는 있어도 블록은 없다.
async function renderCard() {
  await render(<WeeklyTimetableCard />);
  for (let i = 0; i < 10 && screen.queryByTestId('stats.weeklyTimetable.plot') === null; i++) {
    await flush();
  }
}

// 레이아웃 패스 대역 — 폭이 정해져야 블록이 마운트되고, 그 커밋 뒤에야 로드 완료 신호가 간다
async function layoutPlot(width: number) {
  fireEvent(screen.getByTestId('stats.weeklyTimetable.plot'), 'layout', {
    nativeEvent: { layout: { width, height: WTT_BODY_H } },
  });
  await flush();
}

async function pressShare() {
  fireEvent.press(screen.getByText('공유하기'));
  await flush();
}

beforeEach(() => {
  mockCaptureAt.length = 0;
  mockCharReady = null;
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-08-05T10:00:00+09:00')); // 수요일 오전(KST)
  jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction });
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

// ⚠️ 한 test 안에서 단계별로 진행한다 — 이 화면을 가짜 타이머 위에서 두 번 렌더하면 두 번째
//    render가 통째로 비어 나오는 환경 문제가 있다(act 스코프가 테스트 경계를 넘어 남는다).
//    단계마다 무엇을 잠그는지는 아래 주석에 적었다.
test('진입 대기는 데이터 도착이 아니라 블록이 마운트된 시각부터 센다', async () => {
  await renderCard();

  // 1) 폭이 잡히기 전(plotW=0)에는 공유가 열리지 않는다 — 자랄 블록도, 잴 기준 시각도 없다.
  //    이때 찍으면 격자도 블록도 없는 빈 플롯이 PNG가 된다.
  await pressShare();
  await drain(3000);
  expect(mockCaptureAt).toHaveLength(0);

  // 2) 폭이 정해진 그 커밋부터 진입 시간을 센다 — 위에서 3초를 흘렸으므로, 데이터 도착 시각을
  //    기준으로 삼는 회귀 버전이라면 아래 대기 구간에서 이미 한 장 찍힌다.
  await layoutPlot(300);
  const mountedAt = Date.now();
  await pressShare();
  await drain(ENTER_MS - 100);
  expect(mockCaptureAt).toHaveLength(0);
  await drain(600);
  expect(mockCaptureAt).toHaveLength(1);
  expect(mockCaptureAt[0]).toBeGreaterThanOrEqual(mountedAt + ENTER_MS);

  // 3) 폭이 다시 잡혀도(기기 회전) 기준 시각은 리셋되지 않는다 — 리셋하면 회전할 때마다 공유가
  //    1.16초씩 밀린다. 폭만 바뀌면 같은 key의 노드가 재사용되고 growUp 스타일도 인덱스별 캐시된
  //    같은 참조라 애니메이션이 재생되지 않으므로, 기다릴 이유가 없다.
  await layoutPlot(320);
  await pressShare();
  await drain(200); // 캐릭터 게이트 + rAF 2프레임 남짓이면 충분해야 한다
  expect(mockCaptureAt).toHaveLength(2);
});
