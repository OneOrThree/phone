// TimerMethodSheet — 잠그는 규칙: '동작 줄이기' 설정이 **확정되기 전에는**(콜드 스타트의
// 비동기 조회 구간) 선택 진행 시퀀스를 시작하지 않는다(codex 리뷰, PR #558).
// 미확정 구간의 useReduceMotion은 보수적으로 true라, 그대로 시작하면 대기가 0으로 눌려
// 설정을 켜지 않은 사용자도 알약 슬라이드를 통째로 잃는다. 탭은 씹지 않고 보류했다가
// 확정된 값으로 진행하는지까지 본다.
//
// ⚠️ 중간 프레임·타이밍 곡선은 단언하지 않는다 — jest에서 워클릿·CSS 전환은 목이라
//    거짓 안정감만 준다. 여기서 보는 건 "언제 onSelect가 올라오는가"라는 순서 계약뿐이다.
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

beforeEach(() => {
  mockReduce = true;
  mockReady = false;
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

describe('TimerMethodSheet 선택 진행 게이트', () => {
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
