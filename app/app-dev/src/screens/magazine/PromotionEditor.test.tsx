// 우리 섬 홍보 쓰기(GROMO-2289 · C1·C2) — 지난 칸으로 열기 · 새로 꾸미기 · 10개 제한 · 신청(멱등 키·본문) · 오류 코드별 안내 ·
// 게스트 → 회원 전환 · 접수 완료 발도장 · 고치기 · 자정 뒤 읽기 전용 · 07시 다시 열림 · 잔액 부족 · 섬장 아님 ·
// 칸 위 손가락(끌기 · 두 손가락 크기·회전 · 손잡이 · 빈 곳 톡 · 테이프 붙이기) · 스크린리더 동작.
// 서버 API(magazine.ts)는 목이다. 손가락은 touchDriver 로 판의 PanResponder 에 진짜 터치 모양 이벤트를 넣는다.
import React from 'react';
import { StyleSheet } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { ApiError } from '@/services/api/client';
import * as api from '@/services/api/magazine';
import type { PromotionEditor as EditorResponse } from '@/services/api/magazine';
import { initialState } from '@/services/model';
import { saveSession } from '@/services/api/session';
import { CELL_ASPECT, PromotionLayout } from './layout';
import { EditorDriver, PromotionEditor } from './PromotionEditor';
import { CANVAS_PAD } from './useStickerGestures';
import { createTouchDriver } from './touchDriver';

jest.mock('@/services/api/magazine', () => ({
  ...jest.requireActual('@/services/api/magazine'),
  getPromotionEditor: jest.fn(),
  getMagazineAssets: jest.fn(),
  applyPromotion: jest.fn(),
  updatePromotion: jest.fn(),
}));
// 글자 배율만 바꿔 끼운다(나머지는 실제 화면 치수)
let mockFontScale = 1;
jest.mock('@/utils/layout', () => {
  const actual = jest.requireActual('@/utils/layout');
  return { useAppLayout: () => ({ ...actual.useAppLayout(), fontScale: mockFontScale }) };
});
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
const getEditor = api.getPromotionEditor as jest.Mock;
const getAssets = api.getMagazineAssets as jest.Mock;
const apply = api.applyPromotion as jest.Mock;
const update = api.updatePromotion as jest.Mock;

const LAYOUT: PromotionLayout = {
  v: 1,
  frameId: 'mag.frame-catear',
  stickers: [
    { assetId: 'mag.cat-ginger-fish', x: 0.5, y: 0.5, scale: 0.2, rotation: 0 },
    { assetId: 'mag.heart', x: 0.85, y: 0.8, scale: 0.1, rotation: 0 },
  ],
  tape: null,
};
const editorResponse = (over: Partial<EditorResponse> = {}): EditorResponse => ({
  window: {
    open: true,
    issueDate: '2026-10-15',
    closesAt: '2026-10-14T15:00:00Z',
    opensAt: '2026-10-14T22:00:00Z',
  },
  next: null,
  latest: { promotionId: 'p0', issueDate: '2026-10-12', body: '같이 공부해요!', layout: LAYOUT },
  feeFish: 60,
  balance: 1240,
  privateIsland: false,
  ...over,
});

const env = (over: object = {}) => ({
  state: initialState(true),
  back: jest.fn(),
  go: jest.fn(),
  notify: jest.fn(),
  ...over,
});
const centerOf = (s: any) => ({ x: s.left + s.width / 2, y: s.top + s.height / 2 });
const stickerStyles = (screen: any) =>
  screen
    .queryAllByTestId('promotion-cell-sticker', { includeHiddenElements: true })
    .map((n: any) => StyleSheet.flatten(n.props.style));

beforeEach(() => {
  jest.clearAllMocks();
  getAssets.mockRejectedValue(new Error('offline')); // 재료 목록을 못 읽어도 쓰기는 된다
});

async function open(over: Partial<EditorResponse> = {}, e = env()) {
  getEditor.mockResolvedValue(editorResponse(over));
  const screen = await render(<PromotionEditor e={e} />);
  await waitFor(() => expect(screen.getByTestId('promotion-canvas')).toBeTruthy());
  return { screen, e };
}

