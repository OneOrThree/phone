// SheetShell — 시트 14곳이 공유하는 껍데기라 여기서 깨지면 전부 깨진다.
//
// 여기서 잠그는 것(GROMO-1111):
//  1) 패널 높이 상한 = 가용 높이의 85%. 상한이 없으면 내용이 긴 시트가 화면을 넘겨
//     딤도 그랩바도 화면 밖으로 밀리고 **닫을 수단이 통째로 사라진다**(원 신고 내용).
//  2) 상한을 넘칠 때만 내부 스크롤이 켜진다. 넘치지 않는 시트는 지금과 똑같이 두기 위해서다.
//  3) 그랩바를 아래로 충분히 끌면 닫힌다. 제출 중(dismissible=false)에는 제자리로 돌아간다.
//  4) 딤 탭 닫기(종전 동작)는 그대로다.
//
// 여기서 추가로 잠그는 것(GROMO-1381 — 등장/퇴장 상태 기계):
//  5) 닫기(딤 탭·드래그·CTA)는 **퇴장 애니메이션이 끝난 뒤** onClose를 부른다.
//  6) '동작 줄이기'가 켜져 있으면 애니메이션 스타일이 아예 붙지 않고 닫기는 즉시다.
//  7) useSheetClose()가 시트 안 CTA의 닫기를 가로챈다.
//
// ⚠️ 작성 금지: 애니메이션 중간 프레임·타이밍·이징 곡선 단언. 워클릿은 목이라 전부 거짓 안정감이다.
//    여기서 보는 것은 **판정 규칙과 최종 상태**뿐이다.
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Text, TouchableOpacity } from 'react-native';
import { getAnimatedStyle } from 'react-native-reanimated';
import { SheetShell, useSheetClose } from './SheetShell';

// 테스트 트리엔 SafeAreaProvider가 없다 — 각 시트 테스트와 같은 고정값 관행을 따른다.
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 47, left: 0, right: 0, bottom: 34 }),
}));

// '동작 줄이기' 스위치 — 기본은 꺼짐(애니메이션 켬)·확정됨. 해당 테스트만 켜서 확인한다.
// ready는 "이 값이 실제 설정으로 **확정**됐는가"다 — 콜드 스타트 직후에는 false다.
// (jest.mock 팩토리가 참조할 수 있게 mock 접두사를 붙인다.)
const mockReduce = { on: false, ready: true };
jest.mock('@/hooks/useReduceMotion', () => ({
  useReduceMotion: () => mockReduce.on,
  useReduceMotionReady: () => mockReduce.ready,
}));

// PanResponder는 내부 gestureState를 touchHistory로만 갱신해 jest로 제스처를 흉내 낼 수 없다.
// 생성 시 넘긴 config를 가로채 릴리스 콜백을 직접 부른다(제스처가 아니라 **판정 규칙**을 잠근다).
const mockPanConfigs: Record<string, (e: unknown, g: { dy: number; vy: number }) => void>[] = [];
jest.mock('react-native/Libraries/Interaction/PanResponder', () => {
  const create = (config: Record<string, unknown>): { panHandlers: object } => {
    mockPanConfigs.push(config as never);
    return { panHandlers: {} };
  };
  return { __esModule: true, default: { create } };
});

const onClose = jest.fn();

// jest 기본 화면(RN Dimensions 목) 높이. 상한은 이 값의 85%다.
const SCREEN_HEIGHT = 1334;
// 퇴장(M.dur.quick 220ms)이 끝나고 완료 콜백이 돌 때까지 실제로 기다리는 여유.
// 가짜 타이머를 켜면 RNTL 14의 비동기 render 자체가 진행되지 않아 실시간으로 기다린다.
const EXIT_SETTLE_MS = 400;
// 등장 스프링(snappy)이 완전히 멎을 때까지 기다리는 여유. 여기서 보는 것은 **정지 상태**뿐이다.
const ENTER_SETTLE_MS = 800;

async function renderShell(props: { dismissible?: boolean; children?: React.ReactNode } = {}) {
  const { children, ...rest } = props;
  const result = await render(
    <SheetShell onClose={onClose} {...rest}>
      {children ?? <Text>내용</Text>}
    </SheetShell>,
  );
  await act(async () => {});
  return result;
}

// 패널에 실제로 적용된 스타일을 평탄화해 읽는다(배열 스타일이라 그대로는 못 본다).
function panelStyle(): Record<string, unknown> {
  const raw = screen.getByTestId('sheetShell.panel').props.style;
  return Object.assign({}, ...[raw].flat(Infinity).filter(Boolean));
}

