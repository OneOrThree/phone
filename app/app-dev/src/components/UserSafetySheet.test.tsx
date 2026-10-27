import assert from 'node:assert/strict';
import { Linking, StyleSheet } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { UserSafetySheet } from '@/components/UserSafetySheet';
import { componentTokens } from '@/design-system/tokens';
import { ApiError } from '@/services/api/client';
import { blockUser, getBlockedUsers } from '@/services/api/safety';
import { applyLocalePref } from '@/i18n';
import { isUserBlocked, replaceBlockedUsers } from '@/services/blockedUsers';

const mockAppLayout = {
  width: 402,
  height: 874,
  fontScale: 1,
  tablet: false,
  landscape: false,
  compact: false,
  contentWidth: 402,
  gutter: 20,
  floatingWidth: 362,
  modalWidth: 362,
  insets: { top: 52, bottom: 32, left: 0, right: 0 },
};

jest.mock('@/utils/layout', () => ({
  useAppLayout: () => mockAppLayout,
}));

jest.mock('@/services/api/safety', () => ({
  ...jest.requireActual('@/services/api/safety'),
  blockUser: jest.fn(),
  getBlockedUsers: jest.fn(),
}));

const blockMock = blockUser as jest.Mock;
const blockedUsersMock = getBlockedUsers as jest.Mock;
let openUrlMock: jest.SpyInstance;

type TestProps = React.ComponentProps<typeof UserSafetySheet> & {
  onClose: jest.Mock;
  onChanged: jest.Mock;
  onMessage: jest.Mock;
};

const props = (over: Partial<React.ComponentProps<typeof UserSafetySheet>> = {}): TestProps =>
  ({
    visible: true,
    targetUserId: 'user-2',
    targetName: '민지',
    onClose: jest.fn(),
    onChanged: jest.fn(),
    onMessage: jest.fn(),
    ...over,
  }) as TestProps;

beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(mockAppLayout, {
    width: 402,
    height: 874,
    tablet: false,
    landscape: false,
    compact: false,
    modalWidth: 362,
  });
  replaceBlockedUsers([]);
  blockedUsersMock.mockResolvedValue([]);
  openUrlMock = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
});

test('태블릿에서는 사용자 메뉴를 제한된 너비로 가운데 정렬한다', async () => {
  Object.assign(mockAppLayout, { width: 1024, height: 1366, tablet: true, modalWidth: 560 });

  const screen = await render(<UserSafetySheet {...props()} />);

  assert.equal(
    StyleSheet.flatten(screen.getByTestId('user-safety-layout').props.style).justifyContent,
    'center',
  );
  assert.equal(StyleSheet.flatten(screen.getByTestId('user-safety-panel').props.style).width, 560);
  assert.equal(
    StyleSheet.flatten(screen.getByTestId('user-safety-panel').props.style).borderRadius,
    24,
  );
});

test('휴대폰 세로에서는 하단 모서리가 닫힌 bottom sheet로 배치한다', async () => {
  const screen = await render(<UserSafetySheet {...props()} />);
  const style = StyleSheet.flatten(screen.getByTestId('user-safety-panel').props.style);

  assert.equal(style.borderRadius, 26);
  assert.equal(style.borderBottomLeftRadius, 0);
  assert.equal(style.borderBottomRightRadius, 0);
  assert.equal(style.marginBottom, 44);
});

test('배경 오버레이는 공용 component token을 사용한다', async () => {
  const screen = await render(<UserSafetySheet {...props()} />);

  assert.equal(
    StyleSheet.flatten(screen.getByTestId('user-safety-overlay').props.style).backgroundColor,
    componentTokens.overlay.background,
  );
});

test('시트 뒤에 우체통 그림을 깔지 않고 딤 위에 시트 장식만 띄운다(GROMO-2467)', async () => {
  const screen = await render(<UserSafetySheet {...props()} />);
  const tree = JSON.stringify(screen.toJSON());

  assert.doesNotMatch(tree, /mail-cute-v1/);
  assert.match(tree, /cat-black-sitting/);
  assert.ok(screen.getByTestId('user-safety-overlay'));
});

afterEach(() => {
  jest.restoreAllMocks();
  applyLocalePref('system');
});