describe('여닫기', () => {
  it('지난번에 실은 칸(글·틀·스티커)으로 열리고, [새로 꾸미기]는 빈 칸이다', async () => {
    const { screen } = await open();
    expect(getEditor).toHaveBeenCalledWith('soda');
    expect(screen.getByTestId('promotion-body').props.value).toBe('같이 공부해요!');
    expect(stickerStyles(screen)).toHaveLength(2);
    await fireEvent.press(screen.getByTestId('promotion-fresh'));
    expect(screen.getByTestId('promotion-body').props.value).toBe('');
    expect(stickerStyles(screen)).toHaveLength(0);
  });

  it('섬장이 아니면 서버를 부르지 않고 안내만', async () => {
    const state = initialState(true);
    state.islands[0].members[0].role = 'host';
    const screen = await render(<PromotionEditor e={env({ state })} />);
    expect(screen.getByText('섬장만 홍보를 쓸 수 있어요')).toBeTruthy();
    expect(getEditor).not.toHaveBeenCalled();
  });

  it('회원 전환을 마치면(새 세션) 그 자리에서 다시 읽어 쓰기 화면이 열린다', async () => {
    getEditor
      .mockRejectedValueOnce(new ApiError('SOCIAL_LOGIN_REQUIRED', '로그인', 403))
      .mockResolvedValueOnce(editorResponse());
    const screen = await render(<PromotionEditor e={env({ conversion: { offer: () => true } })} />);
    await waitFor(() =>
      expect(screen.getByText('소셜 로그인을 하면 우리 섬을 잡지에 실을 수 있어요')).toBeTruthy(),
    );
    await act(async () => {
      await saveSession({ accessToken: 'AT2', refreshToken: 'RT2', userId: 'me' });
    });
    await waitFor(() => expect(screen.getByTestId('promotion-canvas')).toBeTruthy());
    expect(getEditor).toHaveBeenCalledTimes(2);
  });

  it('재료 목록이 늦어도 편집기 응답만으로 먼저 열린다', async () => {
    getAssets.mockReturnValueOnce(new Promise(() => {}));
    await open();
  });

  it('게스트 섬장이면 들어가는 순간 회원 전환 시트를 연다', async () => {
    const gate = new ApiError('SOCIAL_LOGIN_REQUIRED', '로그인', 403);
    getEditor.mockRejectedValue(gate);
    const offer = jest.fn(() => true);
    const screen = await render(<PromotionEditor e={env({ conversion: { offer } })} />);
    await waitFor(() => expect(offer).toHaveBeenCalledWith(gate));
    expect(screen.getByText('소셜 로그인을 하면 우리 섬을 잡지에 실을 수 있어요')).toBeTruthy();
  });
});

describe('작은 화면·큰 글자·고르기', () => {
  it('머리 제목은 큰 글자에서 잘리지 않고 여러 줄로 감긴다', async () => {
    const { screen } = await open();
    expect(screen.getByTestId('promotion-title').props.numberOfLines).toBeUndefined();
  });

  it('서랍 탭은 44pt 이고 좁은 화면에서는 감긴다', async () => {
    const { screen } = await open();
    for (const tab of ['고양이', '바다', '친구들', '꾸미기'])
      expect(StyleSheet.flatten(screen.getByLabelText(tab).props.style).height).toBe(44);
  });

  it('아래 고정 줄 버튼은 문구가 감기면 높이가 늘고, 큰 글자에서는 세로로 쌓인다', async () => {
    const actions = (screen: any) =>
      StyleSheet.flatten(screen.getByTestId('promotion-actions').props.style).flexDirection;
    const submitHeight = (screen: any) =>
      StyleSheet.flatten(screen.getByTestId('promotion-submit').props.style).height;
    const normal = await open();
    expect(actions(normal.screen)).toBe('row');
    expect(submitHeight(normal.screen)).toBeUndefined(); // 고정 52 가 아니라 최소 52 에서 늘어난다
    await normal.screen.unmount();
    mockFontScale = 1.6;
    try {
      const large = await open();
      expect(actions(large.screen)).toBe('column-reverse');
      // 고른 꾸미기 버튼 줄도 글자에 맞춰 높이가 는다
      await fireEvent(large.screen.getByTestId('canvas-sticker-0'), 'accessibilityAction', {
        nativeEvent: { actionName: 'activate' },
      });
      expect(
        StyleSheet.flatten(large.screen.getByTestId('op-bigger').props.style).height,
      ).toBeUndefined();
    } finally {
      mockFontScale = 1;
    }
  });

  it('다시 읽어 서버 칸으로 바뀌면 고르기가 풀린다 — 없는 스티커 번호로 그리지 않는다', async () => {
    const { screen } = await open();
    await fireEvent(screen.getByTestId('canvas-sticker-1'), 'accessibilityAction', {
      nativeEvent: { actionName: 'activate' },
    });
    expect(screen.getByTestId('op-delete')).toBeTruthy();
    // 다른 기기에서 먼저 신청 — 다시 읽으면 스티커 1장짜리 서버 칸이 온다
    apply.mockRejectedValueOnce(new ApiError('PROMOTION_ALREADY_REQUESTED_TODAY', '이미', 409));
    const server = { ...LAYOUT, stickers: [LAYOUT.stickers[0]] };
    getEditor.mockResolvedValueOnce(
      editorResponse({
        next: {
          promotionId: 'p8',
          issueDate: '2026-10-15',
          body: '다른 기기 글',
          layout: server,
          appliedAt: 'x',
          editable: true,
        },
      }),
    );
    await fireEvent.press(screen.getByTestId('promotion-submit'));
    await waitFor(() =>
      expect(screen.getByTestId('promotion-body').props.value).toBe('다른 기기 글'),
    );
    expect(stickerStyles(screen)).toHaveLength(1);
    expect(screen.queryByTestId('op-delete')).toBeNull();
  });
});

