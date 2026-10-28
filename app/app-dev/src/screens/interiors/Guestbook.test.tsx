// 섬 방명록: 목록·쓰기·섬장의 지우기·게시판 없는 섬 숨김·쓰기 거절 안내. 차단 진입은 없다.
import React from 'react';
import { AccessibilityInfo, Platform } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Guestbook } from '@/screens/interiors/Guestbook';
import { ApiError } from '@/services/api/client';
import { applyLocalePref } from '@/i18n';
import { deleteGuestbookEntry, getGuestbook, writeGuestbook } from '@/services/api/islands';

jest.mock('@/services/api/islands', () => ({
  ...jest.requireActual('@/services/api/islands'),
  getGuestbook: jest.fn(),
  writeGuestbook: jest.fn(),
  deleteGuestbookEntry: jest.fn(),
}));

const getMock = getGuestbook as jest.Mock;
const writeMock = writeGuestbook as jest.Mock;
const deleteMock = deleteGuestbookEntry as jest.Mock;

const entry = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  authorId: `u-${id}`,
  authorName: '수아',
  content: `${id} 놀러 왔어요`,
  createdAt: '2026-10-12T01:00:00Z',
  mine: false,
  ...over,
});
const page = (items: unknown[], boardBuilt = true) => ({ boardBuilt, items });
const env = () => ({
  notify: jest.fn(),
  confirm: jest.fn(),
  conversion: { offer: jest.fn((_error: unknown) => false) },
});
const INPUT = 'field-한마디 남기기';

const mount = async (host: boolean, e = env(), items: unknown[] = [entry('g1'), entry('g2')]) => {
  getMock.mockResolvedValue(page(items));
  const screen = await render(<Guestbook islandId="i1" host={host} e={e} />);
  await screen.findByTestId('guestbook-submit'); // 쓰기 칸은 목록을 받은 뒤에 나타난다
  return { screen, e };
};

// accessibilityLiveRegion 은 안드로이드 전용이다 — iOS 에서 직접 읽어 주는지 보려고 플랫폼과 읽어 주기를 가짜로 둔다
const originalOS = Platform.OS;
const setOS = (os: string) =>
  Object.defineProperty(Platform, 'OS', { configurable: true, value: os });
let announce: jest.SpyInstance;

beforeEach(() => {
  jest.resetAllMocks();
  announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
});
afterEach(() => {
  applyLocalePref('system');
  setOS(originalOS);
  announce.mockRestore();
});

test('목록(최신순)을 그리고 쓰기 칸에 쓴 글을 {content} 로 보낸 뒤 맨 위에 올린다', async () => {
  const { screen } = await mount(false);
  expect(getMock).toHaveBeenCalledWith('i1');
  expect(screen.getByText('방명록')).toBeTruthy();
  expect(screen.getByText('g1 놀러 왔어요')).toBeTruthy();
  expect(screen.getByText('g2 놀러 왔어요')).toBeTruthy();

  writeMock.mockResolvedValue(entry('g3', { content: '오늘도 파이팅', mine: true }));
  await fireEvent.changeText(screen.getByTestId(INPUT), '  오늘도 파이팅  ');
  await fireEvent.press(screen.getByTestId('guestbook-submit'));
  await waitFor(() => expect(writeMock).toHaveBeenCalledTimes(1));
  expect(writeMock).toHaveBeenCalledWith('i1', '오늘도 파이팅'); // 앞뒤 공백은 뗀다
  await screen.findByText('오늘도 파이팅');
  expect(screen.getByTestId(INPUT).props.value).toBe('');
});

test('쓰기 칸은 20 코드포인트까지만 받고(🐟 = 1) 글자 수도 코드포인트로 센다', async () => {
  const { screen } = await mount(false);
  await fireEvent.changeText(screen.getByTestId(INPUT), '🐟'.repeat(21));
  expect(screen.getByTestId(INPUT).props.value).toBe('🐟'.repeat(20));
  expect(screen.getByText('20자까지 쓸 수 있어요 · 20/20')).toBeTruthy();
  await fireEvent.changeText(screen.getByTestId(INPUT), '🐟'.repeat(3));
  expect(screen.getByText('3/20')).toBeTruthy();
});

test('빈 글·공백만이면 남기기 버튼이 막혀 있다', async () => {
  const { screen } = await mount(false);
  expect(screen.getByTestId('guestbook-submit').props.accessibilityState.disabled).toBe(true);
  await fireEvent.changeText(screen.getByTestId(INPUT), '   ');
  expect(screen.getByTestId('guestbook-submit').props.accessibilityState.disabled).toBe(true);
  await fireEvent.changeText(screen.getByTestId(INPUT), '안녕');
  expect(screen.getByTestId('guestbook-submit').props.accessibilityState.disabled).toBe(false);
});

