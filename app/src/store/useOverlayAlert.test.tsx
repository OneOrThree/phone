// 네이티브 Alert의 조정자 편입(GROMO-1576) — **헬퍼 단위로** 잠근다.
//
// 이 배치에서 같은 뿌리의 결함이 다섯 번 나왔고, 넷을 자리마다 고쳤더니 계속 새 자리가 나왔다.
// 그래서 마지막은 수단으로 닫았다 — 여기서 보는 것은 "이 헬퍼를 통과한 Alert는 떠 있는 동안
// 결과 모달이 마운트되지 못하게 한다"는 **한 가지 성질**이다. 호출부가 그 헬퍼를 쓰는지는
// 각 화면 테스트가 Alert 호출 형태로 확인한다.
import { act, render } from '@testing-library/react-native';
import { Alert, type AlertButton } from 'react-native';
import {
  OVERLAY_PRIORITY,
  OverlaySlotProvider,
  useOverlayLiveMaxPriority,
  useOverlayMaxPriority,
  useOverlaySlotActions,
} from './OverlaySlotContext';
import { useOverlayAlert } from './useOverlayAlert';

// 조정자에 지금 무엇이 등록돼 있는지를 그대로 읽는 관찰자.
// ⚠️ "결과가 pending이 되는가"로 보면 안 된다 — 조정자는 보유자를 뺏지 않으므로, 결과가 먼저
//    자리를 쥔 상태라면 Alert는 pending이 될 뿐이다. **결과 모달이 스스로 물러나는 근거**가
//    바로 이 최고 우선순위 값이다(ChallengeResultHost의 `yieldsSlot`). 그래서 그 값을 본다.
function PriorityProbe({ onValue }: { onValue: (value: number) => void }) {
  onValue(useOverlayMaxPriority());
  return null;
}

// 렌더를 기다리지 않고 **지금 이 순간** 등록 상태를 읽는 통로 — 동기 점유를 확인할 때 쓴다.
let liveMaxPriority: () => number = () => -1;
// 테스트가 임의의 오버레이로 자리를 쥐는 통로 — 돌려받은 함수를 부르면 반납한다.
let holdSlot: (id: string, priority: number) => () => void = () => () => undefined;
function LiveProbe() {
  liveMaxPriority = useOverlayLiveMaxPriority();
  const actions = useOverlaySlotActions();
  holdSlot = (id, priority) => {
    actions?.request(id, priority);
    return () => actions?.release(id);
  };
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
      <LiveProbe />
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

// ⚠️ 조정자가 약속한 배타가 새는 자리다 — 열거 문제가 아니라 **계약 자체**의 문제라 잠근다.
//    자리를 state로 잡으면 `setState → 렌더 → effect` 순서라 `Alert.alert()`이 **이미 뜬 뒤에**
//    등록된다. 그 창에서 claim이 끝나면 결과 모달이 아래에 함께 마운트된다.
test('자리는 Alert가 뜨기 **전에** 잡힌다 — 같은 호출 안에서 동기로', () => {
  let priorityWhenShown = -1;
  alertSpy.mockImplementation(() => {
    // Alert가 실제로 떠 있는 그 순간의 등록 상태를 읽는다.
    priorityWhenShown = liveMaxPriority();
  });

  // ⚠️ act로 감싸지 않는다 — 감싸면 렌더·이펙트가 함께 흘러가 "동기인가"를 못 본다.
  showAlert?.('삭제할까요?', '되돌릴 수 없어요.', [{ text: '확인' }]);

  expect(priorityWhenShown).toBe(OVERLAY_PRIORITY.sheet);
});

// Android의 DialogModule은 새 Alert를 띄우며 기존 것을 dismissExisting()으로 닫는데,
// 그때 **버튼 콜백 대신 onDismiss만** 부른다. 이걸 안 이으면 대체된 Alert의 자리가 영영 남는다.
test('버튼 없이 onDismiss로 닫혀도 자리를 반납한다(Android 대체 경로)', async () => {
  await act(async () => {
    showAlert?.('첫 번째', '내용');
  });
  expect(latest()).toBe(OVERLAY_PRIORITY.sheet);

  const options = alertSpy.mock.calls[alertSpy.mock.calls.length - 1][3] as {
    onDismiss?: () => void;
  };
  expect(options.onDismiss).toBeDefined();

  await act(async () => {
    options.onDismiss?.();
  });
  expect(latest()).toBe(-1);
});

test('호출부가 준 onDismiss도 함께 불린다', async () => {
  const onDismiss = jest.fn();
  await act(async () => {
    showAlert?.('제목', '내용', [{ text: '확인' }], { onDismiss });
  });
  const options = alertSpy.mock.calls[alertSpy.mock.calls.length - 1][3] as {
    onDismiss?: () => void;
  };
  await act(async () => {
    options.onDismiss?.();
  });
  expect(onDismiss).toHaveBeenCalledTimes(1);
  expect(latest()).toBe(-1);
});

// ⚠️ `await` 뒤에 여는 Alert는 다르다 — 여는 시점을 응답이 정하므로, 기다리는 사이 결과 모달이
//    먼저 노출될 수 있다. 그러면 이 Alert가 그 **위를** 덮어, 사용자는 못 봤는데 seen/ack은
//    이미 찍힌 상태가 된다. 그래서 동기 변형과 달리 **승인을 받고** 띄운다.
describe('비동기 변형(afterSlot)', () => {
  test('다른 오버레이가 자리를 쥐고 있으면 띄우지 않고 기다린다', async () => {
    // 결과 모달이 먼저 자리를 쥔 상태를 만든다.
    let holder: (() => void) | null = null;
    await act(async () => {
      holder = holdSlot('test:result', OVERLAY_PRIORITY.challengeResult);
    });

    let done = false;
    await act(async () => {
      showAlert?.afterSlot('저장하지 못했어요', '잠시 후 다시 시도해 주세요.').then(() => {
        done = true;
      });
    });

    // 승인 전이라 아직 안 뜬다.
    expect(alertSpy).not.toHaveBeenCalled();
    expect(done).toBe(false);

    // 보유자가 놓으면 그때 뜬다 — 사용자의 통보가 증발하지 않는다.
    await act(async () => {
      holder?.();
    });
    await act(async () => {});

    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(done).toBe(true);
  });

  test('가릴 것이 없으면 곧바로 띄운다', async () => {
    await act(async () => {
      await showAlert?.afterSlot('저장하지 못했어요', '잠시 후 다시 시도해 주세요.');
    });
    expect(alertSpy).toHaveBeenCalledTimes(1);
  });
});

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