describe('스티커·테이프·틀·글', () => {
  it('서랍에서 붙이면 가운데에 붙고 11번째는 안내만 뜬다', async () => {
    const { screen, e } = await open({ latest: null });
    for (let i = 0; i < 10; i++)
      await fireEvent.press(screen.getByTestId('drawer-mag.cat-black-book'));
    expect(stickerStyles(screen)).toHaveLength(10);
    await fireEvent.press(screen.getByTestId('drawer-mag.cat-black-book'));
    expect(stickerStyles(screen)).toHaveLength(10);
    expect(e.notify).toHaveBeenCalledWith('스티커는 10개까지 붙일 수 있어요');
    // 본문도 세로 스크롤이라 Android 에서 안쪽 서랍이 제스처를 받는다
    expect(screen.getByTestId('sticker-drawer').props.nestedScrollEnabled).toBe(true);
  });

  it('테이프는 하나 — 다른 테이프를 고르면 바꿔 끼운다', async () => {
    const { screen } = await open({ latest: null });
    await fireEvent.press(screen.getByText('꾸미기'));
    await fireEvent.press(screen.getByTestId('drawer-mag.tape-pink'));
    await fireEvent.press(screen.getByTestId('drawer-mag.tape-mint'));
    const tapes = screen.queryAllByTestId('promotion-cell-tape', { includeHiddenElements: true });
    expect(tapes).toHaveLength(1);
    expect(screen.getByTestId('drawer-mag.tape-mint').props.accessibilityState.selected).toBe(true);
  });

  it('테이프에는 크기·맨 앞으로가 없다 — 버튼 줄과 스크린리더 동작 모두 실제로 되는 것만', async () => {
    const { screen } = await open({ latest: null });
    await fireEvent.press(screen.getByText('꾸미기'));
    await fireEvent.press(screen.getByTestId('drawer-mag.tape-pink'));
    const tape = screen.getByTestId('canvas-tape');
    const names = tape.props.accessibilityActions.map((a: { name: string }) => a.name);
    expect(names).toEqual(
      expect.arrayContaining(['activate', 'up', 'down', 'left', 'right', 'rotateLeft', 'delete']),
    );
    expect(names.filter((n: string) => ['bigger', 'smaller', 'front'].includes(n))).toEqual([]);
    await fireEvent(tape, 'accessibilityAction', { nativeEvent: { actionName: 'activate' } });
    expect(screen.getByTestId('op-rotateLeft')).toBeTruthy();
    expect(screen.queryByTestId('op-bigger')).toBeNull();
    expect(screen.queryByTestId('op-front')).toBeNull();
  });

  it('틀을 고르면 칸 틀이 바뀌고, 글은 코드포인트 60자에서 자르고 줄바꿈은 띄어쓰기로', async () => {
    const { screen } = await open();
    await fireEvent.press(screen.getByTestId('frame-mag.frame-ticket'));
    expect(screen.getByTestId('frame-mag.frame-ticket').props.accessibilityState.selected).toBe(
      true,
    );
    await fireEvent.changeText(screen.getByTestId('promotion-body'), `🐟${'가'.repeat(70)}`);
    expect(Array.from(screen.getByTestId('promotion-body').props.value)).toHaveLength(60);
    await fireEvent.changeText(screen.getByTestId('promotion-body'), '첫 줄\n둘째 줄');
    expect(screen.getByTestId('promotion-body').props.value).toBe('첫 줄 둘째 줄');
    // 서버가 거절하는 제어 문자(탭 등)와 U+2028·U+2029 도 띄어쓰기로
    await fireEvent.changeText(screen.getByTestId('promotion-body'), '탭\t글\u2028끝\u0085!');
    expect(screen.getByTestId('promotion-body').props.value).toBe('탭 글 끝 !');
  });

  it('고른 스티커를 버튼으로 크게·맨 앞으로·지우기', async () => {
    const { screen } = await open();
    const driver = createTouchDriver(screen.getByTestId('promotion-canvas').props);
    const cellW =
      StyleSheet.flatten(screen.getByTestId('promotion-canvas').props.style).width /
      (1 + 2 * CANVAS_PAD);
    const at = (x: number, y: number) => ({
      x: (CANVAS_PAD + x) * cellW,
      y: (CANVAS_PAD + y) * cellW * CELL_ASPECT,
    });
    await act(async () => {
      driver.down(at(0.5, 0.5));
      driver.up();
    });
    // 옮기기도 버튼으로 — 끌 수 없어도 위치를 바꾼다
    const left = stickerStyles(screen)[0].left;
    const top = stickerStyles(screen)[0].top;
    await fireEvent.press(screen.getByTestId('op-right'));
    await fireEvent.press(screen.getByTestId('op-down'));
    expect(stickerStyles(screen)[0].left).toBeGreaterThan(left);
    expect(stickerStyles(screen)[0].top).toBeGreaterThan(top);
    expect(screen.getByTestId('op-left').props.accessibilityLabel).toMatch(/^왼쪽으로/);
    const before = stickerStyles(screen)[0].width;
    await fireEvent.press(screen.getByTestId('op-bigger'));
    const bigger = stickerStyles(screen)[0].width;
    expect(bigger).toBeGreaterThan(before);
    // 맨 앞으로 = 배열 끝(맨 위에 그려짐)
    await fireEvent.press(screen.getByTestId('op-front'));
    expect(stickerStyles(screen)[1].width).toBe(bigger);
    await fireEvent.press(screen.getByTestId('op-delete'));
    expect(stickerStyles(screen)).toHaveLength(1);
    expect(screen.queryByTestId('op-delete')).toBeNull();
  });
});