test('섬장에게는 항목마다 [지우기]만 보이고 방명록에는 [차단]이 없다', async () => {
  const hostScreen = (await mount(true)).screen;
  for (const id of ['g1', 'g2']) {
    expect(hostScreen.getByTestId(`guestbook-delete-${id}`)).toBeTruthy();
    expect(hostScreen.queryByTestId(`guestbook-block-${id}`)).toBeNull();
  }
  expect(hostScreen.getAllByText('지우기')).toHaveLength(2);
  expect(hostScreen.queryByText('차단')).toBeNull();
  await hostScreen.unmount();

  const resident = (await mount(false)).screen;
  expect(resident.getByText('g1 놀러 왔어요')).toBeTruthy();
  expect(resident.queryByTestId('guestbook-delete-g1')).toBeNull();
  expect(resident.queryByTestId('guestbook-block-g1')).toBeNull();
  expect(resident.queryByText('지우기')).toBeNull();
  expect(resident.queryByText('차단')).toBeNull();
});

test('항목마다 [지우기]는 어느 글인지 읽는 이름에 담고 차단 접근성 동작은 없다', async () => {
  const { screen } = await mount(true, env(), [entry('g1'), entry('g2', { authorName: null })]);
  expect(screen.getByTestId('guestbook-delete-g1').props.accessibilityLabel).toBe(
    '지우기: g1 놀러 왔어요',
  );
  expect(screen.getByTestId('guestbook-delete-g2').props.accessibilityLabel).toBe(
    '지우기: g2 놀러 왔어요',
  );
  expect(screen.queryByLabelText(/차단:/)).toBeNull();
  expect(screen.getByLabelText('지우기: g1 놀러 왔어요')).toBeTruthy();
  expect(screen.getAllByText('지우기')).toHaveLength(2);
  expect(screen.queryByText('차단')).toBeNull();
});

test('게시판이 없는 섬(boardBuilt=false)이면 방명록을 통째로 숨긴다', async () => {
  getMock.mockResolvedValue(page([], false));
  const screen = await render(<Guestbook islandId="i1" host={false} e={env()} />);
  await waitFor(() => expect(screen.queryByText('불러오고 있어요.')).toBeNull());
  expect(screen.queryByText('방명록')).toBeNull();
  expect(screen.queryByTestId(INPUT)).toBeNull();
  expect(screen.queryByTestId('guestbook-submit')).toBeNull();
});

test('오늘 이미 남겼으면(409) 토스트 없이 칸 아래 안내만 남기고 칸과 버튼을 끈다(쓰던 글은 그대로)', async () => {
  const { screen, e } = await mount(false);
  expect(screen.queryByText('오늘은 이미 남겼어요')).toBeNull(); // 처음엔 안내가 없다
  writeMock.mockRejectedValue(
    new ApiError('GUESTBOOK_ALREADY_WRITTEN_TODAY', '오늘은 이미 방명록을 남겼어요', 409),
  );
  await fireEvent.changeText(screen.getByTestId(INPUT), '또 쓸래요');
  await fireEvent.press(screen.getByTestId('guestbook-submit'));

  // 남는 안내가 live region 으로 읽힌다. 전역 토스트도 live region 이라 같이 띄우면 안드로이드가 같은 문장을 두 번 읽는다
  const notice = await screen.findByText('오늘은 이미 남겼어요');
  expect(notice.props.accessibilityLiveRegion).toBe('polite');
  expect(e.notify).not.toHaveBeenCalled();
  expect(screen.getByTestId(INPUT).props.editable).toBe(false);
  expect(screen.getByTestId(INPUT).props.value).toBe('또 쓸래요');
  expect(screen.getByTestId('guestbook-submit').props.accessibilityState.disabled).toBe(true);
  await fireEvent.press(screen.getByTestId('guestbook-submit'));
  expect(writeMock).toHaveBeenCalledTimes(1); // 눌러도 더 보내지 않는다
});

test('네트워크 오류 같은 일시 실패는 토스트로만 알리고 칸을 막지 않아 같은 글을 다시 보낼 수 있다', async () => {
  setOS('ios');
  const { screen, e } = await mount(false);
  writeMock.mockRejectedValueOnce(new ApiError('CLIENT_NETWORK_ERROR', 'lost', 0));
  await fireEvent.changeText(screen.getByTestId(INPUT), '안녕');
  await fireEvent.press(screen.getByTestId('guestbook-submit'));
  await waitFor(() => expect(e.notify).toHaveBeenCalledTimes(1));
  expect(announce).not.toHaveBeenCalled(); // 토스트로 알린 오류는 따로 읽어 주지 않는다
  expect(screen.getByTestId(INPUT).props.editable).toBe(true);
  expect(screen.getByTestId('guestbook-submit').props.accessibilityState.disabled).toBe(false);
  expect(screen.queryByText('오늘은 이미 남겼어요')).toBeNull();

  writeMock.mockResolvedValue(entry('g9', { content: '안녕', mine: true }));
  await fireEvent.press(screen.getByTestId('guestbook-submit'));
  await screen.findByText('안녕');
  expect(writeMock).toHaveBeenCalledTimes(2);
});

