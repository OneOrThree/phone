// ToastContext — 큐잉·자동 해제·탭 해제·접근성 공지 경로.
//
// 여기서 잠그는 것:
//  1) 동시에 여러 번 show()해도 겹치지 않고 순차로 재생된다.
//  2) 2200ms가 지나면 사라진다.
//  3) 탭하면 즉시 사라진다.
//  4) 접근성 공지가 **플랫폼당 하나**다 — iOS는 announceForAccessibility, 안드로이드는
//     accessibilityLiveRegion. 양쪽을 다 단언한다: 한쪽만 잠그면 나머지 플랫폼이 조용히
//     깨지거나(iOS 벙어리) 같은 문구를 두 번 읽는다(안드로이드).
//
// ⚠️ 애니메이션 중간 프레임·이징은 단언하지 않는다(컨트랙트 §8). 워클릿은 jest에서 목이라
//    전부 거짓 안정감이다. 여기서 보는 건 "언제 붙고 언제 떨어지는가"뿐이다.
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, Platform } from 'react-native';
import { ToastProvider, useToast, type ToastOptions } from './ToastContext';

// reduce 상태에 따라 퇴장 지연(220 vs 0)이 달라져 타이머 전진량이 흔들린다 — 끄고 고정한다.
jest.mock('@/hooks/useReduceMotion', () => ({ useReduceMotion: () => false }));

const EXIT_MS = 220; // M.dur.quick

// 훅을 밖으로 꺼내 테스트가 직접 show()를 부른다(CharacterContext.test와 같은 방식).
let showFn: (options: ToastOptions) => void = () => {};

function Probe() {
  showFn = useToast().show;
  return null;
}

async function renderProvider() {
  return render(
    <ToastProvider>
      <Probe />
    </ToastProvider>,
  );
}

/** 타이머를 전진시키고 그로 인한 리렌더까지 흘린다. RTL 14에선 act도 await해야 반영된다. */
async function advance(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

/** 자동 해제(2200) + 퇴장(220)을 모두 넘겨 완전히 언마운트시킨다. */
async function runFullCycle() {
  await advance(2200);
  await advance(EXIT_MS);
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('ToastProvider', () => {
  it('show 전에는 아무것도 그리지 않는다', async () => {
    await renderProvider();
    expect(screen.queryByTestId('toast')).toBeNull();
  });

  it('동시 요청을 순차로 재생한다 — 겹쳐 쌓지 않는다', async () => {
    await renderProvider();
    await act(async () => {
      showFn({ message: '첫 번째' });
      showFn({ message: '두 번째' });
    });

    // 한 번에 한 장만 떠 있다.
    expect(screen.getAllByTestId('toast')).toHaveLength(1);
    expect(screen.getByTestId('toast.message')).toHaveTextContent('첫 번째');

    await runFullCycle();
    expect(screen.getAllByTestId('toast')).toHaveLength(1);
    expect(screen.getByTestId('toast.message')).toHaveTextContent('두 번째');

    await runFullCycle();
    expect(screen.queryByTestId('toast')).toBeNull();
  });

  it('2200ms가 지나면 사라진다 — 그 전에는 남아 있다', async () => {
    await renderProvider();
    await act(async () => {
      showFn({ message: '저장했어요' });
    });

    await advance(2199);
    expect(screen.getByTestId('toast.message')).toHaveTextContent('저장했어요');

    // 자동 해제(2200)로 퇴장이 시작되고, 퇴장 지연이 끝나야 언마운트된다.
    // 두 전진을 한 번에 합칠 수 없다 — 퇴장 타이머는 2200 지점의 리렌더 이펙트에서 걸린다.
    await advance(1);
    await advance(EXIT_MS);
    expect(screen.queryByTestId('toast')).toBeNull();
  });

  it('탭하면 자동 해제를 기다리지 않고 사라진다', async () => {
    await renderProvider();
    await act(async () => {
      showFn({ message: '복사했어요' });
    });

    await act(async () => {
      fireEvent.press(screen.getByTestId('toast'));
    });
    await advance(EXIT_MS);
    expect(screen.queryByTestId('toast')).toBeNull();
  });

  // ── 접근성: 플랫폼당 공지 경로 하나 ────────────────────────────────────────
  it('iOS에서는 announceForAccessibility로 읽어 주고, 라이브 리전은 걸지 않는다', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');

    await renderProvider();
    await act(async () => {
      showFn({ message: '집중 중에도 앱 3개를 쓸 수 있어요' });
    });

    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith('집중 중에도 앱 3개를 쓸 수 있어요');
    // 라이브 리전까지 걸면 안드로이드에서 두 번 읽힌다 — iOS에선 애초에 no-op이라 걸지 않는다.
    expect(screen.getByTestId('toast').props.accessibilityLiveRegion).toBeUndefined();
  });

  it('안드로이드에서는 라이브 리전만 쓰고 announceForAccessibility를 부르지 않는다', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');

    await renderProvider();
    await act(async () => {
      showFn({ message: '앱·카테고리 5개를 측정해요' });
    });

    expect(announce).not.toHaveBeenCalled();
    expect(screen.getByTestId('toast').props.accessibilityLiveRegion).toBe('polite');
  });
});