describe('칸 위 손가락', () => {
  async function canvas() {
    const opened = await open();
    const box = StyleSheet.flatten(opened.screen.getByTestId('promotion-canvas').props.style);
    const cellW = box.width / (1 + 2 * CANVAS_PAD);
    const at = (x: number, y: number) => ({
      x: (CANVAS_PAD + x) * cellW,
      y: (CANVAS_PAD + y) * cellW * CELL_ASPECT,
    });
    const driver = () => createTouchDriver(opened.screen.getByTestId('promotion-canvas').props);
    return { ...opened, cellW, at, driver };
  }

  it('한 손가락으로 끌어 옮긴다(칸 비율 좌표가 손가락 이동만큼 바뀐다)', async () => {
    const { screen, at, cellW, driver } = await canvas();
    const before = centerOf(stickerStyles(screen)[0]);
    await act(async () => driver().drag(at(0.5, 0.5), at(0.3, 0.35)));
    const after = centerOf(stickerStyles(screen)[0]);
    expect(after.x - before.x).toBeCloseTo(-0.2 * cellW, 0);
    expect(after.y - before.y).toBeCloseTo(-0.15 * cellW * CELL_ASPECT, 0);
  });

  it('두 손가락으로 벌리고 돌리면 크기·회전이 함께 바뀐다', async () => {
    const { screen, at, driver } = await canvas();
    const before = stickerStyles(screen)[0];
    const d = driver();
    await act(async () => {
      d.down(at(0.45, 0.5));
      d.second(at(0.55, 0.5));
      d.move(at(0.4, 0.5), at(0.6, 0.5)); // 거리 2배
      d.move(at(0.5, 0.35), at(0.5, 0.65)); // 90도 돌림(거리는 그대로 2배 정도)
      d.up();
    });
    const after = stickerStyles(screen)[0];
    expect(after.width / before.width).toBeGreaterThan(1.5);
    expect(after.transform[0].rotate).toMatch(/^(8\d|9\d)(\.\d+)?deg$/);
  });

  it('고른 스티커 오른쪽 아래 손잡이를 한 손가락으로 끌면 크기·회전', async () => {
    const { screen, at, driver } = await canvas();
    await act(async () => {
      const d = driver();
      d.down(at(0.5, 0.5));
      d.up();
    });
    const handle = StyleSheet.flatten(screen.getByTestId('promotion-handle').props.style);
    const start = { x: handle.left + 9, y: handle.top + 9 };
    const before = stickerStyles(screen)[0].width;
    await act(async () => driver().drag(start, { x: start.x + 40, y: start.y + 30 }));
    expect(stickerStyles(screen)[0].width).toBeGreaterThan(before);
  });

  it('빈 곳을 톡 누르면 고르기가 풀리고(손잡이 사라짐), 아무것도 옮기지 않는다', async () => {
    const { screen, at, driver } = await canvas();
    await act(async () => {
      const d = driver();
      d.down(at(0.5, 0.5));
      d.up();
    });
    expect(screen.getByTestId('promotion-handle')).toBeTruthy();
    const before = stickerStyles(screen).map(centerOf);
    await act(async () => {
      const d = driver();
      d.down(at(0.1, 0.9));
      d.up();
    });
    expect(screen.queryByTestId('promotion-handle')).toBeNull();
    expect(stickerStyles(screen).map(centerOf)).toEqual(before);
  });

  it('테이프는 끌어 놓으면 가장 가까운 테두리 띠에 붙는다', async () => {
    const { screen, at, cellW, driver } = await canvas();
    await fireEvent.press(screen.getByText('꾸미기'));
    await fireEvent.press(screen.getByTestId('drawer-mag.tape-pink'));
    await act(async () => driver().drag(at(0.5, 0.04), at(0.4, 0.3)));
    const tape = StyleSheet.flatten(
      screen.getByTestId('promotion-cell-tape', { includeHiddenElements: true }).props.style,
    );
    // y 0.3 은 위 테두리(0.3)가 가장 가깝다 → 위 띠 가운데(0.04)로
    expect(tape.top + tape.height / 2).toBeCloseTo(0.04 * cellW * CELL_ASPECT, 0);
    expect(tape.left + tape.width / 2).toBeCloseTo(0.4 * cellW, 0);
  });

  it('작은 화면·키보드에서 본문을 세로로 밀 수 있고, 칸 위에 손가락이 있는 동안은 스크롤을 잠근다', async () => {
    const { screen } = await canvas();
    const scroll = () => screen.getByTestId('promotion-scroll');
    expect(scroll().props.scrollEnabled).toBe(true);
    await fireEvent(screen.getByTestId('promotion-canvas'), 'touchStart');
    expect(scroll().props.scrollEnabled).toBe(false);
    // 두 손가락 중 하나만 떼면 아직 잠겨 있다
    await fireEvent(screen.getByTestId('promotion-canvas'), 'touchEnd', {
      nativeEvent: { touches: [{}] },
    });
    expect(scroll().props.scrollEnabled).toBe(false);
    await fireEvent(screen.getByTestId('promotion-canvas'), 'touchEnd', {
      nativeEvent: { touches: [] },
    });
    expect(scroll().props.scrollEnabled).toBe(true);
  });

  it('스크린리더 동작으로도 고른다·크게·지운다', async () => {
    const { screen } = await canvas();
    const item = screen.getByTestId('canvas-sticker-0');
    // 작은 스티커(하트)도 접근성 요소는 44pt 이상이다
    for (const i of [0, 1]) {
      const frame = StyleSheet.flatten(screen.getByTestId(`canvas-sticker-${i}`).props.style);
      expect(Math.min(frame.width, frame.height)).toBeGreaterThanOrEqual(44);
    }
    const before = stickerStyles(screen)[0].width;
    await fireEvent(item, 'accessibilityAction', { nativeEvent: { actionName: 'bigger' } });
    expect(stickerStyles(screen)[0].width).toBeGreaterThan(before);
    await fireEvent(screen.getByTestId('canvas-sticker-0'), 'accessibilityAction', {
      nativeEvent: { actionName: 'delete' },
    });
    expect(stickerStyles(screen)).toHaveLength(1);
  });
});