test('응답을 잃은 쓰기를 다시 보내 409 가 나면 목록을 다시 받아 내 글이 보이게 하고 칸은 막은 채 둔다', async () => {
  const { screen, e } = await mount(false);
  expect(getMock).toHaveBeenCalledTimes(1);
  // ① 서버엔 저장됐지만 응답이 끊겼다 — 목록엔 내 글이 아직 없다
  writeMock.mockRejectedValueOnce(new ApiError('CLIENT_TIMEOUT', 'timeout', 0));
  await fireEvent.changeText(screen.getByTestId(INPUT), '안녕');
  await fireEvent.press(screen.getByTestId('guestbook-submit'));
  await waitFor(() => expect(e.notify).toHaveBeenCalledTimes(1));
  expect(screen.queryByText('안녕')).toBeNull();
  expect(getMock).toHaveBeenCalledTimes(1); // 일시 실패는 목록을 다시 받지 않는다

  // ② 다시 보내면 오늘 이미 남겼다(409) — 서버 목록으로 맞추면 내 글이 보인다
  writeMock.mockRejectedValueOnce(new ApiError('GUESTBOOK_ALREADY_WRITTEN_TODAY', 'x', 409));
  getMock.mockResolvedValue(
    page([entry('g9', { content: '안녕', mine: true }), entry('g1'), entry('g2')]),
  );
  await fireEvent.press(screen.getByTestId('guestbook-submit'));
  await screen.findByText('오늘은 이미 남겼어요');
  await screen.findByText('안녕'); // 내 글이 목록에 나타난다
  expect(getMock).toHaveBeenCalledTimes(2);
  expect(screen.getByTestId(INPUT).props.editable).toBe(false); // 막힌 채다
  expect(screen.getByTestId('guestbook-submit').props.accessibilityState.disabled).toBe(true);
  expect(e.notify).toHaveBeenCalledTimes(1); // 409 는 토스트가 없다(첫 실패의 토스트뿐)
});

test('목록을 다시 받다 실패해도 지금 화면과 막은 칸은 그대로다', async () => {
  const { screen } = await mount(false);
  writeMock.mockRejectedValue(new ApiError('GUESTBOOK_ALREADY_WRITTEN_TODAY', 'x', 409));
  getMock.mockRejectedValue(new ApiError('CLIENT_NETWORK_ERROR', 'lost', 0));
  await fireEvent.changeText(screen.getByTestId(INPUT), '안녕');
  await fireEvent.press(screen.getByTestId('guestbook-submit'));
  await screen.findByText('오늘은 이미 남겼어요');
  await waitFor(() => expect(getMock).toHaveBeenCalledTimes(2));
  expect(screen.getByText('g1 놀러 왔어요')).toBeTruthy(); // 목록은 그대로
  expect(screen.queryByText('방명록을 불러오지 못했어요.')).toBeNull(); // 불러오기 실패 화면으로 바뀌지 않는다
  expect(screen.getByTestId(INPUT).props.editable).toBe(false);
});

test('막았던 칸은 섬이 바뀌어 다시 불러오면 다시 열린다', async () => {
  const { screen } = await mount(false);
  writeMock.mockRejectedValue(new ApiError('GUESTBOOK_ALREADY_WRITTEN_TODAY', 'x', 409));
  await fireEvent.changeText(screen.getByTestId(INPUT), '안녕');
  await fireEvent.press(screen.getByTestId('guestbook-submit'));
  await screen.findByText('오늘은 이미 남겼어요');

  getMock.mockResolvedValue(page([entry('b1')]));
  await screen.rerender(<Guestbook islandId="i2" host={false} e={env()} />);
  await screen.findByText('b1 놀러 왔어요');
  expect(screen.queryByText('오늘은 이미 남겼어요')).toBeNull();
  expect(screen.getByTestId(INPUT).props.editable).toBe(true);
});

test('막힌 뒤 [다시 불러오기]로 잠금이 풀려도 쓰던 글은 지우지 않고 그대로 보낼 수 있다', async () => {
  const { screen } = await mount(false);
  writeMock.mockRejectedValueOnce(new ApiError('GUESTBOOK_ALREADY_WRITTEN_TODAY', 'x', 409));
  await fireEvent.changeText(screen.getByTestId(INPUT), '안녕');
  await fireEvent.press(screen.getByTestId('guestbook-submit'));
  await screen.findByText('오늘은 이미 남겼어요');
  expect(screen.getByTestId(INPUT).props.value).toBe('안녕'); // 막힌 칸에도 쓰던 글이 남아 있다

  // 자정(KST)이 지나 서버가 다시 허용한다 — 같은 섬의 수동 다시 불러오기는 잠금·목록만 새로 받는다
  getMock.mockResolvedValue(page([entry('g1')]));
  await fireEvent.press(screen.getByTestId('guestbook-reload'));
  await waitFor(() => expect(screen.queryByText('오늘은 이미 남겼어요')).toBeNull());
  await screen.findByTestId(INPUT);
  expect(screen.getByTestId(INPUT).props.editable).toBe(true);
  expect(screen.getByTestId(INPUT).props.value).toBe('안녕'); // 쓰던 글은 그대로
  expect(screen.getByTestId('guestbook-submit').props.accessibilityState.disabled).toBe(false);

  writeMock.mockResolvedValue(entry('g9', { content: '안녕', mine: true }));
  await fireEvent.press(screen.getByTestId('guestbook-submit'));
  await screen.findByText('안녕');
  expect(writeMock).toHaveBeenLastCalledWith('i1', '안녕');
});

