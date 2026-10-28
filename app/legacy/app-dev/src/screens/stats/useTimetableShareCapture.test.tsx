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
  whenReduceMotionReady: () => Promise.resolve(),
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
      result.current.onLoaded(['b0', 'b1', 'b2']); // 세션 블록 3개가 자란다
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
      result.current.onLoaded(['b0', 'b1', 'b2']); // 세션 블록 3개가 자란다
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
      result.current.onLoaded(['b0', 'b1', 'b2']); // 세션 블록 3개가 자란다
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
      result.current.onLoaded(['b0', 'b1', 'b2']);
    });
    await drain(ENTER_MS + 50); // 첫 진입 종료

    // 화면을 떠난 사이 새 세션이 생겨 블록이 3 → 5. 새 노드가 마운트되며 growUp이 다시 돈다.
    await act(async () => {
      result.current.onLoaded(['b0', 'b1', 'b2', 'b3', 'b4']);
    });
    await act(async () => {
      result.current.onShare().catch(() => {});
    });
    await drain(ENTER_MS - 100);
    expect(mockCaptureAt).toHaveLength(0); // 아직 새 블록이 자라는 중
    await drain(3000);
    expect(mockCaptureAt).toHaveLength(1);
  });

  // ⚠️ **개수로는 못 잡는 경우.** 블록 키가 신원(요일·분 구간·태그)이 된 뒤로는, 화면이 다른
  //    스택 화면 아래에 남은 채 주 경계를 넘겨 재조회되면 개수가 같아도 전부 다른 블록이다.
  //    새 노드가 마운트되며 growUp이 도는데 대기를 갱신하지 않으면 중간 프레임이 캡처된다.
  test('개수가 같아도 블록 신원이 바뀌면 다시 기다린다 (주 경계)', async () => {
    const { result } = await setup(ENTER_MS);
    await act(async () => {
      result.current.onLoaded(['mon:540:600:t1', 'tue:540:600:t1']);
    });
    await drain(ENTER_MS + 50); // 첫 진입 종료

    // 주가 바뀌어 **같은 2개인데 전부 다른 세션**이다 — 새 key라 새로 마운트된다.
    await act(async () => {
      result.current.onLoaded(['wed:600:660:t2', 'thu:600:660:t2']);
    });
    await act(async () => {
      result.current.onShare().catch(() => {});
    });
    // ⚠️ 캐릭터 게이트를 **먼저 풀어 준다.** 안 풀면 그 게이트(타임아웃 1500ms)가 대기를
    //    지배해, 진입 대기를 갱신하든 말든 똑같이 늦게 찍혀 이 테스트가 아무것도 구분하지 못한다.
    await act(async () => {
      result.current.onCharReady();
    });
    await drain(300);
    expect(mockCaptureAt).toHaveLength(0); // 아직 새 블록이 자라는 중 — 갱신됐다는 증거
    // 이 시점의 onCharReady는 게이트가 등록되기 전이라 흘러갔다 — 캐릭터 타임아웃(1500)까지 준다.
    await drain(3000);
    expect(mockCaptureAt).toHaveLength(1);
  });

  // ⚠️ 마감 시각을 **한 번만 읽으면** 놓치는 경쟁. 화면 재진입은 이전 블록을 유지한 채
  //    재조회하므로 공유 버튼이 잠기지 않는다 — 캐릭터 게이트·프레임을 기다리는 사이에
  //    조회가 끝나 새 블록이 자라기 시작하면, 이미 복사해 둔 마감으로 기다리던 공유는 그
  //    갱신을 못 보고 중간 프레임을 찍는다(codex 리뷰).
  test('기다리는 사이 재조회가 끝나면 새 진입만큼 더 기다린다', async () => {
    const { result } = await setup(ENTER_MS);
    await act(async () => {
      result.current.onLoaded(['mon:540:600:t1']);
    });
    await drain(ENTER_MS + 50); // 첫 진입 종료 — 이 시점의 마감은 이미 지났다

    await act(async () => {
      result.current.onShare().catch(() => {});
    });
    // 캐릭터 게이트를 기다리는 사이 재조회가 끝나 새 블록이 마운트된다
    await act(async () => {
      result.current.onLoaded(['mon:540:600:t1', 'tue:540:600:t1']);
    });
    await act(async () => {
      result.current.onCharReady();
    });
    await drain(300);
    expect(mockCaptureAt).toHaveLength(0); // 새 진입 대기를 다시 읽었다는 증거
    await drain(ENTER_MS);
    expect(mockCaptureAt).toHaveLength(1);
  });

  // 반대 방향 가드 — 같은 블록이 다시 보고되는 것(폭 변화·회전)에는 대기를 새로 잡지 않는다.
  // 잡으면 사용자가 공유를 눌러도 1초 넘게 아무 반응이 없다.
  test('같은 블록이 다시 보고되면 대기를 새로 잡지 않는다', async () => {
    const { result } = await setup(ENTER_MS);
    await act(async () => {
      result.current.onLoaded(['mon:540:600:t1', 'tue:540:600:t1']);
    });
    await drain(ENTER_MS + 50); // 첫 진입 종료

    // 화면 폭만 바뀌어 같은 키가 다시 온다 — 재생될 애니메이션이 없다.
    await act(async () => {
      result.current.onLoaded(['mon:540:600:t1', 'tue:540:600:t1']);
    });
    await act(async () => {
      result.current.onShare().catch(() => {});
    });
    await act(async () => {
      result.current.onCharReady();
    });
    await drain(200);
    expect(mockCaptureAt).toHaveLength(1); // 즉시 찍힌다
  });

  test("'동작 줄이기'면 대기가 0이다 — 애니메이션이 없으니 기다릴 게 없다", async () => {
    mockReduce = true;
    const { result } = await setup(ENTER_MS);
    const loadedAt = Date.now();
    await act(async () => {
      result.current.onLoaded(['b0', 'b1', 'b2']);
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
    // onLoaded([])에 마감 시각을 잡으면 기록 없는 사용자만 1.16초 무반응이 된다(codex 리뷰)
    const { result } = await setup(ENTER_MS);
    const loadedAt = Date.now();
    await act(async () => {
      result.current.onLoaded([]);
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
      result.current.onLoaded(['b0', 'b1', 'b2', 'b3']);
    });
    await drain(ENTER_MS + 50); // 진입 종료

    await act(async () => {
      result.current.onLoaded(['b0', 'b1', 'b2', 'b3']); // 재조회 완료 — 개수 동일
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
