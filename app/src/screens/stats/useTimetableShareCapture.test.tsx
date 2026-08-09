// 공유 캡처 타이밍(GROMO-1381) — 잠그는 것은 하나다:
// **캡처 대상 안의 진입 애니메이션이 끝나기 전에는 찍지 않는다.**
//
// 왜 이게 버그였나: WeeklyTimetable은 데이터 로드 콜백에서 setBlocks()와 같은 틱에 onLoaded()를
// 부르고, 그 onLoaded가 공유 버튼의 disabled를 푼다. 즉 버튼이 눌릴 수 있게 되는 순간이 곧
// 세션 블록 growUp(scaleY 0→1)이 시작되는 순간이라, 바로 누르면 찌그러진 막대가 PNG로 저장된다.
//
// 여기서 단언하는 건 **캡처가 일어난 시각**이지 애니메이션의 중간 프레임이 아니다(워클릿은 목이라
// 프레임 단언은 거짓 안정감이다). 가짜 타이머로 시계를 직접 굴려 순서만 확인한다.
import { Share } from 'react-native';
import { act, renderHook } from '@testing-library/react-native';
import { useTimetableShareCapture } from './useTimetableShareCapture';

const mockCaptureAt: number[] = [];
jest.mock('react-native-view-shot', () => ({
  captureRef: jest.fn(() => {
    mockCaptureAt.push(Date.now());
    return Promise.resolve('file://shot.png');
  }),
}));
jest.mock('@/services/analyticsEvents', () => ({ logStatsShared: jest.fn() }));

let mockReduce = false;
jest.mock('@/hooks/useReduceMotion', () => ({ useReduceMotion: () => mockReduce }));

const ENTER_MS = 1160; // staggerDelay(6) 360 + M.dur.entrance 800

function setup(enterMs: number) {
  return renderHook(() =>
    useTimetableShareCapture({ card: 'weekly_timeline', makeFileName: () => 'f', enterMs }),
  );
}

// 대기(진입 → 캐릭터 로드 → rAF 2회)를 흘려보낸다.
// ⚠️ 한 번에 크게 밀면 안 된다 — 각 단계의 타이머는 **앞 단계가 resolve된 뒤에야** 등록되므로,
//    시간을 잘게 밀면서 사이사이 마이크로태스크를 비워 줘야 다음 단계로 넘어간다.
async function drain(ms: number, step = 20) {
  for (let left = ms; left > 0; left -= step) {
    const tick = Math.min(step, left);
    await act(async () => {
      jest.advanceTimersByTime(tick);
    });
  }
}

beforeEach(() => {
  mockCaptureAt.length = 0;
  mockReduce = false;
  jest.useFakeTimers();
  jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction });
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('useTimetableShareCapture 진입 대기', () => {
  test('데이터 도착 직후 공유를 눌러도 진입이 끝나기 전에는 캡처하지 않는다', async () => {
    const { result } = await setup(ENTER_MS);
    const loadedAt = Date.now();
    await act(async () => {
      result.current.onLoaded();
    });

    await act(async () => {
      result.current.onShare().catch(() => {}); // 대기는 아래 drain이 굴린다
    });
    // 진입 중 — 아직 한 장도 찍히지 않았다
    await drain(ENTER_MS - 100);
    expect(mockCaptureAt).toHaveLength(0);

    // 진입이 끝나고 나머지 게이트(캐릭터 로드 타임아웃·rAF)까지 흘리면 찍힌다
    await drain(3000);
    expect(mockCaptureAt).toHaveLength(1);
    expect(mockCaptureAt[0] - loadedAt).toBeGreaterThanOrEqual(ENTER_MS);
  });

  test("'동작 줄이기'면 대기가 0이다 — 애니메이션이 없으니 기다릴 게 없다", async () => {
    mockReduce = true;
    const { result } = await setup(ENTER_MS);
    const loadedAt = Date.now();
    await act(async () => {
      result.current.onLoaded();
    });
    // onShare를 먼저 띄워 캐릭터 게이트가 등록되게 한 뒤(act가 마이크로태스크를 비운다) 풀어 준다
    await act(async () => {
      result.current.onShare().catch(() => {}); // 대기는 아래 drain이 굴린다
    });
    await act(async () => {
      result.current.onCharReady();
    });
    await drain(200); // rAF 2프레임 남짓
    expect(mockCaptureAt).toHaveLength(1);
    expect(mockCaptureAt[0] - loadedAt).toBeLessThan(ENTER_MS);
  });

  test('진입이 없는 카드(일 탭)는 enterMs 기본값 0이라 대기가 붙지 않는다', async () => {
    const { result } = await setup(0);
    const loadedAt = Date.now();
    await act(async () => {
      result.current.onLoaded();
    });
    await act(async () => {
      result.current.onShare().catch(() => {}); // 대기는 아래 drain이 굴린다
    });
    await act(async () => {
      result.current.onCharReady();
    });
    await drain(200);
    expect(mockCaptureAt).toHaveLength(1);
    expect(mockCaptureAt[0] - loadedAt).toBeLessThan(ENTER_MS);
  });

  test('화면 재진입 재조회로 onLoaded가 다시 불려도 대기가 되살아나지 않는다', async () => {
    // 같은 블록 노드가 재사용돼 진입이 다시 재생되지 않으므로, 두 번째 로드는 기준 시각을
    // 갱신하면 안 된다 — 갱신하면 애니메이션도 없는데 공유가 1초 넘게 늦어진다.
    const { result } = await setup(ENTER_MS);
    await act(async () => {
      result.current.onLoaded();
    });
    await drain(ENTER_MS + 50); // 진입 종료

    await act(async () => {
      result.current.onLoaded(); // 재조회 완료
    });
    await act(async () => {
      result.current.onShare().catch(() => {}); // 대기는 아래 drain이 굴린다
    });
    await act(async () => {
      result.current.onCharReady();
    });
    await drain(200);
    expect(mockCaptureAt).toHaveLength(1);
  });
});