test('사용자 메뉴는 신고 없이 차단·추가 동작을 제공한다', async () => {
  const callbacks = props({ extraAction: { title: '친구 삭제', onPress: jest.fn() } });
  const ui = await render(<UserSafetySheet {...callbacks} />);
  assert.equal(ui.queryByText('신고하기'), null);
  assert.ok(ui.getByText('차단하기'));
  await fireEvent.press(ui.getByText('친구 삭제'));
  assert.equal(callbacks.onClose.mock.calls.length, 1);
  assert.equal(
    callbacks.extraAction?.onPress &&
      (callbacks.extraAction.onPress as jest.Mock).mock.calls.length,
    1,
  );
  assert.equal(openUrlMock.mock.calls.length, 0);
});

test('방명록의 차단 진입은 확인부터 열고 취소할 수 있다', async () => {
  const callbacks = props({ initialMode: 'block' });
  const ui = await render(<UserSafetySheet {...callbacks} />);
  assert.ok(ui.getByText('차단'));
  await fireEvent.press(ui.getByText('취소'));
  assert.equal(blockMock.mock.calls.length, 0);
  assert.equal(callbacks.onClose.mock.calls.length, 1);
});

test('차단 실패를 안내하고 재시도할 수 있다', async () => {
  blockMock.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined);
  const ui = await render(<UserSafetySheet {...props({ initialMode: 'block' })} />);
  await fireEvent.press(ui.getByText('차단'));
  await waitFor(() => assert.ok(ui.getByText(/처리하지 못했어요/)));
  await fireEvent.press(ui.getByText('차단'));
  assert.equal(blockMock.mock.calls.length, 2);
});

test('영어에서도 차단 메뉴와 확인을 번역한다', async () => {
  applyLocalePref('en');
  const ui = await render(<UserSafetySheet {...props({ targetName: 'Alex' })} />);
  assert.equal(ui.queryByText('Report'), null);
  await fireEvent.press(ui.getByText('Block user'));
  assert.ok(ui.getByText('Block'));
  assert.equal(ui.queryByText(/[가-힣]/), null);
});

test('영어 차단 API 오류는 서버 한국어 대신 공용 오류 번역을 표시한다', async () => {
  applyLocalePref('en');
  blockMock.mockRejectedValueOnce(new ApiError('NOT_FOUND', '사용자를 찾을 수 없어요.', 404));
  const ui = await render(
    <UserSafetySheet {...props({ initialMode: 'block', targetName: 'Alex' })} />,
  );
  await fireEvent.press(ui.getByText('Block'));
  await waitFor(() =>
    expect(ui.getByText("Couldn't find what you were looking for.")).toBeTruthy(),
  );
  expect(ui.queryByText('사용자를 찾을 수 없어요.')).toBeNull();
});

test('직접 차단 성공은 API 확인 뒤 로컬 필터와 완료 콜백을 갱신한다', async () => {
  blockMock.mockResolvedValue(undefined);
  const callbacks = props();
  const screen = await render(<UserSafetySheet {...callbacks} />);

  await fireEvent.press(screen.getByText('차단하기'));
  assert.ok(screen.getByText(/앱 목록에서 숨겨져요/));
  assert.ok(screen.getByText(/알림은 기기에 표시될 수 있어요/));
  assert.ok(screen.getByText(/해제하면 다시 보일 수 있어요/));
  await fireEvent.press(screen.getByText('차단'));

  assert.equal(blockMock.mock.calls[0][0], 'user-2');
  assert.equal(isUserBlocked('user-2'), true);
  assert.equal(callbacks.onChanged.mock.calls.length, 1);
  assert.equal(callbacks.onClose.mock.calls.length, 1);
  assert.equal(callbacks.onMessage.mock.calls[0][0], '민지님을 차단했어요.');
});

test('직접 차단 응답이 유실돼도 서버 목록에서 확인되면 성공으로 안내한다', async () => {
  blockMock.mockRejectedValue(new Error('response lost'));
  blockedUsersMock.mockResolvedValue([{ id: 'user-2', name: '민지' }]);
  const callbacks = props();
  const screen = await render(<UserSafetySheet {...callbacks} />);

  await fireEvent.press(screen.getByText('차단하기'));
  await fireEvent.press(screen.getByText('차단'));

  await waitFor(() => assert.equal(isUserBlocked('user-2'), true));
  assert.equal(callbacks.onChanged.mock.calls.length, 1);
  assert.equal(callbacks.onClose.mock.calls.length, 1);
  assert.equal(callbacks.onMessage.mock.calls[0][0], '민지님을 차단했어요.');
  assert.equal(screen.queryByText(/처리하지 못했어요/), null);
});
