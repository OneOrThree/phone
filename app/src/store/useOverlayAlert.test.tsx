// 네이티브 Alert의 조정자 편입(GROMO-1576) — **헬퍼 단위로** 잠근다.
//
// 이 배치에서 같은 뿌리의 결함이 다섯 번 나왔고, 넷을 자리마다 고쳤더니 계속 새 자리가 나왔다.
// 그래서 마지막은 수단으로 닫았다 — 여기서 보는 것은 "이 헬퍼를 통과한 Alert는 떠 있는 동안
// 결과 모달이 마운트되지 못하게 한다"는 **한 가지 성질**이다. 호출부가 그 헬퍼를 쓰는지는
// 각 화면 테스트가 Alert 호출 형태로 확인한다.
import { act, render } from '@testing-library/react-native';
import { Alert, type AlertButton } from 'react-native';
import { OVERLAY_PRIORITY, OverlaySlotProvider, useOverlayMaxPriority } from './OverlaySlotContext';
import { useOverlayAlert } from './useOverlayAlert';

// 조정자에 지금 무엇이 등록돼 있는지를 그대로 읽는 관찰자.
// ⚠️ "결과가 pending이 되는가"로 보면 안 된다 — 조정자는 보유자를 뺏지 않으므로, 결과가 먼저
//    자리를 쥔 상태라면 Alert는 pending이 될 뿐이다. **결과 모달이 스스로 물러나는 근거**가
//    바로 이 최고 우선순위 값이다(ChallengeResultHost의 `yieldsSlot`). 그래서 그 값을 본다.
function PriorityProbe({ onValue }: { onValue: (value: number) => void }) {
  onValue(useOverlayMaxPriority());
  return null;
}

let showAlert: ReturnType<typeof useOverlayAlert> | null = null;
function AlertOwner() {
  showAlert = useOverlayAlert('test:alert');
  return null;
}

function lastButtons(spy: jest.SpyInstance): AlertButton[] {
  const calls = spy.mock.calls;
  return calls[calls.length - 1][2] as AlertButton[];
}

let alertSpy: jest.SpyInstance;
const priorities: number[] = [];

beforeEach(async () => {
  priorities.length = 0;
  showAlert = null;
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  await render(
    <OverlaySlotProvider>
      <AlertOwner />
      <PriorityProbe onValue={(v) => priorities.push(v)} />
    </OverlaySlotProvider>,
  );
  await act(async () => {});
});

afterEach(() => {
  alertSpy.mockRestore();
});

function latest(): number {
  return priorities[priorities.length - 1];
}

test('Alert가 떠 있는 동안 sheet 우선순위로 자리를 점유한다', async () => {
  expect(latest()).toBe(-1); // 아무것도 등록돼 있지 않다

  await act(async () => {
    showAlert?.('삭제할까요?', '되돌릴 수 없어요.', [{ text: '취소' }, { text: '삭제' }]);
  });

  expect(alertSpy).toHaveBeenCalled();
  expect(latest()).toBe(OVERLAY_PRIORITY.sheet);
});

test('어느 버튼으로 닫혀도 자리를 반납한다', async () => {
  for (const pressed of ['취소', '삭제']) {
    await act(async () => {
      showAlert?.('삭제할까요?', '되돌릴 수 없어요.', [{ text: '취소' }, { text: '삭제' }]);
    });
    expect(latest()).toBe(OVERLAY_PRIORITY.sheet);

    await act(async () => {
      lastButtons(alertSpy)
        .find((button) => button.text === pressed)
        ?.onPress?.();
    });
    expect(latest()).toBe(-1);
  }
});

// 버튼을 안 넘긴 통보성 Alert가 이 부류의 대다수다 — RN이 확인 하나를 그리는데, 그대로 두면
// **닫힘을 알 방법이 없어** 자리를 영영 반납하지 못한다. 그래서 헬퍼가 같은 버튼을 명시한다.
test('버튼을 안 넘긴 통보도 자리를 잡고, 확인을 누르면 반납한다', async () => {
  await act(async () => {
    showAlert?.('저장하지 못했어요', '잠시 후 다시 시도해 주세요.');
  });
  expect(latest()).toBe(OVERLAY_PRIORITY.sheet);

  const buttons = lastButtons(alertSpy);
  expect(buttons).toHaveLength(1);
  await act(async () => {
    buttons[0].onPress?.();
  });
  expect(latest()).toBe(-1);
});

test('호출부의 onPress는 그대로 실행된다 — 반납이 동작을 삼키지 않는다', async () => {
  const onPress = jest.fn();
  await act(async () => {
    showAlert?.('삭제할까요?', undefined, [{ text: '삭제', onPress }]);
  });
  await act(async () => {
    lastButtons(alertSpy)[0].onPress?.();
  });
  expect(onPress).toHaveBeenCalledTimes(1);
  expect(latest()).toBe(-1);
});

// 실패 통보가 겹쳐 뜨는 경우(요청 둘이 각각 실패) — 하나를 닫았다고 나머지가 떠 있는데
// 자리를 놓으면, 남은 Alert 아래에서 결과가 확인 처리된다.
test('겹쳐 뜬 Alert는 마지막 하나가 닫혀야 반납한다', async () => {
  await act(async () => {
    showAlert?.('첫 번째 실패', '다시 시도해 주세요.');
  });
  const first = lastButtons(alertSpy);
  await act(async () => {
    showAlert?.('두 번째 실패', '다시 시도해 주세요.');
  });
  const second = lastButtons(alertSpy);
  expect(latest()).toBe(OVERLAY_PRIORITY.sheet);

  await act(async () => {
    first[0].onPress?.();
  });
  expect(latest()).toBe(OVERLAY_PRIORITY.sheet); // 아직 하나 남았다

  await act(async () => {
    second[0].onPress?.();
  });
  expect(latest()).toBe(-1);
});
