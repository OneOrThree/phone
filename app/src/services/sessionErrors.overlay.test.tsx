// 세션 만료 안내가 **전면 오버레이 자리를 스스로 쥐는가**(GROMO-1576).
//
// 문구·세대 전달은 sessionErrors.test.ts가 잠근다. 여기서 보는 것은 한 가지 성질뿐이다:
// 이 안내는 **호출부가 이미 쥔 등록 위에** 얹히는데(시트·화면이 결과 모달을 막고 있는 상태),
// 그 등록은 **배경 이벤트로 사라질 수 있다** — 초대 딥링크가 그룹 찾기 시트를 닫거나,
// BET_RESULT 재조회가 챌린지 카드를 빼거나, 방 이탈이 작성 시트를 내리는 경우다. 네이티브
// Alert는 그때도 그대로 떠 있으므로, 자리가 비면 결과 모달이 **이 안내 뒤에서** 마운트되며
// 사용자가 못 본 회차에 seen/ack이 찍힌다.
//
// ⚠️ 호출부 15곳을 각각 잠그지 않는다 — 자리를 쥐는 주체가 안내 자신이라 **한 곳**에서 성립한다.
//
// ⚠️ 이 파일의 테스트는 띄운 Alert를 **반드시 전부 닫아야 한다.** 반납 카운트가 모듈 스코프라
//    (그것이 이 결함의 처방이다 — 아래 두 번째 테스트 주석) 닫지 않고 끝내면 그 값이 다음
//    테스트로 새어, 자리가 처음부터 점유된 채 시작한다.
import { act, render } from '@testing-library/react-native';
import { Alert } from 'react-native';
import {
  OVERLAY_PRIORITY,
  OverlaySlotProvider,
  useOverlayBlocker,
  useOverlayMaxPriority,
} from '@/store/OverlaySlotContext';
import { promptSessionExpired } from './sessionErrors';

jest.mock('@/services/api', () => ({
  getAuthSessionGeneration: jest.fn(() => 0),
  triggerLogout: jest.fn(),
}));

// 호출부가 쥔 등록(그룹 찾기 시트 · 챌린지 카드 시트 · 작성 시트가 하는 것과 같은 형태).
function Sheet({ active }: { active: boolean }) {
  useOverlayBlocker('test:sheet', active);
  return null;
}

function Probe({ onValue }: { onValue: (value: number) => void }) {
  onValue(useOverlayMaxPriority());
  return null;
}

test('안내가 떠 있는 동안 배경 이벤트로 시트가 닫혀도 자리는 유지되고, 확인하면 반납된다', async () => {
  const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const values: number[] = [];
  const tree = (sheetOpen: boolean) => (
    <OverlaySlotProvider>
      <Sheet active={sheetOpen} />
      <Probe onValue={(v) => values.push(v)} />
    </OverlaySlotProvider>
  );
  const view = await render(tree(true));
  await act(async () => {});
  const latest = () => values[values.length - 1];
  expect(latest()).toBe(OVERLAY_PRIORITY.sheet);

  // 시트 안의 요청이 유저 부재로 실패해 안내가 뜬다.
  await act(async () => {
    promptSessionExpired(0);
  });
  expect(alertSpy).toHaveBeenCalledTimes(1);

  // 배경 이벤트(초대 딥링크 수신 등)가 그 시트를 닫는다 — Alert는 사용자 앞에 그대로 남는다.
  await act(async () => {
    view.rerender(tree(false));
  });
  await act(async () => {});
  expect(latest()).toBe(OVERLAY_PRIORITY.sheet);

  // 반납 주체는 화면이 아니라 안내 자신이다 — 확인을 누르면 그때 비워진다.
  const [, , buttons] = alertSpy.mock.calls[0] as unknown as [
    string,
    string,
    { text: string; onPress?: () => void }[],
  ];
  await act(async () => {
    buttons[0].onPress?.();
  });
  await act(async () => {});
  expect(latest()).toBe(-1);

  alertSpy.mockRestore();
  view.unmount();
});

// ⚠️ **같은 안내를 서로 다른 화면이 동시에 띄운다.** USER_NOT_FOUND는 "계정 자체가 삭제됨"이라
//    진행 중이던 여러 요청이 나란히 이 코드를 받는다(호출부 15곳). 반납을 호출별 클로저에만
//    두면 **먼저 닫힌 쪽이 하나뿐인 registry 항목을 지운다** — 조정자의 release(id)에는 참조
//    카운트가 없다. Android는 dismissExisting으로 A가 닫히는데 B가 떠 있고, iOS는 A를 닫는
//    순간 큐의 B가 등록 없이 뜬다. 둘 다 그 틈에 결과 모달이 Alert 뒤에서 마운트·ack 된다.
//    ⚠️ 유지만 단정하면 영구 점유를 못 잡는다 — 마지막이 닫힐 때 반납되는 것까지 함께 본다.
test('두 화면이 겹쳐 띄우면 먼저 닫힌 쪽은 자리를 놓지 않고, 마지막이 닫을 때 반납한다', async () => {
  const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const values: number[] = [];
  const view = await render(
    <OverlaySlotProvider>
      <Probe onValue={(v) => values.push(v)} />
    </OverlaySlotProvider>,
  );
  await act(async () => {});
  const latest = () => values[values.length - 1];
  expect(latest()).toBe(-1);

  // 서로 다른 두 화면의 요청이 나란히 실패해 안내가 둘 뜬다.
  await act(async () => {
    promptSessionExpired(0);
    promptSessionExpired(0);
  });
  expect(alertSpy).toHaveBeenCalledTimes(2);
  expect(latest()).toBe(OVERLAY_PRIORITY.sheet);

  const buttonsOf = (index: number) =>
    alertSpy.mock.calls[index][2] as unknown as { text: string; onPress?: () => void }[];

  // 먼저 뜬 쪽이 닫힌다(Android의 dismissExisting이 정확히 이 순서다) — 아직 놓으면 안 된다.
  await act(async () => {
    buttonsOf(0)[0].onPress?.();
  });
  await act(async () => {});
  expect(latest()).toBe(OVERLAY_PRIORITY.sheet);

  // 마지막이 닫히는 순간 비워진다.
  await act(async () => {
    buttonsOf(1)[0].onPress?.();
  });
  await act(async () => {});
  expect(latest()).toBe(-1);

  alertSpy.mockRestore();
  view.unmount();
});