// 패널에 **지금 실제로 걸려 있는** translateY. props.style은 첫 렌더 스냅샷이라 이후 값을
// 반영하지 않으므로 reanimated가 주는 조회 도구를 쓴다.
// ⚠️ 이 값으로 단언해도 되는 것은 **정지 상태**(등장 전 화면 밖 / 안착 후 0 / 퇴장 완료 후)뿐이다.
//    재생 중 프레임 값은 단언하지 않는다.
function panelTranslateY(): number {
  const style = getAnimatedStyle(screen.getByTestId('sheetShell.panel')) as {
    transform: { translateY: number }[];
  };
  return style.transform[0].translateY;
}

// 패널 레이아웃 보고 — 등장 트리거가 useEffect가 아니라 onLayout이라(설계 §4.2)
// 실제 레이아웃이 없는 jest에서는 여기서 높이를 직접 알려 줘야 등장이 시작된다.
async function reportPanelHeight(height: number) {
  await act(async () => {
    fireEvent(screen.getByTestId('sheetShell.panel'), 'layout', {
      nativeEvent: { layout: { height, width: 375 } },
    });
  });
}

// 뷰포트·내용 높이를 알려 준다 — 실제 레이아웃이 없는 jest에서 스크롤 판정을 재현하는 유일한 축이다.
async function reportSizes(viewport: number, content: number) {
  const scroll = screen.getByTestId('sheetShell.scroll');
  await act(async () => {
    fireEvent(scroll, 'layout', { nativeEvent: { layout: { height: viewport, width: 375 } } });
    fireEvent(scroll, 'contentSizeChange', 375, content);
  });
}

// 탭은 반드시 act 안에서 — 밖에서 쏘면 리액트 업데이트가 act 밖으로 새어 나가
// **다음 테스트의 렌더까지 망가진다**(overlapping act 경고와 함께 트리가 비어 버린다).
async function press(testID: string) {
  await act(async () => {
    fireEvent.press(screen.getByTestId(testID));
  });
}

// 퇴장 애니메이션이 끝나 완료 콜백(onClose)이 돌 때까지 기다린다.
async function settleExit() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, EXIT_SETTLE_MS));
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPanConfigs.length = 0;
  mockReduce.on = false;
  mockReduce.ready = true;
});

describe('패널 높이 상한', () => {
  test('패널 높이는 화면의 85%를 넘지 않는다', async () => {
    await renderShell();
    expect(panelStyle().maxHeight).toBeCloseTo(SCREEN_HEIGHT * 0.85);
  });
});

describe('내부 스크롤', () => {
  test('내용이 상한 안에 들어가면 스크롤은 꺼져 있다 — 종전 시트와 한 픽셀도 다르지 않다', async () => {
    await renderShell();
    await reportSizes(600, 400);
    expect(screen.getByTestId('sheetShell.scroll').props.scrollEnabled).toBe(false);
  });

  test('내용이 뷰포트를 넘치면 스크롤이 켜진다', async () => {
    await renderShell();
    await reportSizes(600, 900);
    expect(screen.getByTestId('sheetShell.scroll').props.scrollEnabled).toBe(true);
  });

  test('내용이 뷰포트보다 딱 1pt 크면 아직 켜지 않는다 — 소수점 진동 방지 여유', async () => {
    await renderShell();
    await reportSizes(600, 601);
    expect(screen.getByTestId('sheetShell.scroll').props.scrollEnabled).toBe(false);
  });

  test('키보드가 떠 있어도 첫 탭이 자식 버튼에 닿는다(keyboardShouldPersistTaps)', async () => {
    await renderShell();
    expect(screen.getByTestId('sheetShell.scroll').props.keyboardShouldPersistTaps).toBe('handled');
  });

  test('자식은 스크롤 안에 그대로 렌더된다', async () => {
    await renderShell();
    expect(screen.getByText('내용')).toBeOnTheScreen();
  });
});