test('섬이 바뀌면 쓰던 글을 비운다(다른 섬에 옛 초안이 남지 않는다)', async () => {
  const { screen } = await mount(false);
  await fireEvent.changeText(screen.getByTestId(INPUT), '안녕');
  expect(screen.getByTestId(INPUT).props.value).toBe('안녕');

  getMock.mockResolvedValue(page([entry('b1')]));
  await screen.rerender(<Guestbook islandId="i2" host={false} e={env()} />);
  await screen.findByText('b1 놀러 왔어요');
  expect(screen.getByTestId(INPUT).props.value).toBe('');
  expect(screen.getByTestId('guestbook-submit').props.accessibilityState.disabled).toBe(true);
});

test('게시판이 사라진 섬(403 FACILITY_LOCKED)은 토스트 없이 칸 아래 안내로 짓고 나서 쓰라고 알린다', async () => {
  const { screen, e } = await mount(false);
  writeMock.mockRejectedValue(
    new ApiError('FACILITY_LOCKED', '필요한 시설을 먼저 열어 주세요.', 403),
  );
  await fireEvent.changeText(screen.getByTestId(INPUT), '안녕');
  await fireEvent.press(screen.getByTestId('guestbook-submit'));
  // 다시 눌러도 같은 거절이다 — 토스트 대신 칸 아래 안내를 남기고 칸과 버튼을 끈다
  const notice = await screen.findByText('게시판을 지으면 방명록을 쓸 수 있어요');
  expect(notice.props.accessibilityLiveRegion).toBe('polite');
  expect(e.notify).not.toHaveBeenCalled();
  expect(screen.getByTestId(INPUT).props.editable).toBe(false);
  expect(screen.getByTestId('guestbook-submit').props.accessibilityState.disabled).toBe(true);
  expect(getMock).toHaveBeenCalledTimes(1); // 403 은 목록을 다시 받지 않는다(409 만)
});

const BLOCKING: [string, number, string][] = [
  ['GUESTBOOK_ALREADY_WRITTEN_TODAY', 409, '오늘은 이미 남겼어요'],
  ['FACILITY_LOCKED', 403, '게시판을 지으면 방명록을 쓸 수 있어요'],
];

test.each(BLOCKING)(
  'iOS 는 live region 이 없어 막는 거절(%s)의 안내를 한 번 직접 읽어 준다',
  async (code, status, text) => {
    setOS('ios');
    const { screen } = await mount(false);
    writeMock.mockRejectedValue(new ApiError(code, 'x', status));
    await fireEvent.changeText(screen.getByTestId(INPUT), '안녕');
    await fireEvent.press(screen.getByTestId('guestbook-submit'));
    await screen.findByText(text);
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith(text);
  },
);

test.each(BLOCKING)(
  '안드로이드는 안내의 live region 에 맡기고 따로 읽어 주지 않는다(%s)',
  async (code, status, text) => {
    setOS('android');
    const { screen } = await mount(false);
    writeMock.mockRejectedValue(new ApiError(code, 'x', status));
    await fireEvent.changeText(screen.getByTestId(INPUT), '안녕');
    await fireEvent.press(screen.getByTestId('guestbook-submit'));
    const notice = await screen.findByText(text);
    expect(notice.props.accessibilityLiveRegion).toBe('polite');
    expect(announce).not.toHaveBeenCalled();
  },
);

test.each(BLOCKING)(
  '막힌 칸(%s)은 [다시 불러오기]로 풀리고, 서버가 아직 막고 있으면 다음 쓰기에서 다시 막힌다',
  async (code, status, text) => {
    const { screen } = await mount(false);
    writeMock.mockRejectedValue(new ApiError(code, 'x', status));
    await fireEvent.changeText(screen.getByTestId(INPUT), '안녕');
    await fireEvent.press(screen.getByTestId('guestbook-submit'));
    await screen.findByText(text);
    expect(screen.getByTestId(INPUT).props.editable).toBe(false);

    // 자정(KST)이 지나 서버가 다시 허용한다 — 막힌 채여도 [다시 불러오기]가 보이고, 목록을 받으면 칸이 열린다(화면을 나가지 않고)
    getMock.mockResolvedValue(page([entry('g1')]));
    await fireEvent.press(screen.getByTestId('guestbook-reload'));
    await waitFor(() => expect(screen.queryByText(text)).toBeNull());
    await screen.findByTestId(INPUT);
    expect(screen.getByTestId(INPUT).props.editable).toBe(true);
    await fireEvent.changeText(screen.getByTestId(INPUT), '새 날 한마디');
    expect(screen.getByTestId('guestbook-submit').props.accessibilityState.disabled).toBe(false);

    // 같은 날이라 서버가 아직 막고 있으면 다시 보낼 때 같은 거절을 받아 다시 막힌다
    await fireEvent.press(screen.getByTestId('guestbook-submit'));
    await screen.findByText(text);
    expect(writeMock).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId(INPUT).props.editable).toBe(false);
    expect(screen.getByTestId('guestbook-reload')).toBeTruthy();
  },
);

