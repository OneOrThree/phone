// SheetShell — 시트 12곳이 공유하는 껍데기라 여기서 깨지면 전부 깨진다.
//
// 여기서 잠그는 것(GROMO-1111):
//  1) 패널 높이 상한 = 가용 높이의 85%. 상한이 없으면 내용이 긴 시트가 화면을 넘겨
//     딤도 그랩바도 화면 밖으로 밀리고 **닫을 수단이 통째로 사라진다**(원 신고 내용).
//  2) 상한을 넘칠 때만 내부 스크롤이 켜진다. 넘치지 않는 시트는 지금과 똑같이 두기 위해서다.
//  3) 그랩바를 아래로 충분히 끌면 닫힌다. 제출 중(dismissible=false)에는 제자리로 돌아간다.
//  4) 딤 탭 닫기(종전 동작)는 그대로다.
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { SheetShell } from './SheetShell';

// 테스트 트리엔 SafeAreaProvider가 없다 — 각 시트 테스트와 같은 고정값 관행을 따른다.
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 47, left: 0, right: 0, bottom: 34 }),
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

async function renderShell(props: { dismissible?: boolean } = {}) {
  const result = await render(
    <SheetShell onClose={onClose} {...props}>
      <Text>내용</Text>
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

// 뷰포트·내용 높이를 알려 준다 — 실제 레이아웃이 없는 jest에서 스크롤 판정을 재현하는 유일한 축이다.
async function reportSizes(viewport: number, content: number) {
  const scroll = screen.getByTestId('sheetShell.scroll');
  await act(async () => {
    fireEvent(scroll, 'layout', { nativeEvent: { layout: { height: viewport, width: 375 } } });
    fireEvent(scroll, 'contentSizeChange', 375, content);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPanConfigs.length = 0;
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
  // onClose는 내려가는 애니메이션(180ms)이 끝난 뒤에 불리므로 그만큼 실제로 기다린다
  // (가짜 타이머를 켜면 RNTL의 비동기 render 자체가 진행되지 않는다).
  async function release(g: { dy: number; vy: number }) {
    await act(async () => {
      mockPanConfigs[0].onPanResponderRelease({}, g);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
  }

  test('아래로 충분히 끌면 닫힌다', async () => {
    await renderShell();
    await release({ dy: 200, vy: 0 });
    expect(onClose).toHaveBeenCalled();
  });

  test('조금만 끌면 닫히지 않는다', async () => {
    await renderShell();
    await release({ dy: 20, vy: 0 });
    expect(onClose).not.toHaveBeenCalled();
  });

  test('제출 중(dismissible=false)에는 아무리 끌어도 닫히지 않는다', async () => {
    await renderShell({ dismissible: false });
    await release({ dy: 400, vy: 3 });
    expect(onClose).not.toHaveBeenCalled();
  });

  test('그랩바에는 무엇을 하는 손잡이인지 라벨이 붙어 있다', async () => {
    await renderShell();
    expect(screen.getByLabelText('아래로 끌어 닫기')).toBeOnTheScreen();
  });
});

describe('딤 탭 닫기', () => {
  test('딤을 누르면 onClose가 불린다', async () => {
    await renderShell();
    fireEvent.press(screen.getByTestId('sheetShell.dim'));
    expect(onClose).toHaveBeenCalled();
  });
});