describe('그랩바 스와이프 닫기', () => {
  // 릴리스 판정만 부른다 — 임계치(dy 90 / vy 1.2)를 넘으면 닫고, 아니면 제자리로 돌아간다.
  // onClose는 퇴장 애니메이션이 끝난 뒤에 불리므로 그만큼 실제로 기다린다.
  async function release(g: { dy: number; vy: number }) {
    await act(async () => {
      mockPanConfigs[0].onPanResponderRelease({}, g);
    });
    await settleExit();
  }

  test('아래로 충분히 끌면 닫힌다', async () => {
    await renderShell();
    await reportPanelHeight(400);
    await release({ dy: 200, vy: 0 });
    expect(onClose).toHaveBeenCalled();
  });

  test('조금만 끌면 닫히지 않는다', async () => {
    await renderShell();
    await reportPanelHeight(400);
    await release({ dy: 20, vy: 0 });
    expect(onClose).not.toHaveBeenCalled();
  });

  test('제출 중(dismissible=false)에는 아무리 끌어도 닫히지 않는다', async () => {
    await renderShell({ dismissible: false });
    await reportPanelHeight(400);
    await release({ dy: 400, vy: 3 });
    expect(onClose).not.toHaveBeenCalled();
  });

  test('그랩바에는 무엇을 하는 손잡이인지 라벨이 붙어 있다', async () => {
    await renderShell();
    expect(screen.getByLabelText('아래로 끌어 닫기')).toBeOnTheScreen();
  });
});