test('게스트(403 SOCIAL_LOGIN_REQUIRED)는 토스트 대신 회원 전환 시트로 보낸다', async () => {
  const e = env();
  e.conversion.offer.mockReturnValue(true);
  const { screen } = await mount(false, e);
  const gate = new ApiError('SOCIAL_LOGIN_REQUIRED', '소셜 로그인하면 이용할 수 있어요.', 403);
  writeMock.mockRejectedValue(gate);
  await fireEvent.changeText(screen.getByTestId(INPUT), '안녕');
  await fireEvent.press(screen.getByTestId('guestbook-submit'));
  await waitFor(() => expect(e.conversion.offer).toHaveBeenCalledWith(gate));
  expect(e.notify).not.toHaveBeenCalled();
});

test('전환 시트가 없으면 게스트 거절도 안내 문구로 알린다', async () => {
  const e = { notify: jest.fn() };
  getMock.mockResolvedValue(page([]));
  const screen = await render(<Guestbook islandId="i1" host={false} e={e} />);
  await screen.findByTestId(INPUT);
  writeMock.mockRejectedValue(new ApiError('SOCIAL_LOGIN_REQUIRED', 'x', 403));
  await fireEvent.changeText(screen.getByTestId(INPUT), '안녕');
  await fireEvent.press(screen.getByTestId('guestbook-submit'));
  await waitFor(() => expect(e.notify).toHaveBeenCalledWith('소셜 로그인하면 이용할 수 있어요.'));
});

test('남기기를 연타해도 요청은 한 번만 나간다', async () => {
  const { screen } = await mount(false);
  let release!: (value: unknown) => void;
  writeMock.mockReturnValue(new Promise((resolve) => (release = resolve)));
  await fireEvent.changeText(screen.getByTestId(INPUT), '안녕');
  await fireEvent.press(screen.getByTestId('guestbook-submit'));
  await fireEvent.press(screen.getByTestId('guestbook-submit'));
  expect(writeMock).toHaveBeenCalledTimes(1);
  await act(async () => release(entry('g9', { content: '안녕', mine: true })));
  await screen.findByText('안녕');
});

test('보내는 동안에도 칸은 고칠 수 있고, 응답이 와도 그새 더 쓴 글은 지우지 않는다', async () => {
  const { screen } = await mount(false);
  let release!: (value: unknown) => void;
  writeMock.mockReturnValue(new Promise((resolve) => (release = resolve)));
  await fireEvent.changeText(screen.getByTestId(INPUT), '첫 글');
  await fireEvent.press(screen.getByTestId('guestbook-submit'));
  expect(writeMock).toHaveBeenCalledWith('i1', '첫 글');
  expect(screen.getByTestId(INPUT).props.editable).toBe(true); // 보내는 중에도 막지 않는다

  await fireEvent.changeText(screen.getByTestId(INPUT), '첫 글 그리고 더');
  await act(async () => release(entry('g9', { content: '첫 글', mine: true })));
  await screen.findByText('첫 글'); // 보낸 글은 목록에 올라가고
  expect(screen.getByTestId(INPUT).props.value).toBe('첫 글 그리고 더'); // 새로 쓰던 글은 그대로다
  expect(screen.getByTestId('guestbook-submit').props.accessibilityState.disabled).toBe(false);
});

test('보내는 동안 칸을 안 고쳤으면 응답이 오자 비운다', async () => {
  const { screen } = await mount(false);
  let release!: (value: unknown) => void;
  writeMock.mockReturnValue(new Promise((resolve) => (release = resolve)));
  await fireEvent.changeText(screen.getByTestId(INPUT), '안녕');
  await fireEvent.press(screen.getByTestId('guestbook-submit'));
  expect(screen.getByTestId(INPUT).props.value).toBe('안녕'); // 응답 전에는 그대로
  await act(async () => release(entry('g9', { content: '안녕', mine: true })));
  await screen.findByText('안녕');
  expect(screen.getByTestId(INPUT).props.value).toBe('');
});

test('섬장이 지우기를 누르면 확인창을 거쳐 지우고 목록에서 뺀다', async () => {
  const { screen, e } = await mount(true);
  deleteMock.mockResolvedValue({ deleted: true });
  await fireEvent.press(screen.getByTestId('guestbook-delete-g1'));
  expect(e.confirm).toHaveBeenCalledTimes(1);
  const [title, , action, opts] = e.confirm.mock.calls[0];
  expect(title).toBe('이 글을 지울까요?');
  expect(opts).toEqual({ ok: '지우기', destructive: true });
  expect(deleteMock).not.toHaveBeenCalled(); // 확인 전에는 안 지운다

  await act(async () => action());
  expect(deleteMock).toHaveBeenCalledWith('i1', 'g1');
  await waitFor(() => expect(screen.queryByText('g1 놀러 왔어요')).toBeNull());
  expect(screen.getByText('g2 놀러 왔어요')).toBeTruthy();
  expect(e.notify).toHaveBeenCalledWith('방명록 글을 지웠어요');
});

