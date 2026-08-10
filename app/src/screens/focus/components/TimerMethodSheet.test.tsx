// 타이머 방식 시트 — 옵션을 고르면 유리 알약이 미끄러진 뒤(SLIDE_MS+60) 다음 단계로 진행한다.
//
// 여기서 잠그는 것(GROMO-1381):
//  · 진행이 예약된 뒤 시트를 닫으면 **예약된 onSelect가 실행되지 않는다.**
//    종전에는 닫기 = 즉시 언마운트라 cleanup이 그 자리에서 예약을 지웠지만, 이제 onClose는
//    퇴장 220ms **뒤에** 불린다. 선택 250ms 뒤에 닫으면 410ms 예약이 470ms인 퇴장 완료보다
//    먼저 발화해, 사용자가 취소했는데도 세션이 시작되거나 다음 설정 시트가 열린다(codex 리뷰).
//
// ⚠️ 애니메이션 프레임·타이밍은 단언하지 않는다. 보는 것은 "무엇이 불렸는가"뿐이다.
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { TimerMethodSheet } from './TimerMethodSheet';
import { SLIDE_MS } from '@/components/liquidGlass';

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// 네이티브 리퀴드 글래스 패키지는 jest에서 로드할 수 없다(ESM·네이티브) — 폴백 경로로 고정한다.
// ⚠️ 우리 쪽 래퍼(@/components/liquidGlass)는 목하지 않는다 — 예약 지연(SLIDE_MS)이 진짜 값이어야
//    이 테스트가 실제 타이밍을 재현한다.
jest.mock('@callstack/liquid-glass', () => ({
  isLiquidGlassSupported: false,
  LiquidGlassView: 'LiquidGlassView',
}));

// '동작 줄이기'는 꺼짐·확정으로 고정한다 — 켜져 있으면 퇴장이 재생되지 않고 즉시 닫혀
// (예약이 언마운트로 지워져) 이 테스트가 잠그려는 220ms 구간 자체가 사라진다.
jest.mock('@/hooks/useReduceMotion', () => ({
  useReduceMotion: () => false,
  useReduceMotionReady: () => true,
  whenReduceMotionReady: () => Promise.resolve(),
}));

// 예약된 진행(SLIDE_MS+60)과 퇴장(220ms)이 모두 끝나고도 남을 만큼 실제로 기다린다.
// 가짜 타이머를 켜면 RNTL 14의 비동기 render 자체가 진행되지 않아 실시간으로 기다린다.
const SETTLE_MS = SLIDE_MS + 400;

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

beforeEach(() => jest.clearAllMocks());

describe('TimerMethodSheet', () => {
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
