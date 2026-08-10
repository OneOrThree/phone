// TimerMethodSheet — 이 시트가 잠그는 계약은 둘이고, **하네스가 서로 배타적이라** 파일 안에서
// describe 단위로 갈라 둔다.
//
// ① 선택 진행 게이트 (PR #558) — '동작 줄이기' 설정이 **확정되기 전에는** 진행 시퀀스를
//    시작하지 않는다. 미확정 구간의 useReduceMotion은 보수적으로 true라, 그대로 시작하면
//    대기가 0으로 눌려 설정을 켜지 않은 사용자도 알약 슬라이드를 통째로 잃는다. 탭은 씹지 않고
//    보류했다가 확정된 값으로 진행하는지까지 본다. → **가짜 타이머**로 시간을 밀어 본다.
//
// ② 퇴장 중 예약 취소 (PR #559) — 진행이 예약된 뒤 시트를 닫으면 예약된 onSelect가 실행되지
//    않는다. 종전에는 닫기 = 즉시 언마운트라 cleanup이 그 자리에서 예약을 지웠지만, 이제
//    onClose는 퇴장 220ms **뒤에** 불린다. 선택 250ms 뒤에 닫으면 410ms 예약이 470ms인 퇴장
//    완료보다 먼저 발화해, 사용자가 취소했는데도 세션이 시작된다.
//    → **실시간**이어야 한다. 가짜 타이머를 켜면 RNTL 14의 비동기 render 자체가 진행되지 않아
//      퇴장 구간을 재현할 수 없다. 그래서 ①과 같은 beforeEach를 쓸 수 없다.
//
// ⚠️ 중간 프레임·타이밍 곡선은 단언하지 않는다 — jest에서 워클릿·CSS 전환은 목이라 거짓
//    안정감만 준다. 여기서 보는 건 "언제 onSelect가 올라오는가"라는 순서 계약뿐이다.
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { TimerMethodSheet } from './TimerMethodSheet';

let mockReduce = true;
let mockReady = false;
// ⚠️ 두 export를 모두 목킹해야 한다 — 하나만 두면 나머지를 쓰는 코드가 undefined를 부른다.
jest.mock('@/hooks/useReduceMotion', () => ({
  useReduceMotion: () => mockReduce,
  useReduceMotionReady: () => mockReady,
  whenReduceMotionReady: () => Promise.resolve(),
}));

// 네이티브 리퀴드 글래스는 jest에서 로드할 수 없다 — 연출 스타일은 빈 값으로 두고,
// 대기 시간(SLIDE_MS)만 고정값으로 준다. 컴포넌트는 SLIDE_MS + 60을 기다린다.
const MOCK_SLIDE_MS = 350;
jest.mock('@/components/liquidGlass', () => ({
  SLIDE_MS: 350,
  glassSlide: {},
  glassPill: {},
}));
const WAIT_MS = MOCK_SLIDE_MS + 60;

// SheetShell이 useSafeAreaInsets를 쓴다 — 테스트 트리엔 Provider가 없어 고정값으로 대체한다.
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 47, left: 0, right: 0, bottom: 34 }),
}));

// ⚠️ 파일 스코프에서 가짜 타이머를 켜지 않는다 — ②가 실시간을 요구한다. 각 describe가 스스로 켠다.

