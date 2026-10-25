/**
 * 전망대 섬 찾기(GROMO-2269, 서버 모드 explore) — 디바운스 서버 검색 · 로딩/빈 결과/오류(재시도) · 행 상태(소속됨/신청 중) ·
 * 확인창 → 망원경에 넣기 → 토스트(+밀려난 섬 한 줄) · 실패 문구. searchIslands·pinToTelescope 는 목, 타이머는 가짜다.
 */
import React from 'react';
import { AccessibilityInfo, Platform, StyleSheet } from 'react-native';
import { act, fireEvent, render, within } from '@testing-library/react-native';
import { semanticTokens } from '@/design-system/tokens';
import { ObservatorySearch } from '@/screens/island/ObservatorySearch';
import { SEARCH_DEBOUNCE_MS } from '@/screens/island/useIslandSearch';
import { applyLocalePref } from '@/i18n';
import { ApiError, CLIENT_STALE_SESSION } from '@/services/api/client';
import { discoverIslands, searchIslands, type IslandSummary } from '@/services/api/islands';
import { pinToTelescope } from '@/services/api/telescope';

jest.mock('@/services/api/islands', () => ({
  ...jest.requireActual('@/services/api/islands'),
  searchIslands: jest.fn(),
  discoverIslands: jest.fn(),
}));
jest.mock('@/services/api/telescope', () => ({
  getTelescope: jest.fn(),
  arriveAtIsland: jest.fn(),
  pinToTelescope: jest.fn(),
}));
// 시스템 글자 배율 — 큰 글자 테스트가 바꾸고 beforeEach 가 되돌린다
let mockFontScale = 1;
jest.mock('@/utils/layout', () => ({
  useAppLayout: () => ({
    width: 402,
    height: 874,
    fontScale: mockFontScale,
    compact: false,
    landscape: false,
    tablet: false,
    contentWidth: 402,
    gutter: 20,
    modalWidth: 340,
    insets: { top: 52, bottom: 32, left: 0, right: 0 },
  }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

const searchMock = searchIslands as jest.Mock;
const discoverMock = discoverIslands as jest.Mock;
const pinMock = pinToTelescope as jest.Mock;

beforeEach(() => {
  mockFontScale = 1;
  jest.useFakeTimers();
  jest.clearAllMocks();
  searchMock.mockReset();
  pinMock.mockReset();
});
afterEach(() => {
  jest.useRealTimers();
  applyLocalePref('system');
});

const island = (id: string, over: Partial<IslandSummary> = {}): IslandSummary => ({
  id,
  name: `섬 ${id}`,
  intro: `${id} 소개`,
  visibility: 'public',
  approvalRequired: false,
  memberCount: 4,
  maxMembers: 15,
  membershipStatus: 'none',
  joinRequestId: null,
  growthStage: null,
  themeId: null,
  ...over,
});
const page = (items: IslandSummary[], nextCursor: string | null = null) => ({ items, nextCursor });
const pinned = (id: string, evicted: { islandId: string; name: string } | null = null) => ({
  item: { islandId: id, slot: 'pinned', pinnedFrom: 'observatory' },
  evicted,
});

function env() {
  return {
    back: jest.fn(),
    home: jest.fn(),
    notify: jest.fn(),
    confirm: jest.fn(),
  };
}

/** 열고 검색어를 쳐서 디바운스까지 진행한다. */
async function search(query: string, e = env()) {
  const screen = await render(<ObservatorySearch e={e} />);
  await type(screen, query);
  return { screen, e };
}
const type = async (screen: any, query: string) => {
  await fireEvent.changeText(screen.getByLabelText('섬 이름'), query);
  await act(async () => {
    jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
  });
};

test('처음에는 입력칸만 보이고 서버를 부르지 않는다(공개 섬 탐색 discover 도 없다)', async () => {
  const screen = await render(<ObservatorySearch e={env()} />);
  await act(async () => {
    jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS * 3);
  });
  screen.getByText('섬 찾기'); // 제목
  screen.getByLabelText('섬 이름'); // 입력 — 초대 코드가 아니라 섬 이름만 받는다
  expect(screen.queryByTestId('observatory-search-loading')).toBeNull();
  expect(screen.queryByTestId('observatory-search-empty')).toBeNull();
  expect(searchMock).not.toHaveBeenCalled();
  expect(discoverMock).not.toHaveBeenCalled();
});

test('입력이 300ms 멈춘 뒤 searchIslands 를 부르고 결과 행(이름 · 소개 · 주민 n/max)을 그린다', async () => {
  searchMock.mockResolvedValue(page([island('i1', { name: '단풍섬', intro: '같이 집중해요' })]));
  const e = env();
  const screen = await render(<ObservatorySearch e={e} />);
  await fireEvent.changeText(screen.getByLabelText('섬 이름'), ' 단풍 ');
  await act(async () => {
    jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1);
  });
  expect(searchMock).not.toHaveBeenCalled();
  // 입력 중에는 로딩 안내
  screen.getByTestId('observatory-search-loading');
  screen.getByText('섬을 찾고 있어요');
  await act(async () => {
    jest.advanceTimersByTime(1);
  });
  expect(searchMock).toHaveBeenCalledTimes(1);
  expect(searchMock).toHaveBeenCalledWith('단풍', { limit: 20 });
  screen.getByText('단풍섬');
  screen.getByText('같이 집중해요 · 주민 4/15');
  expect(screen.queryByTestId('observatory-search-loading')).toBeNull();
  expect(discoverMock).not.toHaveBeenCalled();
});

test('소개가 비어 있으면 주민 수만 보인다', async () => {
  searchMock.mockResolvedValue(page([island('i1', { name: '조용섬', intro: '' })]));
  const { screen } = await search('조용');
  screen.getByText('주민 4/15');
});

test('결과가 없으면 «찾는 섬이 없어요» — 로딩·오류와 따로 보인다', async () => {
  searchMock.mockResolvedValue(page([]));
  const { screen } = await search('없는섬');
  screen.getByText('찾는 섬이 없어요. 섬 이름을 다시 확인해 주세요.');
  expect(screen.queryByTestId('observatory-search-loading')).toBeNull();
  expect(screen.queryByTestId('observatory-search-error')).toBeNull();
});

test('결과가 첫 페이지를 넘으면 검색어를 좁히라고 안내한다', async () => {
  searchMock.mockResolvedValue(page([island('i1')], 'next'));
  const { screen } = await search('섬');
  screen.getByTestId('observatory-search-more');
  screen.getByText('더 많은 섬이 있어요. 섬 이름을 더 자세히 입력해 주세요.');
});

test('실패하면 오류 안내와 [다시 시도] — 누르면 디바운스 없이 같은 검색어로 바로 다시 부른다', async () => {
  searchMock
    .mockRejectedValueOnce(
      new ApiError('CLIENT_NETWORK_ERROR', '네트워크에 연결할 수 없어요. 연결을 확인해 주세요.', 0),
    )
    .mockResolvedValueOnce(page([island('i1', { name: '단풍섬' })]));
  const { screen } = await search('단풍');
  screen.getByTestId('observatory-search-error');
  screen.getByText('네트워크에 연결할 수 없어요. 연결을 확인해 주세요.');
  expect(screen.queryByTestId('observatory-search-empty')).toBeNull(); // 오류를 빈 결과로 접지 않는다
  await fireEvent.press(screen.getByRole('button', { name: '다시 시도' }));
  await act(async () => {}); // 타이머는 진행하지 않는다
  expect(searchMock).toHaveBeenCalledTimes(2);
  expect(searchMock).toHaveBeenLastCalledWith('단풍', { limit: 20 });
  screen.getByText('단풍섬');
  expect(screen.queryByTestId('observatory-search-error')).toBeNull();
});

test('서버가 보낸 한글 문구가 없는 오류는 «섬을 찾지 못했어요» 로 말한다', async () => {
  searchMock.mockRejectedValue(new ApiError('SOME_CODE', 'Bad Gateway', 502));
  const { screen } = await search('단풍');
  screen.getByText('섬을 찾지 못했어요.');
});

test('목록이 아닌 응답은 «결과 없음» 이 아니라 «섬을 찾지 못했어요» 오류와 [다시 시도] 로 보인다', async () => {
  searchMock.mockResolvedValue({ nextCursor: null });
  const { screen } = await search('단풍');
  screen.getByText('섬을 찾지 못했어요.');
  screen.getByRole('button', { name: '다시 시도' });
  expect(screen.queryByTestId('observatory-search-empty')).toBeNull();
});

test('늦게 온 옛 검색어 응답은 버린다', async () => {
  let resolveOld!: (value: ReturnType<typeof page>) => void;
  searchMock
    .mockReturnValueOnce(new Promise((r) => (resolveOld = r)))
    .mockResolvedValueOnce(page([island('new', { name: '새섬' })]));
  const { screen } = await search('ab');
  await type(screen, 'abc');
  screen.getByText('새섬');
  await act(async () => resolveOld(page([island('old', { name: '옛섬' })])));
  screen.getByText('새섬');
  expect(screen.queryByText('옛섬')).toBeNull();
});

test('소속 섬 행은 «소속됨» 배지로 보이고 눌러도 확인창이 뜨지 않는다', async () => {
  searchMock.mockResolvedValue(
    page([island('mine', { name: '우리섬', membershipStatus: 'active' }), island('other')]),
  );
  const { screen, e } = await search('섬');
  screen.getByText('소속됨');
  // 눌러지는 행이 아니다 — 읽는 이름에 소속이 들어간다
  expect(screen.queryByRole('button', { name: /^우리섬/ })).toBeNull();
  await fireEvent.press(screen.getByLabelText(/^우리섬,/));
  expect(e.confirm).not.toHaveBeenCalled();
  expect(pinMock).not.toHaveBeenCalled();
  expect(screen.getByLabelText(/^우리섬,/).props.accessibilityLabel).toBe(
    '우리섬, mine 소개 · 주민 4/15, 소속됨',
  );
  // 다른 섬은 평소대로 눌린다
  expect(screen.getByRole('button', { name: /^섬 other/ })).toBeTruthy();
});

test('가입 신청 중인 섬은 «신청 중» 배지가 붙지만 망원경에는 넣을 수 있다', async () => {
  searchMock.mockResolvedValue(
    page([island('req', { name: '신청섬', membershipStatus: 'pending', approvalRequired: true })]),
  );
  const { screen, e } = await search('신청');
  screen.getByText('신청 중');
  await fireEvent.press(screen.getByRole('button', { name: /^신청섬/ }));
  expect(e.confirm).toHaveBeenCalledTimes(1);
});

test.each([
  [1, false],
  [semanticTokens.typography.largeTextThreshold - 0.01, false],
  [semanticTokens.typography.largeTextThreshold, true],
  [3, true],
])(
  '검색 행 «소속됨»·«신청 중» 배지 — 글자 배율 %s 에서 이름 아래 줄로 내려가는가: %s',
  async (scale, stacked) => {
    mockFontScale = scale;
    searchMock.mockResolvedValue(
      page([
        island('mine', { name: '우리섬', membershipStatus: 'active' }),
        island('req', { name: '신청섬', membershipStatus: 'pending', approvalRequired: true }),
      ]),
    );
    const { screen } = await search('섬');
    for (const [name, badge] of [
      ['우리섬', '소속됨'],
      ['신청섬', '신청 중'],
    ]) {
      // 이름 글자의 부모가 본문(이름·소개) 칸이다. 고정 폭 썸네일 옆 오른쪽에 배지를 두면 큰 글자에서 배지가
      // 행 폭을 다 차지해 이 칸이 0 으로 줄어든다 — 큰 글자에서는 배지가 이 칸 안으로 내려온다.
      const body = screen.getByText(name).parent!;
      expect(StyleSheet.flatten(body.props.style)).toMatchObject({ flex: 1, minWidth: 0 });
      expect(within(body).queryByText(badge) !== null).toBe(stacked);
      // 보통 글자에서는 지금 자리 그대로 — 같은 행의 오른쪽 끝(본문 칸 밖)
      within(body.parent!).getByText(badge);
    }
  },
);

test('결과 행을 누르면 확인창이 뜨고, 확인하기 전에는 서버에 보내지 않는다', async () => {
  searchMock.mockResolvedValue(page([island('i1', { name: '단풍섬' })]));
  const { screen, e } = await search('단풍');
  await fireEvent.press(screen.getByRole('button', { name: /^단풍섬/ }));
  expect(e.confirm).toHaveBeenCalledTimes(1);
  const [title, body, , opts] = e.confirm.mock.calls[0];
  expect(title).toBe('단풍섬');
  expect(body).toBe(
    '뗏목의 망원경에서 이 섬을 볼 수 있어요. 직접 넣은 섬이 가득 차면 가장 먼저 넣은 섬이 빠져요.',
  );
  expect(opts).toEqual({ ok: '망원경에 넣기' });
  expect(pinMock).not.toHaveBeenCalled();
  expect(e.notify).not.toHaveBeenCalled();
});

test('확인하면 pinToTelescope(id, observatory) 를 한 번 부르고 토스트로 알린다', async () => {
  searchMock.mockResolvedValue(page([island('i1', { name: '단풍섬' })]));
  pinMock.mockResolvedValue(pinned('i1'));
  const { screen, e } = await search('단풍');
  await fireEvent.press(screen.getByRole('button', { name: /^단풍섬/ }));
  await act(async () => e.confirm.mock.calls[0][2]());
  expect(pinMock).toHaveBeenCalledTimes(1);
  expect(pinMock).toHaveBeenCalledWith('i1', 'observatory');
  expect(e.notify).toHaveBeenCalledTimes(1);
  expect(e.notify).toHaveBeenCalledWith('망원경에 넣었어요 — 뗏목의 망원경에서 볼 수 있어요');
  // 검색 화면은 그대로 — 결과가 남아 있다
  screen.getByText('단풍섬');
});

test('핀이 가득 차 밀려난 섬이 있으면 같은 토스트에 한 줄 더 알린다', async () => {
  searchMock.mockResolvedValue(page([island('i1', { name: '단풍섬' })]));
  pinMock.mockResolvedValue(pinned('i1', { islandId: 'old', name: '바람' }));
  const { screen, e } = await search('단풍');
  await fireEvent.press(screen.getByRole('button', { name: /^단풍섬/ }));
  await act(async () => e.confirm.mock.calls[0][2]());
  expect(e.notify).toHaveBeenCalledTimes(1);
  expect(e.notify).toHaveBeenCalledWith(
    '망원경에 넣었어요 — 뗏목의 망원경에서 볼 수 있어요\n바람섬이 망원경에서 빠졌어요',
  );
});

test('확인 버튼을 연달아 눌러 같은 확인 동작이 두 번 불려도 요청은 한 번만 나간다', async () => {
  searchMock.mockResolvedValue(page([island('i1', { name: '단풍섬' })]));
  pinMock.mockResolvedValue(pinned('i1'));
  const { screen, e } = await search('단풍');
  await fireEvent.press(screen.getByRole('button', { name: /^단풍섬/ }));
  const confirmed = e.confirm.mock.calls[0][2];
  await act(async () => {
    confirmed();
    confirmed();
  });
  expect(pinMock).toHaveBeenCalledTimes(1);
  expect(e.notify).toHaveBeenCalledTimes(1);
});

test('요청 중에는 행이 막혀 두 번째 확인창이 뜨지 않고, 끝나면 다시 열린다', async () => {
  searchMock.mockResolvedValue(page([island('i1', { name: '단풍섬' }), island('i2')]));
  let finish!: () => void;
  pinMock.mockReturnValue(new Promise((r) => (finish = () => r(pinned('i1')))));
  const { screen, e } = await search('섬');
  await fireEvent.press(screen.getByRole('button', { name: /^단풍섬/ }));
  await act(async () => {
    e.confirm.mock.calls[0][2]();
  });
  expect(screen.getByRole('button', { name: /^섬 i2/ }).props.accessibilityState.disabled).toBe(
    true,
  );
  await fireEvent.press(screen.getByRole('button', { name: /^섬 i2/ }));
  expect(e.confirm).toHaveBeenCalledTimes(1);
  expect(pinMock).toHaveBeenCalledTimes(1);
  await act(async () => finish());
  expect(screen.getByRole('button', { name: /^섬 i2/ }).props.accessibilityState.disabled).toBe(
    false,
  );
});

describe('넣기 실패는 기존 섬 오류 문구로 알린다', () => {
  const fail = async (error: unknown) => {
    searchMock.mockResolvedValue(page([island('i1', { name: '단풍섬' })]));
    pinMock.mockRejectedValue(error);
    const { screen, e } = await search('단풍');
    await fireEvent.press(screen.getByRole('button', { name: /^단풍섬/ }));
    await act(async () => e.confirm.mock.calls[0][2]());
    return e;
  };

  test.each([
    [
      '강퇴 섬 403',
      new ApiError('FORBIDDEN', 'x', 403, { field: 'islandId' }),
      '이 섬에는 넣을 수 없어요',
    ],
    ['내 소속 섬 409', new ApiError('STATE_CONFLICT', 'x', 409), '이미 내가 속한 섬이에요'],
    [
      '없는·비공개 섬 404',
      new ApiError('GROUP_NOT_FOUND', 'x', 404),
      '더 이상 이용할 수 없는 섬이에요. 다른 섬을 선택해 주세요.',
    ],
    [
      '연결 끊김',
      new ApiError('CLIENT_NETWORK_ERROR', 'x', 0),
      '연결을 확인한 뒤 다시 시도해 주세요.',
    ],
  ])('%s', async (_name, error, text) => {
    const e = await fail(error);
    expect(e.notify).toHaveBeenCalledTimes(1);
    expect(e.notify).toHaveBeenCalledWith(text);
  });

  test('세션이 바뀐 늦은 응답(CLIENT_STALE_SESSION)은 문구 없이 버린다', async () => {
    const e = await fail(new ApiError(CLIENT_STALE_SESSION, '로그인 정보가 바뀌었어요.', 0));
    expect(e.notify).not.toHaveBeenCalled();
  });

  test('실패한 뒤에도 행은 다시 눌린다', async () => {
    const e = await fail(new ApiError('CLIENT_NETWORK_ERROR', 'x', 0));
    expect(e.confirm).toHaveBeenCalledTimes(1);
  });
});

test('실패·빈 결과 안내가 뜨면 iOS 는 한 번 읽어 주고(live region 도 걸려 있다), 결과가 나오면 읽지 않는다', async () => {
  const announce = jest
    .spyOn(AccessibilityInfo, 'announceForAccessibility')
    .mockImplementation(() => {});
  try {
    searchMock
      .mockRejectedValueOnce(
        new ApiError('CLIENT_NETWORK_ERROR', '네트워크에 연결할 수 없어요.', 0),
      )
      .mockResolvedValueOnce(page([]))
      .mockResolvedValueOnce(page([island('i1')]));
    const { screen } = await search('단풍');
    const failure = screen.getByText('네트워크에 연결할 수 없어요.');
    expect(failure.props.accessibilityLiveRegion).toBe('polite');
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenLastCalledWith('네트워크에 연결할 수 없어요.');

    await type(screen, '없는섬');
    expect(screen.getByTestId('observatory-search-empty').props.accessibilityLiveRegion).toBe(
      'polite',
    );
    expect(announce).toHaveBeenCalledTimes(2);
    expect(announce).toHaveBeenLastCalledWith('찾는 섬이 없어요. 섬 이름을 다시 확인해 주세요.');

    await type(screen, '단풍섬');
    screen.getByText('섬 i1');
    expect(announce).toHaveBeenCalledTimes(2);
  } finally {
    announce.mockRestore();
  }
});

test('안드로이드는 직접 읽지 않고 live region 에만 맡긴다', async () => {
  const announce = jest
    .spyOn(AccessibilityInfo, 'announceForAccessibility')
    .mockImplementation(() => {});
  const os = jest.replaceProperty(Platform, 'OS', 'android');
  try {
    searchMock.mockRejectedValue(
      new ApiError('CLIENT_NETWORK_ERROR', '네트워크에 연결할 수 없어요.', 0),
    );
    const { screen } = await search('단풍');
    expect(screen.getByText('네트워크에 연결할 수 없어요.').props.accessibilityLiveRegion).toBe(
      'polite',
    );
    expect(announce).not.toHaveBeenCalled();
  } finally {
    os.restore();
    announce.mockRestore();
  }
});

test('로딩 안내에는 live region 을 걸지 않는다 — 입력마다 패널이 새로 떠서 TalkBack 이 키마다 되풀이해 읽는다', async () => {
  searchMock.mockReturnValue(new Promise(() => {})); // 응답이 오지 않아 로딩이 이어진다
  const { screen } = await search('단');
  const panel = within(screen.getByTestId('observatory-search-loading'));
  expect(panel.getByText('섬을 찾고 있어요').props.accessibilityLiveRegion).toBeUndefined();
});

test('영어 로케일 — 안내·배지·확인창·토스트가 모두 번역된다', async () => {
  applyLocalePref('en');
  searchMock.mockResolvedValue(
    page([
      island('i1', { name: 'Maple' }),
      island('i2', { name: 'Mine', membershipStatus: 'active' }),
    ]),
  );
  pinMock.mockResolvedValue(pinned('i1', { islandId: 'old', name: 'Breeze' }));
  const e = env();
  const screen = await render(<ObservatorySearch e={e} />);
  screen.getByText('Find islands');
  await fireEvent.changeText(screen.getByLabelText('Island name'), 'm');
  await act(async () => {
    jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
  });
  screen.getByText('Joined');
  screen.getByText('i1 소개 · Residents 4/15'); // 소개는 서버 값이라 번역되지 않는다
  await fireEvent.press(screen.getByRole('button', { name: /^Maple/ }));
  const [title, body, , opts] = e.confirm.mock.calls[0];
  expect(title).toBe('Maple');
  expect(body).toMatch(/raft's telescope/);
  expect(opts).toEqual({ ok: 'Add to telescope' });
  await act(async () => e.confirm.mock.calls[0][2]());
  expect(e.notify).toHaveBeenCalledWith(
    "Added to your telescope — see it in your raft's telescope\nBreeze was removed from your telescope",
  );
});

test('뒤로·닫기는 e.back · e.home 이다', async () => {
  const e = env();
  const screen = await render(<ObservatorySearch e={e} />);
  await fireEvent.press(screen.getByLabelText('뒤로'));
  expect(e.back).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByLabelText('닫기'));
  expect(e.home).toHaveBeenCalledTimes(1);
});