test('지우는 중에는 같은 확인을 또 눌러도 요청은 한 번만 나가고 오류 토스트도 없다', async () => {
  const { screen, e } = await mount(true);
  let release!: (value: unknown) => void;
  deleteMock.mockReturnValue(new Promise((resolve) => (release = resolve)));
  await fireEvent.press(screen.getByTestId('guestbook-delete-g1'));
  const confirmDelete = e.confirm.mock.calls[0][2];
  await act(async () => confirmDelete());
  await act(async () => confirmDelete()); // 느린 망에서 확인을 또 눌렀다
  expect(deleteMock).toHaveBeenCalledTimes(1);

  await act(async () => release({ deleted: true }));
  await waitFor(() => expect(screen.queryByText('g1 놀러 왔어요')).toBeNull());
  expect(screen.getByText('g2 놀러 왔어요')).toBeTruthy();
  expect(e.notify).toHaveBeenCalledTimes(1);
  expect(e.notify).toHaveBeenCalledWith('방명록 글을 지웠어요');
});

test('지우는 중에는 그 글의 [지우기]만 꺼지고 다시 눌러도 확인창이 뜨지 않으며, 실패하면 다시 켜진다', async () => {
  const { screen, e } = await mount(true);
  let fail!: (error: unknown) => void;
  deleteMock.mockReturnValueOnce(new Promise((_resolve, reject) => (fail = reject)));
  await fireEvent.press(screen.getByTestId('guestbook-delete-g1'));
  await act(async () => e.confirm.mock.calls[0][2]());
  expect(screen.getByTestId('guestbook-delete-g1').props.accessibilityState.disabled).toBe(true);
  expect(screen.getByTestId('guestbook-delete-g2').props.accessibilityState.disabled).toBe(false);
  await fireEvent.press(screen.getByTestId('guestbook-delete-g1'));
  expect(e.confirm).toHaveBeenCalledTimes(1); // 꺼진 버튼은 확인창을 다시 열지 않는다

  await act(async () => fail(new ApiError('CLIENT_NETWORK_ERROR', 'lost', 0)));
  expect(screen.getByTestId('guestbook-delete-g1').props.accessibilityState.disabled).toBe(false);
  expect(screen.getByText('g1 놀러 왔어요')).toBeTruthy(); // 실패하면 글은 남는다
  expect(e.notify).toHaveBeenCalledTimes(1); // 오류 토스트

  deleteMock.mockResolvedValue({ deleted: true });
  await fireEvent.press(screen.getByTestId('guestbook-delete-g1'));
  await act(async () => e.confirm.mock.calls[1][2]());
  expect(deleteMock).toHaveBeenCalledTimes(2); // 다시 지울 수 있다
  await waitFor(() => expect(screen.queryByText('g1 놀러 왔어요')).toBeNull());
});

test('지우는 중에 섬이 바뀌면 지우는 중 표시도 풀린다', async () => {
  const { screen, e } = await mount(true);
  deleteMock.mockReturnValue(new Promise(() => {})); // 끝나지 않는 요청
  await fireEvent.press(screen.getByTestId('guestbook-delete-g1'));
  await act(async () => e.confirm.mock.calls[0][2]());
  expect(screen.getByTestId('guestbook-delete-g1').props.accessibilityState.disabled).toBe(true);

  getMock.mockResolvedValue(page([entry('g1', { content: '다른 섬 글' })]));
  await screen.rerender(<Guestbook islandId="i2" host={true} e={env()} />);
  await screen.findByText('다른 섬 글');
  expect(screen.getByTestId('guestbook-delete-g1').props.accessibilityState.disabled).toBe(false);
});

test('이미 지워진 글(404)을 지우면 목록에서도 빼고 안내한다', async () => {
  const { screen, e } = await mount(true);
  deleteMock.mockRejectedValue(new ApiError('NOT_FOUND', '없어요', 404));
  await fireEvent.press(screen.getByTestId('guestbook-delete-g2'));
  await act(async () => e.confirm.mock.calls[0][2]());
  await waitFor(() => expect(screen.queryByText('g2 놀러 왔어요')).toBeNull());
  expect(e.notify).toHaveBeenCalledWith('더 이상 볼 수 없는 내용이에요. 다시 불러와 주세요.');
});

test('본인 글·다른 작성자의 글 모두 섬장에게는 [지우기]만 제공한다', async () => {
  const { screen } = await mount(true, env(), [entry('g1', { mine: true }), entry('g2')]);
  expect(screen.getByTestId('guestbook-delete-g1')).toBeTruthy();
  expect(screen.queryByTestId('guestbook-block-g1')).toBeNull();
  expect(screen.getByTestId('guestbook-delete-g2')).toBeTruthy();
  expect(screen.queryByTestId('guestbook-block-g2')).toBeNull();
});

test('닉네임이 없는 작성자는 「떠난 주민」으로 보인다', async () => {
  const { screen } = await mount(true, env(), [entry('g1', { authorName: null })]);
  expect(screen.getByText('떠난 주민')).toBeTruthy();
});