describe('싣기·고치기', () => {
  it('신청은 멱등 키와 {body, layout} 를 보내고, 같은 글 다시 시도는 같은 키다', async () => {
    const { screen } = await open();
    apply.mockRejectedValueOnce(new ApiError('NETWORK', '연결', 0, { retryable: true }));
    await fireEvent.press(screen.getByTestId('promotion-submit'));
    apply.mockResolvedValueOnce({
      promotionId: 'p1',
      issueDate: '2026-10-15',
      feeFish: 60,
      balanceAfter: 1180,
      newsId: 'n1',
    });
    await fireEvent.press(screen.getByTestId('promotion-submit'));
    expect(apply).toHaveBeenCalledTimes(2);
    const [islandId, draft, key] = apply.mock.calls[0];
    expect(islandId).toBe('soda');
    expect(draft).toEqual({ body: '같이 공부해요!', layout: LAYOUT });
    expect(apply.mock.calls[1][2]).toBe(key);
    // 접수 완료: 발도장 + 모달, 버튼은 고치기로(확인창 뒤라 스크린리더에서는 숨은 상태)
    const hidden = { includeHiddenElements: true };
    expect(screen.getByTestId('promotion-stamp', hidden)).toBeTruthy();
    expect(screen.getByText('내일 07시 호에 실려요. 자정까지 고칠 수 있어요')).toBeTruthy();
    expect(screen.getByText('고친 내용 저장', hidden)).toBeTruthy();
    expect(screen.getByText(/섬 통장 1,180마리/, hidden)).toBeTruthy();
    // 확인창이 열린 동안 뒤의 편집기는 스크린리더에서 숨는다
    const layer = () => screen.getByTestId('promotion-editor-layer', hidden).props;
    expect(layer().accessibilityElementsHidden).toBe(true);
    expect(layer().importantForAccessibility).toBe('no-hide-descendants');
    await fireEvent.press(screen.getByTestId('promotion-done-ok'));
    expect(layer().accessibilityElementsHidden).toBe(false);
  });

  it('빈 글은 서버에 보내지 않고 글 칸 아래에 안내한다', async () => {
    const { screen } = await open({ latest: null });
    await fireEvent.press(screen.getByTestId('promotion-submit'));
    expect(apply).not.toHaveBeenCalled();
    expect(screen.getByText('한 줄 글을 적어 주세요')).toBeTruthy();
  });

  it.each([
    ['INSUFFICIENT_FUNDS', '섬 통장 물고기가 모자라요', true],
    ['PROMOTION_PRIVATE_ISLAND', '비공개 섬은 잡지에 실을 수 없어요', true],
    ['PROMOTION_WINDOW_CLOSED', '지금은 신청할 수 없어요. 아침 7시에 다시 열려요', true],
    ['PROMOTION_LAYOUT_INVALID', '꾸미기를 다시 확인해 주세요', true],
    ['SERVICE_UNAVAILABLE', '잡지가 아직 준비 중이에요. 잠시 후 다시 해 주세요', false],
  ])('%s → 「%s」(다시 읽기 %s)', async (code, message, reload) => {
    const { screen, e } = await open();
    apply.mockRejectedValueOnce(new ApiError(code, '서버 문구', 409));
    await fireEvent.press(screen.getByTestId('promotion-submit'));
    expect(e.notify).toHaveBeenCalledWith(message);
    await waitFor(() => expect(getEditor).toHaveBeenCalledTimes(reload ? 2 : 1));
  });

  it('금칙어는 글 칸 아래 빨간 안내', async () => {
    const { screen, e } = await open();
    apply.mockRejectedValueOnce(new ApiError('BANNED_WORD', '쓸 수 없는 말이 있어요', 400));
    await fireEvent.press(screen.getByTestId('promotion-submit'));
    expect(screen.getByText('쓸 수 없는 말이 있어요')).toBeTruthy();
    expect(e.notify).not.toHaveBeenCalled();
  });

  it('이미 낸 다음 호 홍보가 있으면 [고친 내용 저장] → PUT', async () => {
    const next = { promotionId: 'p9', issueDate: '2026-10-15', body: '다음 호 글', layout: LAYOUT };
    const { screen, e } = await open({ next: { ...next, appliedAt: 'x', editable: true } });
    expect(screen.getByTestId('promotion-body').props.value).toBe('다음 호 글');
    update.mockResolvedValueOnce({ ...next, updatedAt: 'y' });
    await fireEvent.press(screen.getByText('고친 내용 저장'));
    expect(update).toHaveBeenCalledWith('soda', 'p9', { body: '다음 호 글', layout: LAYOUT });
    expect(e.notify).toHaveBeenCalledWith('고친 내용을 저장했어요');
  });
});

