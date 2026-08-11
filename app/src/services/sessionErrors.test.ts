// 유저 부재 안내(GROMO-1247)의 계약 테스트 — **세대 전달**이 핵심이다.
//
// 이 헬퍼가 세대 없이 triggerLogout을 부르면, 게스트→소셜 승격처럼 응답 **이후** 세션이 교체된
// 경우 죽은 세션의 404가 **새로 성립한 세션**을 로그아웃시킨다. 확인 버튼까지 시간이 열려 있어
// 그 구간이 정확히 세션 교체가 일어날 수 있는 자리라, 세대는 버릴 값이 아니라 이 응답이 어느
// 세션의 것인지 식별하는 표식이다(api.ts triggerLogout 계약 · App.tsx 로그아웃 핸들러가 대조).
import { Alert } from 'react-native';
import { triggerLogout } from '@/services/api';
import { promptSessionExpired, USER_NOT_FOUND } from './sessionErrors';

jest.mock('@/services/api', () => ({ triggerLogout: jest.fn() }));

const mockTriggerLogout = triggerLogout as jest.MockedFunction<typeof triggerLogout>;

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
});

test('신설 코드 문자열은 서버 계약 그대로다', () => {
  expect(USER_NOT_FOUND).toBe('USER_NOT_FOUND');
});

test('안내 문구·형태는 GROMO-1241 정본 그대로다(취소 없는 단일 확인)', () => {
  const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

  promptSessionExpired(3);

  expect(alertSpy).toHaveBeenCalledWith(
    '로그인이 필요해요',
    '로그인 정보가 만료됐어요. 다시 로그인해주세요.',
    [expect.objectContaining({ text: '확인' })],
    { cancelable: false },
  );
  // 안내가 떴다고 로그아웃되지는 않는다 — 사용자가 읽고 확인한 뒤다.
  expect(mockTriggerLogout).not.toHaveBeenCalled();
  alertSpy.mockRestore();
});

test('확인 시 **요청 시작 세대**를 그대로 triggerLogout에 넘긴다', () => {
  const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

  promptSessionExpired(7);
  pressConfirm(alertSpy);

  // 인자 없는 호출(triggerLogout())이면 App.tsx가 세대를 대조할 수 없어 새 세션까지 끊긴다.
  expect(mockTriggerLogout).toHaveBeenCalledWith(7);
  expect(mockTriggerLogout).not.toHaveBeenCalledWith(undefined);
  alertSpy.mockRestore();
});

// 세대 0도 유효한 값이다 — falsy라고 흘려보내면 첫 세션이 영원히 로그아웃되지 않는다.
test('세대 0도 그대로 넘어간다(falsy 흘림 방지)', () => {
  const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

  promptSessionExpired(0);
  pressConfirm(alertSpy);

  expect(mockTriggerLogout).toHaveBeenCalledWith(0);
  alertSpy.mockRestore();
});