test('목록이 비면 첫 한마디를 권한다', async () => {
  const { screen } = await mount(false, env(), []);
  expect(screen.getByText('아직 방명록이 없어요. 첫 한마디를 남겨 보세요.')).toBeTruthy();
});

test('불러오는 중과 빈 목록 안내는 live region 으로 읽힌다', async () => {
  let release!: (value: unknown) => void;
  getMock.mockReturnValue(new Promise((resolve) => (release = resolve)));
  const screen = await render(<Guestbook islandId="i1" host={false} e={env()} />);
  expect(screen.getByText('불러오고 있어요.').props.accessibilityLiveRegion).toBe('polite');
  await act(async () => release(page([])));
  const empty = await screen.findByText('아직 방명록이 없어요. 첫 한마디를 남겨 보세요.');
  expect(empty.props.accessibilityLiveRegion).toBe('polite');
});

test('불러오기에 실패하면 안내와 다시 불러오기를 보이고 눌러서 복구한다', async () => {
  getMock.mockRejectedValueOnce(new ApiError('CLIENT_NETWORK_ERROR', 'lost', 0));
  const screen = await render(<Guestbook islandId="i1" host={false} e={env()} />);
  await screen.findByText('방명록을 불러오지 못했어요.');
  getMock.mockResolvedValue(page([entry('g1')]));
  await fireEvent.press(screen.getByTestId('guestbook-reload'));
  await screen.findByText('g1 놀러 왔어요');
  expect(getMock).toHaveBeenCalledTimes(2);
});

test('다른 섬으로 바뀌면 이전 섬의 늦은 응답을 버린다', async () => {
  let finishA!: (value: unknown) => void;
  getMock
    .mockImplementationOnce(() => new Promise((resolve) => (finishA = resolve)))
    .mockResolvedValue(page([entry('b1')]));
  const screen = await render(<Guestbook islandId="a" host={false} e={env()} />);
  await screen.rerender(<Guestbook islandId="b" host={false} e={env()} />);
  await screen.findByText('b1 놀러 왔어요');
  await act(async () => finishA(page([entry('a1')])));
  expect(screen.queryByText('a1 놀러 왔어요')).toBeNull();
});

test('영어 로케일에서 제목·입력·버튼·안내를 번역한다', async () => {
  applyLocalePref('en');
  const { screen, e } = await mount(true);
  expect(screen.getByText('Guestbook')).toBeTruthy();
  expect(screen.getByTestId('field-Leave a note').props.placeholder).toBe(
    'A note for today (up to 20 characters)',
  );
  expect(screen.getByText('Post')).toBeTruthy();
  expect(screen.getAllByText('Delete')).toHaveLength(2);
  expect(screen.queryByText('Block')).toBeNull();
  expect(screen.getByTestId('guestbook-delete-g1').props.accessibilityLabel).toBe(
    'Delete: g1 놀러 왔어요',
  );
  expect(screen.queryByLabelText(/Block:/)).toBeNull();
  writeMock.mockRejectedValue(new ApiError('GUESTBOOK_ALREADY_WRITTEN_TODAY', '오늘은', 409));
  await fireEvent.changeText(screen.getByTestId('field-Leave a note'), 'hi');
  await fireEvent.press(screen.getByTestId('guestbook-submit'));
  await screen.findByText("You've already left a note today"); // 칸 아래 안내(토스트는 없다)
  expect(e.notify).not.toHaveBeenCalled();
});

test.each([30, 31, 60, 61])(
  '방명록 %i개를 커서로 끝까지 읽고 마지막 페이지 뒤에는 요청하지 않는다',
  async (total) => {
    const entries = Array.from({ length: total }, (_, index) => entry(`p${index}`));
    getMock.mockImplementation((_island: string, cursor?: string) => {
      const start = cursor ? Number(cursor) : 0;
      return Promise.resolve({
        ...page(entries.slice(start, start + 30)),
        nextCursor: start + 30 < total ? String(start + 30) : null,
      });
    });
    let more: (() => void) | null = null;
    const screen = await render(
      <Guestbook
        islandId="i1"
        host={false}
        onLoadMoreReady={(load) => {
          more = load;
        }}
      />,
    );
    await screen.findByTestId('guestbook-submit');
    for (let start = 30; start < total; start += 30) {
      await act(async () => more?.());
      await screen.findByText(`p${Math.min(start + 29, total - 1)} 놀러 왔어요`);
    }
    expect(screen.getByText('p0 놀러 왔어요')).toBeTruthy();
    expect(getMock).toHaveBeenCalledTimes(Math.ceil(total / 30));
    await act(async () => more?.());
    expect(getMock).toHaveBeenCalledTimes(Math.ceil(total / 30));
  },
);

test('페이지를 읽은 뒤 글을 남겨도 이전 글을 30개로 자르지 않는다', async () => {
  const items = Array.from({ length: 30 }, (_, index) => entry(`g${index}`));
  const { screen } = await mount(false, env(), items);
  writeMock.mockResolvedValue(entry('new', { content: '새 한마디' }));
  await fireEvent.changeText(screen.getByTestId(INPUT), '새 한마디');
  await fireEvent.press(screen.getByTestId('guestbook-submit'));
  await screen.findByText('새 한마디');
  expect(screen.getByText('g29 놀러 왔어요')).toBeTruthy();
});