describe('딤 탭 닫기', () => {
  // ⚠️ '퇴장 도중에는 아직 안 불렸다'는 중간 상태는 단언하지 않는다 — act()가 프레임 루프를
  //    끝까지 밀어 버려 재현되지 않고, 애초에 타이밍 단언은 이 파일의 금지 항목이다.
  //    여기서 잠그는 것은 "퇴장이 끝나면 정확히 한 번 불린다"는 최종 상태다.
  test('딤을 누르면 퇴장이 끝난 뒤 onClose가 불린다', async () => {
    await renderShell();
    await reportPanelHeight(400);
    await press('sheetShell.dim');
    await settleExit();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('퇴장 중 딤을 연타해도 onClose는 한 번만 불린다', async () => {
    await renderShell();
    await reportPanelHeight(400);
    await press('sheetShell.dim');
    await press('sheetShell.dim');
    await press('sheetShell.dim');
    await settleExit();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('제출 중(dismissible=false)에는 딤을 눌러도 닫히지 않는다', async () => {
    await renderShell({ dismissible: false });
    await reportPanelHeight(400);
    await press('sheetShell.dim');
    await settleExit();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('시트 안 CTA — useSheetClose()', () => {
  function Cta() {
    const close = useSheetClose();
    return (
      <TouchableOpacity testID="cta" onPress={close}>
        <Text>확인</Text>
      </TouchableOpacity>
    );
  }

  test('CTA가 닫기를 가로챈다 — 퇴장이 끝난 뒤에 onClose가 불린다', async () => {
    await renderShell({ children: <Cta /> });
    await reportPanelHeight(400);
    await press('cta');
    await settleExit();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('제출 중(dismissible=false)에는 CTA로도 닫히지 않는다', async () => {
    await renderShell({ dismissible: false, children: <Cta /> });
    await reportPanelHeight(400);
    await press('cta');
    await settleExit();
    expect(onClose).not.toHaveBeenCalled();
  });

  test('SheetShell 밖에서 부르면 조용히 죽지 않고 바로 터뜨린다', async () => {
    // 조용한 no-op이면 버튼이 죽은 채로 배포된다 — 배선 실수는 개발 중에 드러나야 한다.
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(render(<Cta />)).rejects.toThrow('SheetShell');
    spy.mockRestore();
  });
});

describe("'동작 줄이기'", () => {
  // ⚠️ 잠그는 건 "**애니메이션**이 없다"이지 "스타일이 없다"가 아니다(codex 리뷰).
  //    손가락을 따라오는 transform은 시간 기반 애니메이션이 아니라 **직접 조작**이라,
  //    떼면 패널이 꿈쩍도 않다가 임계를 넘는 순간 갑자기 사라진다. 딤도 드래그 진행률에
  //    연동돼 있어 떼면 끌어도 배경이 그대로다.
  test('직접 조작 스타일은 유지되고 등장은 즉시 최종 상태다', async () => {
    mockReduce.on = true;
    await renderShell();
    await reportPanelHeight(400);
    // transform은 붙어 있다 — 다만 등장 애니메이션 없이 이미 제자리(0)다.
    expect(panelStyle().transform).toBeDefined();
    const dimStyle = Object.assign(
      {},
      ...[screen.getByTestId('sheetShell.dim').props.style].flat(Infinity).filter(Boolean),
    );
    expect(dimStyle.opacity).toBeDefined();
  });

  test('닫기는 기다리지 않고 즉시 onClose를 부른다', async () => {
    mockReduce.on = true;
    await renderShell();
    await reportPanelHeight(400);
    await press('sheetShell.dim');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // ⚠️ 회귀 방어(codex 리뷰) — onCloseRef는 매 렌더 갱신된다(제출 중 무력화 등을 위해
  //    PanResponder가 최신값을 읽어야 하므로). 그런데 퇴장 220ms 사이에 부모가 다른 onClose를
  //    넘기면 완료 콜백이 **나중 것**을 실행한다. 실제 사고: 그룹 초대 A를 닫는 중 초대 B가
  //    도착하면 B를 캡처한 콜백이 실행되며 방금 온 B가 버퍼에서 지워졌다.
  //    닫기를 요청한 그 시점의 콜백을 붙잡아 둬야 한다.
  // ⚠️ 회귀 방어(codex 리뷰) — 콜드 스타트 직후 첫 시트는 AccessibilityInfo 조회보다 먼저
  //    레이아웃될 수 있다. 그 구간의 reduce=true는 실제 설정이 아니라 **미확정**을 뜻하는
  //    보수값인데, 그걸로 등장을 확정해 버리면(enteredRef) 나중에 false로 확정돼도 되돌릴 수
  //    없어 동작 줄이기를 쓰지 않는 사용자가 슬라이드업을 영구히 잃는다.
  //    확정 전에는 시트의 자연스러운 시작 상태 — **화면 밖** — 에 머물러야 한다.
  test('모션 설정이 미확정이면 등장을 확정하지 않고 화면 밖에 머문다', async () => {
    mockReduce.ready = false;
    mockReduce.on = true; // 미확정 구간의 보수값
    await renderShell();
    await reportPanelHeight(400);
    expect(panelTranslateY()).toBe(SCREEN_HEIGHT);
  });

  test('설정이 확정되면 보류해 둔 등장이 그제서야 재생돼 제자리에 안착한다', async () => {
    mockReduce.ready = false;
    mockReduce.on = true;
    const view = await render(
      <SheetShell onClose={onClose}>
        <Text>내용</Text>
      </SheetShell>,
    );
    await act(async () => {});
    await reportPanelHeight(400);
    // 실제 설정이 '동작 줄이기 꺼짐'으로 확정된다
    mockReduce.ready = true;
    mockReduce.on = false;
    await view.rerender(
      <SheetShell onClose={onClose}>
        <Text>내용</Text>
      </SheetShell>,
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, ENTER_SETTLE_MS));
    });
    expect(panelTranslateY()).toBeCloseTo(0);
  });

  test('퇴장 도중 onClose가 교체돼도 요청 시점의 콜백을 부른다', async () => {
    const first = jest.fn();
    const second = jest.fn();
    const view = await render(
      <SheetShell onClose={first}>
        <Text>내용</Text>
      </SheetShell>,
    );
    await act(async () => {});
    await reportPanelHeight(400);
    await press('sheetShell.dim');
    // 퇴장이 도는 사이에 부모가 새 콜백을 넘긴다
    await view.rerender(
      <SheetShell onClose={second}>
        <Text>내용</Text>
      </SheetShell>,
    );
    await settleExit();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });
});

describe('퇴장 목표 거리', () => {
  // ⚠️ 회귀 방어(codex 리뷰) — withTiming의 목표값은 한 번 정해지면 갱신되지 않는데, 퇴장 220ms
  //    동안 패널 높이는 얼마든지 커진다. 초대 시트의 로딩 화면에서 딤을 누른 직후 프리뷰가 도착해
  //    패널이 커지는 경우가 실제 사례다. 목표를 요청 시점 높이에 묶으면 늘어난 패널 상단이 퇴장이
  //    끝날 때까지 화면에 다시 드러난다. 여기서 보는 것은 **퇴장이 끝난 뒤의 정지 위치**다.
  test('퇴장 중 패널이 커져도 커진 높이만큼 화면 밖으로 나간다', async () => {
    await renderShell();
    await reportPanelHeight(200); // 로딩 화면 높이
    await press('sheetShell.dim');
    await reportPanelHeight(900); // 퇴장 중 내용이 도착해 패널이 커졌다
    await settleExit();
    expect(panelTranslateY()).toBeGreaterThanOrEqual(900);
  });
});