describe('TimerMethodSheet 선택 진행 게이트', () => {
  beforeEach(() => {
    mockReduce = true;
    mockReady = false;
    jest.clearAllMocks();
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  const advance = async (ms: number) => {
    await act(async () => {
      jest.advanceTimersByTime(ms);
    });
  };

  async function renderSheet() {
    const onSelect = jest.fn();
    const onClose = jest.fn();
    const view = await render(
      <TimerMethodSheet subjectName="수학" onSelect={onSelect} onClose={onClose} />,
    );
    // 알약 위치는 onLayout으로만 정해진다. 측정 전 탭은 "연출 생략하고 바로 진행"이라는
    // 별도 분기라, 레이아웃을 흘려보내야 실제 슬라이드 시퀀스 경로를 탄다.
    await fireEvent(screen.getByTestId('focus.mode.countup'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 300, height: 60 } },
    });
    const rerender = () =>
      view.rerender(<TimerMethodSheet subjectName="수학" onSelect={onSelect} onClose={onClose} />);
    return { onSelect, rerender };
  }

  test('설정이 확정되기 전에는 진행 시퀀스를 시작하지 않는다', async () => {
    const { onSelect } = await renderSheet();
    await fireEvent.press(screen.getByTestId('focus.mode.countup'));
    expect(onSelect).not.toHaveBeenCalled();
    // 아무리 기다려도 시작 자체가 없어야 한다 — 보수적 reduce=true로 즉시 진행하면 여기서 잡힌다.
    await advance(WAIT_MS * 5);
    expect(onSelect).not.toHaveBeenCalled();
  });

  test('확정되면 보류해 둔 탭이 확정된 값으로 진행한다 — 확정 전 탭도 씹히지 않는다', async () => {
    const { onSelect, rerender } = await renderSheet();
    await fireEvent.press(screen.getByTestId('focus.mode.countup'));
    // 미확정 구간에서는 시간이 아무리 흘러도 진행이 없다(대기가 0으로 눌리지 않았다).
    await advance(WAIT_MS * 5);
    expect(onSelect).not.toHaveBeenCalled();

    // 실제 설정은 꺼져 있었다 — 확정되면 알약이 미끄러질 시간을 기다려야 한다.
    mockReady = true;
    mockReduce = false;
    await rerender();
    expect(onSelect).not.toHaveBeenCalled();

    await advance(WAIT_MS);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('countup');
  });

  test('reduce=true로 확정되면 기다릴 연출이 없어 곧바로 진행한다', async () => {
    mockReady = true;
    mockReduce = true;
    const { onSelect } = await renderSheet();
    await fireEvent.press(screen.getByTestId('focus.mode.countup'));
    await advance(0);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('countup');
  });

  test('확정 전에 여러 번 눌러도 진행은 한 번뿐이다', async () => {
    const { onSelect, rerender } = await renderSheet();
    await fireEvent.press(screen.getByTestId('focus.mode.countup'));
    await fireEvent.press(screen.getByTestId('focus.mode.countup'));
    mockReady = true;
    mockReduce = false;
    await rerender();
    await advance(WAIT_MS * 3);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});

describe('TimerMethodSheet 퇴장 중 예약 취소', () => {
  // ⚠️ 이 블록은 **실시간**이다(위 파일 주석 ②). 그리고 '동작 줄이기'는 꺼짐·확정으로 고정한다 —
  //    켜져 있으면 퇴장이 재생되지 않고 즉시 닫혀(예약이 언마운트로 지워져) 잠그려는 220ms
  //    구간 자체가 사라진다.
  beforeEach(() => {
    mockReduce = false;
    mockReady = true;
    jest.clearAllMocks();
  });

  // 예약된 진행(SLIDE_MS+60)과 퇴장(220ms)이 모두 끝나고도 남을 만큼 실제로 기다린다.
  const SETTLE_MS = MOCK_SLIDE_MS + 400;

  async function renderSheet() {
    const onSelect = jest.fn();
    const onClose = jest.fn();
    await render(<TimerMethodSheet subjectName="수학" onSelect={onSelect} onClose={onClose} />);
    await act(async () => {});
    // 행 위치가 측정돼 있어야 연출을 태운 예약 경로로 간다(측정 전 탭은 즉시 진행이다).
    await act(async () => {
      fireEvent(screen.getByTestId('focus.mode.countup'), 'layout', {
        nativeEvent: { layout: { y: 0, height: 64, width: 335 } },
      });
      fireEvent(screen.getByTestId('sheetShell.panel'), 'layout', {
        nativeEvent: { layout: { height: 400, width: 375 } },
      });
    });
    return { onSelect, onClose };
  }

  async function press(testID: string) {
    await act(async () => {
      fireEvent.press(screen.getByTestId(testID));
    });
  }

  test('진행이 예약된 뒤 시트를 닫으면 예약된 onSelect는 실행되지 않는다', async () => {
    const { onSelect, onClose } = await renderSheet();
    await press('focus.mode.countup');
    await press('sheetShell.dim');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    });
    expect(onSelect).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('닫지 않으면 고른 방식으로 정상 진행한다', async () => {
    const { onSelect, onClose } = await renderSheet();
    await press('focus.mode.countup');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    });
    expect(onSelect).toHaveBeenCalledWith('countup');
    expect(onClose).not.toHaveBeenCalled();
  });
});
