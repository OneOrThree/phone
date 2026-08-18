// 유저 부재 안내(GROMO-1247)의 계약 테스트 — **세대 전달**이 핵심이다.
//
// 이 헬퍼가 세대 없이 triggerLogout을 부르면, 게스트→소셜 승격처럼 응답 **이후** 세션이 교체된
// 경우 죽은 세션의 404가 **새로 성립한 세션**을 로그아웃시킨다. 확인 버튼까지 시간이 열려 있어
// 그 구간이 정확히 세션 교체가 일어날 수 있는 자리라, 세대는 버릴 값이 아니라 이 응답이 어느
// 세션의 것인지 식별하는 표식이다(api.ts triggerLogout 계약 · App.tsx 로그아웃 핸들러가 대조).
import { Alert } from 'react-native';
import { getAuthSessionGeneration, triggerLogout } from '@/services/api';
import { promptSessionExpired, USER_NOT_FOUND } from './sessionErrors';

jest.mock('@/services/api', () => ({
  getAuthSessionGeneration: jest.fn(() => 0),
  triggerLogout: jest.fn(),
}));

const mockTriggerLogout = triggerLogout as jest.MockedFunction<typeof triggerLogout>;
const mockGetAuthSessionGeneration = getAuthSessionGeneration as jest.MockedFunction<
  typeof getAuthSessionGeneration
>;

// ⚠️ 표시가 **비동기**다 — 사용자 조작으로만 닫히는 오버레이(결과 모달)가 노출 중이면 그것이
//    닫힐 때까지 미루기 때문에, 없을 때도 마이크로태스크 한 번을 지난다(sessionErrors.ts).
async function flushPrompt(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

// Alert.alert(title, message, buttons, options)에서 확인 버튼을 꺼내 누른다.
function pressConfirm(alertSpy: jest.SpyInstance): void {
  const [, , buttons] = alertSpy.mock.calls[0] as unknown as [
    string,
    string,
    { text: string; onPress?: () => void }[],
  ];
  buttons[0].onPress?.();
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetAuthSessionGeneration.mockReturnValue(0);
});

test('신설 코드 문자열은 서버 계약 그대로다', () => {
  expect(USER_NOT_FOUND).toBe('USER_NOT_FOUND');
});

test('안내 문구·형태는 GROMO-1241 정본 그대로다(취소 없는 단일 확인)', async () => {
  const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  mockGetAuthSessionGeneration.mockReturnValue(3);

  promptSessionExpired(3);
  await flushPrompt();

  expect(alertSpy).toHaveBeenCalledWith(
    '로그인이 필요해요',
    '로그인 정보가 만료됐어요. 다시 로그인해 주세요.',
    [expect.objectContaining({ text: '확인' })],
    // onDismiss가 붙는다 — 버튼을 안 거치고 닫히는 경로(Android)에서도 자리를 반납해야 한다.
    expect.objectContaining({ cancelable: false }),
  );
  // 안내가 떴다고 로그아웃되지는 않는다 — 사용자가 읽고 확인한 뒤다.
  expect(mockTriggerLogout).not.toHaveBeenCalled();
  // ⚠️ **띄운 안내는 반드시 닫는다.** 안 닫으면 그 hold가 모듈 Set에 남고, 이후 마운트되는
  //    Provider마다 **다시 등록**된다(holdOverlaySlotForNativeSurface). 이 파일엔 Provider가
  //    없어 지금은 무해하지만, 규약을 어기는 테스트를 남기면 안 된다.
  pressConfirm(alertSpy);
  alertSpy.mockRestore();
});

test('확인 시 **요청 시작 세대**를 그대로 triggerLogout에 넘긴다', async () => {
  const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  mockGetAuthSessionGeneration.mockReturnValue(7);

  promptSessionExpired(7);
  await flushPrompt();
  // 표시 이후 세션이 교체될 수 있다 — 그 구간은 세대를 넘겨 App.tsx가 대조한다(②).
  mockGetAuthSessionGeneration.mockReturnValue(8);
  pressConfirm(alertSpy);

  // 인자 없는 호출(triggerLogout())이면 App.tsx가 세대를 대조할 수 없어 새 세션까지 끊긴다.
  expect(mockTriggerLogout).toHaveBeenCalledWith(7);
  expect(mockTriggerLogout).not.toHaveBeenCalledWith(undefined);
  alertSpy.mockRestore();
});

// 세대 0도 유효한 값이다 — falsy라고 흘려보내면 첫 세션이 영원히 로그아웃되지 않는다.
test('세대 0도 그대로 넘어간다(falsy 흘림 방지)', async () => {
  const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

  promptSessionExpired(0);
  await flushPrompt();
  pressConfirm(alertSpy);

  expect(mockTriggerLogout).toHaveBeenCalledWith(0);
  alertSpy.mockRestore();
});

// ① 응답→표시 구간의 교체 — 게스트→소셜 승격이 응답 **뒤에** 끝나면, 방금 로그인에 성공한
// 사용자에게 "로그인 정보가 만료됐어요"가 뜨고 cancelable:false라 확인 말고는 닫을 수도 없다.
// 로그아웃은 ②가 막지만 **안내 자체가 거짓말**이므로 띄우기 전에 버려야 한다.
test('낡은 세대의 응답은 Alert조차 띄우지 않는다(로그아웃도 없다)', () => {
  const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  // 요청은 세대 4에서 나갔는데 응답이 도착했을 땐 이미 5(새 세션 성립).
  mockGetAuthSessionGeneration.mockReturnValue(5);

  promptSessionExpired(4);

  expect(alertSpy).not.toHaveBeenCalled();
  expect(mockTriggerLogout).not.toHaveBeenCalled();
  alertSpy.mockRestore();
});