test('하단 이벤트가 반복돼도 한 번만 조회하고, 추가 조회 실패는 글과 초안을 유지한 채 재시도한다', async () => {
  getMock.mockResolvedValueOnce({ ...page([entry('first')]), nextCursor: 'next' });
  let fail!: (error: unknown) => void;
  getMock.mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
  );
  let more: (() => void) | null = null;
  const screen = await render(
    <Guestbook
      islandId="i1"
      host={false}
      onLoadMoreReady={(load) => {
        more = load;
      }}
    />,
  );
  await screen.findByTestId('guestbook-submit');
  await fireEvent.changeText(screen.getByTestId(INPUT), '쓰던 글');
  await act(async () => {
    more?.();
    more?.();
  });
  expect(getMock).toHaveBeenCalledTimes(2);
  await act(async () => fail(new Error('offline')));
  await screen.findByTestId('guestbook-more-retry');
  expect(screen.getByText('first 놀러 왔어요')).toBeTruthy();
  expect(screen.getByTestId(INPUT).props.value).toBe('쓰던 글');
  await act(async () => more?.());
  expect(getMock).toHaveBeenCalledTimes(2);
  getMock.mockResolvedValueOnce({ ...page([entry('last')]), nextCursor: null });
  await fireEvent.press(screen.getByTestId('guestbook-more-retry'));
  await screen.findByText('last 놀러 왔어요');
  expect(getMock).toHaveBeenLastCalledWith('i1', 'next');
  expect(screen.getByText('first 놀러 왔어요')).toBeTruthy();
});

test('추가 페이지의 중복 글과 조회 중 지운 글을 다시 넣지 않는다', async () => {
  getMock.mockResolvedValueOnce({
    ...page([entry('first'), entry('deleted')]),
    nextCursor: 'next',
  });
  let finish!: (value: unknown) => void;
  getMock.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  let more: (() => void) | null = null;
  const e = env();
  const screen = await render(
    <Guestbook
      islandId="i1"
      host
      e={e}
      onLoadMoreReady={(load) => {
        more = load;
      }}
    />,
  );
  await screen.findByTestId('guestbook-submit');
  await act(async () => more?.());
  deleteMock.mockResolvedValue({ deleted: true });
  await fireEvent.press(screen.getByTestId('guestbook-delete-deleted'));
  await act(async () => e.confirm.mock.calls[0][2]());
  await act(async () =>
    finish({
      ...page([entry('first'), entry('deleted'), entry('last'), entry('last')]),
      nextCursor: null,
    }),
  );
  expect(screen.getAllByText('first 놀러 왔어요')).toHaveLength(1);
  expect(screen.getAllByText('last 놀러 왔어요')).toHaveLength(1);
  expect(screen.queryByText('deleted 놀러 왔어요')).toBeNull();
});

test('다른 섬으로 이동한 뒤 이전 섬의 추가 페이지가 도착해도 섞이지 않는다', async () => {
  getMock.mockResolvedValueOnce({ ...page([entry('old')]), nextCursor: 'next' });
  let finish!: (value: unknown) => void;
  getMock.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  let more: (() => void) | null = null;
  const register = (load: (() => void) | null) => {
    more = load;
  };
  const screen = await render(<Guestbook islandId="i1" host={false} onLoadMoreReady={register} />);
  await screen.findByTestId('guestbook-submit');
  await act(async () => more?.());
  getMock.mockResolvedValueOnce({ ...page([entry('new-island')]), nextCursor: null });
  await screen.rerender(<Guestbook islandId="i2" host={false} onLoadMoreReady={register} />);
  await screen.findByText('new-island 놀러 왔어요');
  await act(async () => finish({ ...page([entry('late')]), nextCursor: null }));
  expect(screen.queryByText('late 놀러 왔어요')).toBeNull();
});

test('쓰기 409 뒤 첫 페이지를 다시 읽는 동안 지운 글도 늦은 응답으로 되살리지 않는다', async () => {
  const { screen, e } = await mount(true);
  let finish!: (value: unknown) => void;
  getMock.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  writeMock.mockRejectedValueOnce(new ApiError('GUESTBOOK_ALREADY_WRITTEN_TODAY', 'x', 409));
  await fireEvent.changeText(screen.getByTestId(INPUT), '안녕');
  await fireEvent.press(screen.getByTestId('guestbook-submit'));
  await screen.findByText('오늘은 이미 남겼어요');
  deleteMock.mockResolvedValueOnce({ deleted: true });
  await fireEvent.press(screen.getByTestId('guestbook-delete-g1'));
  await act(async () => e.confirm.mock.calls[0][2]());
  await act(async () => finish({ ...page([entry('g1'), entry('g2')]), nextCursor: null }));
  expect(screen.queryByText('g1 놀러 왔어요')).toBeNull();
  expect(screen.getByText('g2 놀러 왔어요')).toBeTruthy();
  expect(screen.getByTestId(INPUT).props.value).toBe('안녕');
});
