// 세션 만료 안내가 **전면 오버레이 자리를 스스로 쥐는가**(GROMO-1576).
//
// 문구·세대 전달은 sessionErrors.test.ts가 잠근다. 여기서 보는 것은 한 가지 성질뿐이다:
// 이 안내는 **호출부가 이미 쥔 등록 위에** 얹히는데(시트·화면이 결과 모달을 막고 있는 상태),
// 그 등록은 **배경 이벤트로 사라질 수 있다** — 초대 딥링크가 그룹 찾기 시트를 닫거나,
// BET_RESULT 재조회가 챌린지 카드를 빼거나, 방 이탈이 작성 시트를 내리는 경우다. 네이티브
// Alert는 그때도 그대로 떠 있으므로, 자리가 비면 결과 모달이 **이 안내 뒤에서** 마운트되며
// 사용자가 못 본 회차에 seen/ack이 찍힌다.
//
// ⚠️ 호출부 6곳을 각각 잠그지 않는다 — 자리를 쥐는 주체가 안내 자신이라 **한 곳**에서 성립한다.
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