describe('신청 창·잔액·비공개', () => {
  it('자정이 지나면 읽기 전용 — 서랍·버튼 없이 안내만', async () => {
    const next = { promotionId: 'p9', issueDate: '2026-10-15', body: '다음 호 글', layout: LAYOUT };
    const { screen } = await open({
      window: { ...editorResponse().window, open: false },
      next: { ...next, appliedAt: 'x', editable: false },
    });
    expect(
      screen.getAllByText('자정이 지나 고칠 수 없어요. 아침 7시에 실려요').length,
    ).toBeGreaterThan(0);
    expect(screen.queryByTestId('sticker-drawer')).toBeNull();
    expect(screen.getByTestId('promotion-body').props.editable).toBe(false);
    expect(screen.getByTestId('promotion-submit').props.accessibilityState.disabled).toBe(true);
  });

  it('잔액이 모자라면 버튼이 꺼지고 안내', async () => {
    const { screen } = await open({ balance: 30 });
    expect(screen.getByTestId('promotion-submit').props.accessibilityState.disabled).toBe(true);
    expect(screen.getByText(/섬 통장 물고기가 모자라요/)).toBeTruthy();
  });

  it('비공개 섬이면 버튼이 꺼지고 안내', async () => {
    const { screen } = await open({ privateIsland: true });
    expect(screen.getByTestId('promotion-submit').props.accessibilityState.disabled).toBe(true);
    expect(screen.getByText(/비공개 섬은 잡지에 실을 수 없어요/)).toBeTruthy();
  });

  it('다시 읽는 동안에는 신청·새로 꾸미기 버튼이 꺼진다', async () => {
    const { screen } = await open();
    apply.mockRejectedValueOnce(new ApiError('INSUFFICIENT_FUNDS', '부족', 409));
    getEditor.mockReturnValueOnce(new Promise(() => {})); // 다시 읽기가 끝나지 않는다
    await fireEvent.press(screen.getByTestId('promotion-submit'));
    await waitFor(() => expect(getEditor).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('promotion-submit').props.accessibilityState.disabled).toBe(true);
  });

  it('자정 직전 신청 응답이 늦게 와도, 그 사이 다시 읽어 받은 마감(읽기 전용)을 덮지 않는다', async () => {
    jest.useFakeTimers({ now: Date.parse('2026-10-14T14:59:30Z') }); // KST 23:59:30
    try {
      let succeed: (v: unknown) => void = () => {};
      apply.mockReturnValueOnce(new Promise((resolve) => (succeed = resolve)));
      const next = {
        promotionId: 'p1',
        issueDate: '2026-10-15',
        body: '같이 공부해요!',
        layout: LAYOUT,
      };
      getEditor.mockResolvedValueOnce(editorResponse()).mockResolvedValueOnce(
        editorResponse({
          window: { ...editorResponse().window, open: false },
          next: { ...next, appliedAt: 'x', editable: false },
        }),
      );
      const driver: { current: EditorDriver | null } = { current: null };
      const screen = await render(<PromotionEditor e={env()} driver={driver} />);
      await waitFor(() => expect(screen.getByTestId('promotion-canvas')).toBeTruthy());
      // 신청을 보내고 응답은 기다리지 않는다(누르기 act 가 겹치지 않게 대본 손잡이로 보낸다)
      await act(async () => {
        void driver.current!.submit();
      });
      await act(async () => {
        jest.advanceTimersByTime(31_000); // 00:00:01 — 자정 다시 읽기가 먼저 끝난다
      });
      await waitFor(() => expect(screen.queryByTestId('sticker-drawer')).toBeNull());
      await act(async () => {
        succeed({
          promotionId: 'p1',
          issueDate: '2026-10-15',
          feeFish: 60,
          balanceAfter: 1180,
          newsId: 'n',
        });
      });
      // 늦은 성공 뒤에도 읽기 전용 그대로 — 서랍이 다시 열리거나 저장 버튼이 켜지지 않는다
      const hidden = { includeHiddenElements: true }; // 늦은 성공으로 접수 완료 확인창이 떠 있다
      expect(screen.queryByTestId('sticker-drawer', hidden)).toBeNull();
      expect(screen.getByTestId('promotion-submit', hidden).props.accessibilityState.disabled).toBe(
        true,
      );
      // 완료 안내도 이미 잠긴 오늘 07시 호로 — 「내일 · 자정까지 고칠 수 있어요」가 아니다
      expect(
        screen.getByText('오늘 07시 호에 실려요. 자정이 지나 더는 고칠 수 없어요'),
      ).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });

  it('응답 유실 뒤 자정을 넘겨 같은 키로 다시 보내 성공을 받으면, 오늘 07시 호 · 고칠 수 없음으로 안내한다', async () => {
    // 앱이 뒤에 있어 자정 다시 읽기가 돌지 않은 채(타이머는 그대로) 시계만 자정을 넘긴 경우
    jest.useFakeTimers({ now: Date.parse('2026-10-14T14:59:30Z') }); // KST 23:59:30
    try {
      getEditor.mockResolvedValueOnce(editorResponse());
      apply
        .mockRejectedValueOnce(new ApiError('NETWORK', '연결', 0, { retryable: true }))
        .mockResolvedValueOnce({
          promotionId: 'p1',
          issueDate: '2026-10-15',
          feeFish: 60,
          balanceAfter: 1180,
          newsId: 'n',
        });
      const driver: { current: EditorDriver | null } = { current: null };
      const screen = await render(<PromotionEditor e={env()} driver={driver} />);
      await waitFor(() => expect(screen.getByTestId('promotion-canvas')).toBeTruthy());
      await act(async () => {
        await driver.current!.submit();
      });
      jest.setSystemTime(Date.parse('2026-10-14T15:05:00Z')); // KST 00:05 — 타이머는 돌지 않았다
      await act(async () => {
        await driver.current!.submit();
      });
      expect(apply).toHaveBeenCalledTimes(2);
      expect(apply.mock.calls[1][2]).toBe(apply.mock.calls[0][2]);
      expect(
        screen.getByText('오늘 07시 호에 실려요. 자정이 지나 더는 고칠 수 없어요'),
      ).toBeTruthy();
      expect(screen.queryByText('내일 07시 호에 실려요. 자정까지 고칠 수 있어요')).toBeNull();
      // 화면도 읽기 전용 — 서랍이 없고 저장 버튼이 꺼져 있다
      const hidden = { includeHiddenElements: true };
      expect(screen.queryByTestId('sticker-drawer', hidden)).toBeNull();
      expect(screen.getByTestId('promotion-submit', hidden).props.accessibilityState.disabled).toBe(
        true,
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('스티커를 끄는 중에 자정 다시 읽기로 읽기 전용이 되면, 계속 움직이거나 손을 떼도 마감 전 배치가 덮이지 않는다', async () => {
    jest.useFakeTimers({ now: Date.parse('2026-10-14T14:59:00Z') }); // KST 23:59
    try {
      const next = {
        promotionId: 'p9',
        issueDate: '2026-10-15',
        body: '다음 호 글',
        layout: LAYOUT,
      };
      getEditor
        .mockResolvedValueOnce(
          editorResponse({ next: { ...next, appliedAt: 'x', editable: true } }),
        )
        .mockResolvedValueOnce(
          editorResponse({
            window: { ...editorResponse().window, open: false },
            next: { ...next, appliedAt: 'x', editable: false },
          }),
        );
      const screen = await render(<PromotionEditor e={env()} />);
      await waitFor(() => expect(screen.getByTestId('promotion-canvas')).toBeTruthy());
      const box = StyleSheet.flatten(screen.getByTestId('promotion-canvas').props.style);
      const cellW = box.width / (1 + 2 * CANVAS_PAD);
      const at = (x: number, y: number) => ({
        x: (CANVAS_PAD + x) * cellW,
        y: (CANVAS_PAD + y) * cellW * CELL_ASPECT,
      });
      const before = stickerStyles(screen).map(centerOf);
      const d = createTouchDriver(screen.getByTestId('promotion-canvas').props);
      await act(async () => {
        d.down(at(0.5, 0.5));
        d.move(at(0.4, 0.45));
      });
      await act(async () => {
        jest.advanceTimersByTime(61_000); // 00:00:01 — 손가락을 댄 채 자정 다시 읽기
      });
      await waitFor(() => expect(screen.queryByTestId('sticker-drawer')).toBeNull());
      await act(async () => {
        d.move(at(0.3, 0.35));
        d.up();
        jest.advanceTimersByTime(100); // 예약된 그리기가 있었다면 여기서 돈다
      });
      // 실릴 것은 서버에 남은 칸이다 — 자정 전에 끌던 자리로 돌아가지 않는다
      expect(stickerStyles(screen).map(centerOf)).toEqual(before);
    } finally {
      jest.useRealTimers();
    }
  });

  it('접수 뒤 열어 둔 채 다음 날 07시에 새 신청 창으로 다시 읽으면 지난 접수 발도장을 걷는다', async () => {
    jest.useFakeTimers({ now: Date.parse('2026-10-14T14:58:00Z') }); // KST 23:58
    try {
      const published = {
        promotionId: 'p1',
        issueDate: '2026-10-15',
        body: '같이 공부해요!',
        layout: LAYOUT,
      };
      getEditor
        .mockResolvedValueOnce(editorResponse())
        // 자정: 낸 칸이 잠긴다
        .mockResolvedValueOnce(
          editorResponse({
            window: { ...editorResponse().window, open: false },
            next: { ...published, appliedAt: 'x', editable: false },
          }),
        )
        // 07시: 낸 칸이 실려 지난 칸(latest)이 되고 다음 호(10/16) 창이 열린다
        .mockResolvedValueOnce(
          editorResponse({
            window: {
              open: true,
              issueDate: '2026-10-16',
              opensAt: '2026-10-14T22:00:00Z',
              closesAt: '2026-10-15T15:00:00Z',
            },
            next: null,
            latest: published,
            balance: 1180,
          }),
        );
      apply.mockResolvedValueOnce({
        promotionId: 'p1',
        issueDate: '2026-10-15',
        feeFish: 60,
        balanceAfter: 1180,
        newsId: 'n',
      });
      const driver: { current: EditorDriver | null } = { current: null };
      const screen = await render(<PromotionEditor e={env()} driver={driver} />);
      await waitFor(() => expect(screen.getByTestId('promotion-canvas')).toBeTruthy());
      await act(async () => {
        await driver.current!.submit();
      });
      const hidden = { includeHiddenElements: true };
      expect(screen.getByTestId('promotion-stamp', hidden)).toBeTruthy();
      await act(async () => driver.current!.closeDone());
      await act(async () => {
        jest.advanceTimersByTime(121_000); // 00:00:01 — 잠김(도장은 그대로: 낸 칸이다)
      });
      await waitFor(() => expect(getEditor).toHaveBeenCalledTimes(2));
      expect(screen.getByTestId('promotion-stamp', hidden)).toBeTruthy();
      await act(async () => {
        jest.advanceTimersByTime(7 * 3600_000); // 07:00:01 — 새 신청 창
      });
      await waitFor(() => expect(screen.getByText('잡지에 싣기 · 60 물고기')).toBeTruthy());
      expect(getEditor).toHaveBeenCalledTimes(3);
      expect(screen.queryByTestId('promotion-stamp', hidden)).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('열어 둔 채 자정(closesAt)이 지나면 다시 읽어 읽기 전용이 된다', async () => {
    jest.useFakeTimers({ now: Date.parse('2026-10-14T14:59:00Z') }); // KST 23:59
    try {
      const next = {
        promotionId: 'p9',
        issueDate: '2026-10-15',
        body: '다음 호 글',
        layout: LAYOUT,
      };
      getEditor.mockResolvedValueOnce(
        editorResponse({ next: { ...next, appliedAt: 'x', editable: true } }),
      );
      getEditor.mockResolvedValueOnce(
        editorResponse({
          window: { ...editorResponse().window, open: false },
          next: { ...next, appliedAt: 'x', editable: false },
        }),
      );
      const screen = await render(<PromotionEditor e={env()} />);
      await waitFor(() => expect(screen.getByText('고친 내용 저장')).toBeTruthy());
      // 고치다가 저장하지 않고 자정을 넘긴다
      await fireEvent.changeText(screen.getByTestId('promotion-body'), '저장 안 한 글');
      await act(async () => {
        jest.advanceTimersByTime(61_000); // 00:00:01
      });
      await waitFor(() => expect(screen.queryByTestId('sticker-drawer')).toBeNull());
      expect(getEditor).toHaveBeenCalledTimes(2);
      // 실릴 것은 서버에 남은 칸이다 — 저장 안 한 글은 보이지 않는다
      expect(screen.getByTestId('promotion-body').props.value).toBe('다음 호 글');
    } finally {
      jest.useRealTimers();
    }
  });

  it('00~07시에 열어 두면 버튼 자리에 「아침 7시에 다시 열려요」, 07시가 되면 다시 읽어 연다', async () => {
    jest.useFakeTimers({ now: Date.parse('2026-10-14T21:59:00Z') }); // KST 06:59
    try {
      const opensAt = '2026-10-14T22:00:00Z';
      getEditor.mockResolvedValueOnce(
        editorResponse({ window: { ...editorResponse().window, open: false, opensAt } }),
      );
      getEditor.mockResolvedValueOnce(editorResponse());
      const screen = await render(<PromotionEditor e={env()} />);
      await waitFor(() =>
        expect(screen.getAllByText('아침 7시에 다시 열려요').length).toBeGreaterThan(0),
      );
      expect(screen.getByTestId('promotion-submit').props.accessibilityState.disabled).toBe(true);
      await act(async () => {
        jest.advanceTimersByTime(61_000); // 07:00:01
      });
      await waitFor(() => expect(screen.getByText('잡지에 싣기 · 60 물고기')).toBeTruthy());
      expect(getEditor).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });
});
