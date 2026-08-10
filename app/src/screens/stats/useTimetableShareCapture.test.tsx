// 공유 캡처 타이밍(GROMO-1381) — 잠그는 것은 하나다:
// **캡처 대상 안의 진입 애니메이션이 끝나기 전에는 찍지 않는다.**
//
// 왜 이게 버그였나: WeeklyTimetable은 세션 블록이 마운트된 커밋 직후 onLoaded()를 부르고,
// 그 onLoaded가 공유 버튼의 disabled를 푼다. 즉 버튼이 눌릴 수 있게 되는 순간이 곧
// 세션 블록 growUp(scaleY 0→1)이 시작되는 순간이라, 바로 누르면 찌그러진 막대가 PNG로 저장된다.
// (onLoaded를 **언제** 부르느냐 — 데이터 도착이 아니라 마운트 이후 — 는 WeeklyTimetableCard.test.tsx)
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
jest.mock('@/hooks/useReduceMotion', () => ({
  useReduceMotion: () => mockReduce,
  useReduceMotionReady: () => true,
}));

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
      result.current.onLoaded(3); // 세션 블록 3개가 자란다
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

  test('대기 중에는 캡처 전용 chrome을 켜지 않는다 — 대기가 끝난 뒤에 켠다', async () => {
    // 켜 놓고 기다리면 그 1초 남짓 동안 브랜드 밴드·여백이 실제 화면에 그대로 보인다(codex 리뷰)
    const { result } = await setup(ENTER_MS);
    await act(async () => {
      result.current.onLoaded(3); // 세션 블록 3개가 자란다
    });
    await act(async () => {
      result.current.onShare().catch(() => {});
    });
    await drain(ENTER_MS - 100);
    expect(result.current.capturing).toBe(false);
    expect(result.current.captureStyle).toBeNull();

    await drain(3000);
    expect(mockCaptureAt).toHaveLength(1);
  });

  test('대기가 끝난 뒤 오는 이미지 신호를 놓치지 않는다 — 게이트를 chrome보다 먼저 등록한다', async () => {
    // 게이트 등록 전에 onLoad가 오면 신호를 잃고 캐릭터 타임아웃 1.5초를 통째로 기다린다
    const { result } = await setup(ENTER_MS);
    await act(async () => {
      result.current.onLoaded(3); // 세션 블록 3개가 자란다
    });
    await act(async () => {
      result.current.onShare().catch(() => {});
    });
    await drain(ENTER_MS + 40); // 진입 대기만 넘긴다 — 이 시점엔 게이트가 등록돼 있어야 한다
    await act(async () => {
      result.current.onCharReady();
    });
    await drain(200); // rAF 두 프레임 남짓 — 캐릭터 타임아웃(1500)까지 갈 필요가 없다
    expect(mockCaptureAt).toHaveLength(1);
  });

  test('재조회로 블록이 늘면 새 진입만큼 다시 기다린다', async () => {
    const { result } = await setup(ENTER_MS);
    await act(async () => {
      result.current.onLoaded(3);
    });
    await drain(ENTER_MS + 50); // 첫 진입 종료

    // 화면을 떠난 사이 새 세션이 생겨 블록이 3 → 5. 새 노드가 마운트되며 growUp이 다시 돈다.
    await act(async () => {
      result.current.onLoaded(5);
    });
    await act(async () => {
      result.current.onShare().catch(() => {});
    });
    await drain(ENTER_MS - 100);
    expect(mockCaptureAt).toHaveLength(0); // 아직 새 블록이 자라는 중
    await drain(3000);
    expect(mockCaptureAt).toHaveLength(1);
  });

  test("'동작 줄이기'면 대기가 0이다 — 애니메이션이 없으니 기다릴 게 없다", async () => {
    mockReduce = true;
    const { result } = await setup(ENTER_MS);
    const loadedAt = Date.now();
    await act(async () => {
      result.current.onLoaded(3);
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

  test('기록이 없는 주는 대기가 없다 — 자랄 블록이 하나도 없다', async () => {
    // onLoaded(0)에 마감 시각을 잡으면 기록 없는 사용자만 1.16초 무반응이 된다(codex 리뷰)
    const { result } = await setup(ENTER_MS);
    const loadedAt = Date.now();
    await act(async () => {
      result.current.onLoaded(0);
    });
    await act(async () => {
      result.current.onShare().catch(() => {});
    });
    await act(async () => {
      result.current.onCharReady();
    });
    await drain(200);
    expect(mockCaptureAt).toHaveLength(1);
    expect(mockCaptureAt[0] - loadedAt).toBeLessThan(ENTER_MS);
  });

  test('블록 수가 그대로인 재조회는 대기를 되살리지 않는다', async () => {
    // 같은 개수면 기존 노드가 재사용돼 진입이 다시 재생되지 않으므로 기준 시각을 갱신하면 안 된다
    // — 갱신하면 애니메이션도 없는데 공유가 1초 넘게 늦어진다.
    const { result } = await setup(ENTER_MS);
    await act(async () => {
      result.current.onLoaded(4);
    });
    await drain(ENTER_MS + 50); // 진입 종료

    await act(async () => {
      result.current.onLoaded(4); // 재조회 완료 — 개수 동일
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
