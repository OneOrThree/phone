// 우리 섬 홍보 쓰기(GROMO-2289 · C1·C2) — 지난 칸으로 열기 · 새로 꾸미기 · 5개 제한 · 신청(멱등 키·본문) · 오류 코드별 안내 ·
// 게스트 → 회원 전환 · 접수 완료 발도장 · 고치기 · 자정 뒤 읽기 전용 · 07시 다시 열림 · 잔액 부족 · 섬장 아님 ·
// 칸 위 손가락(끌기 · 두 손가락 크기·회전 · 손잡이 · 빈 곳 톡 · 테이프 붙이기) · 스크린리더 동작.
// 서버 API(magazine.ts)는 목이다. 손가락은 touchDriver 로 판의 PanResponder 에 진짜 터치 모양 이벤트를 넣는다.
import React from 'react';
import { BackHandler, StyleSheet } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { applyLocalePref } from '@/i18n';
import { ApiError } from '@/services/api/client';
import * as api from '@/services/api/magazine';
import type { PromotionEditor as EditorResponse } from '@/services/api/magazine';
import { initialState, reducer } from '@/services/model';
import { saveSession } from '@/services/api/session';
import { CELL_ASPECT, PromotionLayout } from './layout';
import { EditorDriver, EditorStep, PromotionEditor } from './PromotionEditor';
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
// 회관 「섬 관리」가 확정한 관리 API 역할(없으면 null → 홈 스냅샷)
let mockLiveRole: 'host' | 'member' | null = null;
jest.mock('@/screens/interiors/useIslandManagement', () => ({
  ...jest.requireActual('@/screens/interiors/useIslandManagement'),
  managedIslandRole: () => mockLiveRole,
}));
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

// 이미 낸 다음 호 홍보(고치는 중) — 스티커 두 장(큰 고양이 · 작은 하트)이 있는 칸으로 바로 스티커 단계에서 연다
const EXISTING: Partial<EditorResponse> = {
  next: {
    promotionId: 'p9',
    issueDate: '2026-10-15',
    body: '같이 공부해요!',
    layout: LAYOUT,
    appliedAt: 'x',
    editable: true,
  },
};

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
  mockLiveRole = null;
  // 한 번만 쓰는 응답(…Once)이 실패한 테스트에서 남아 다음 테스트로 새지 않게 서버 목은 통째로 비운다
  for (const m of [getEditor, getAssets, apply, update]) m.mockReset();
  getAssets.mockRejectedValue(new Error('offline')); // 재료 목록을 못 읽어도 쓰기는 된다
});

/**
 * 불러오기를 기다린 뒤 그 단계로 간다(종이 → 글 → 스티커, 10/15). 새로 쓰면 빈 종이에서 시작하므로 종이를 고르고(기본 가리비),
 * 스티커 단계로 가려면 글이 있어야 해 빈 글이면 한 줄 쓴다. 이미 낸 홍보·읽기 전용은 처음부터 칸 전체(스티커 단계)다.
 */
async function ready(screen: any, step: EditorStep = 'stickers', frame = 'mag.frame-scallop') {
  await waitFor(() =>
    expect(
      screen.queryByTestId('promotion-edit-ok') ??
        screen.queryByTestId('promotion-canvas') ??
        screen.queryByTestId('promotion-frames'),
    ).toBeTruthy(),
  );
  // 이미 올린 홍보면 「올린 홍보글을 수정하시겠습니까?」 — [수정]으로 들어간다
  const ask = screen.queryByTestId('promotion-edit-ok');
  if (ask) await fireEvent.press(ask);
  if (step === 'frame') return;
  if (screen.queryByTestId('promotion-frames'))
    await fireEvent.press(screen.getByTestId(`frame-${frame}`));
  else if (step === 'text' && screen.queryByTestId('promotion-canvas')) {
    await fireEvent.press(screen.getByTestId('promotion-back'));
    return;
  }
  if (step === 'text' || screen.queryByTestId('promotion-canvas')) return;
  if (!screen.getByTestId('promotion-body').props.value)
    await fireEvent.changeText(screen.getByTestId('promotion-body'), '우리 섬에 놀러 와요');
  await fireEvent.press(screen.getByTestId('promotion-next'));
}
/** [잡지에 싣기] → 가격 확인창이 뜨면 [싣기]까지(고친 내용 저장은 확인창 없이 바로) */
async function submit(screen: any) {
  await fireEvent.press(screen.getByTestId('promotion-submit'));
  const ok = screen.queryByTestId('promotion-confirm-ok');
  if (ok) await fireEvent.press(ok);
}
/** 스티커 단계에서 뒤로 한 번 — 글 단계 입력 칸의 글을 읽는다 */
async function bodyOf(screen: any) {
  if (screen.queryByTestId('promotion-canvas'))
    await fireEvent.press(screen.getByTestId('promotion-back'));
  return screen.getByTestId('promotion-body').props.value;
}

async function open(over: Partial<EditorResponse> = {}, e = env(), step: EditorStep = 'stickers') {
  getEditor.mockResolvedValue(editorResponse(over));
  const screen = await render(<PromotionEditor e={e} />);
  await ready(screen, step);
  return { screen, e };
}

describe('여닫기', () => {
  it('새로 쓰면 빈 종이 고르기부터 — 지난번 글·스티커를 채워 두지 않고, 종이 아래 [완료] 하나', async () => {
    const { screen } = await open({}, env(), 'frame');
    expect(getEditor).toHaveBeenCalledWith('soda');
    expect(screen.getByText('종이를 골라주세요.')).toBeTruthy();
    // 아무 종이도 골라 두지 않는다
    expect(
      screen.getAllByTestId(/^frame-mag\./).some((n: any) => n.props.accessibilityState.selected),
    ).toBe(false);
    await fireEvent.press(screen.getByTestId('frame-mag.frame-ticket'));
    expect(screen.getByTestId('promotion-body').props.value).toBe('');
    await fireEvent.changeText(screen.getByTestId('promotion-body'), '같이 공부해요!');
    await fireEvent.press(screen.getByTestId('promotion-next'));
    expect(stickerStyles(screen)).toHaveLength(0);
    await fireEvent.press(screen.getByTestId('drawer-mag.cat-black-book'));
    expect(stickerStyles(screen)).toHaveLength(1);
    // [새로 꾸미기]는 없다 — 종이 아래 [완료] 하나
    expect(screen.queryByTestId('promotion-fresh')).toBeNull();
    expect(screen.getByTestId('promotion-submit')).toBeTruthy();
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
    await ready(screen);
    expect(getEditor).toHaveBeenCalledTimes(2);
  });

  it('재료 목록이 늦어도 편집기 응답만으로 먼저 열린다', async () => {
    getAssets.mockReturnValueOnce(new Promise(() => {}));
    await open();
  });

  it('실서버 — 다른 기기에서 섬장을 위임받아 홈 스냅샷이 아직 주민이어도, 회관이 확정한 역할(host)로 쓰기 화면이 열린다', async () => {
    const ISLAND = 'server-island';
    const state = reducer(
      reducer(initialState(true), {
        type: 'ISLAND_SYNC',
        memberships: {
          items: [{ id: ISLAND, name: '소다 섬' }],
          currentIslandId: ISLAND,
          nextCursor: null,
          lossReason: null,
        },
      } as any),
      {
        type: 'SERVER_HOME',
        facts: {
          islandId: ISLAND,
          completedBuildings: ['hall', 'mail'],
          home: {
            island: { id: ISLAND, name: '소다 섬', memberCount: 2, maxMembers: 15, role: 'member' },
            wallets: { villagePoints: 0 },
          },
        },
      } as any,
    );
    // 회관 확정 역할이 없으면 홈 스냅샷(주민)대로 안내만 — 서버를 부르지 않는다
    const stale = await render(<PromotionEditor e={env({ state, islands: {} })} />);
    expect(stale.getByText('섬장만 홍보를 쓸 수 있어요')).toBeTruthy();
    expect(getEditor).not.toHaveBeenCalled();
    await stale.unmount();
    // 회관 「섬 관리」가 관리 API 로 host 를 확정했다 — 입구와 같은 근거로 섬장이다
    mockLiveRole = 'host';
    getEditor.mockResolvedValue(editorResponse());
    const screen = await render(<PromotionEditor e={env({ state, islands: {} })} />);
    await ready(screen);
    expect(getEditor).toHaveBeenCalledWith(ISLAND);
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
      expect(StyleSheet.flatten(screen.getByLabelText(tab).props.style).minHeight).toBe(44);
  });

  it('종이 아래 [완료]는 문구가 감기면 높이가 는다(고정 52 가 아니라 최소 52)', async () => {
    const { screen } = await open(EXISTING);
    expect(
      StyleSheet.flatten(screen.getByTestId('promotion-submit').props.style).height,
    ).toBeUndefined();
  });

  it('다시 읽어 서버 칸으로 바뀌면 고르기가 풀린다 — 없는 스티커 번호로 그리지 않는다', async () => {
    // 고치지 않은 채(이미 낸 칸) 저장하다 서버 칸이 바뀐 것을 알게 된다
    const { screen } = await open(EXISTING);
    await fireEvent(screen.getByTestId('canvas-sticker-1'), 'accessibilityAction', {
      nativeEvent: { actionName: 'activate' },
    });
    expect(screen.getByTestId('promotion-delete')).toBeTruthy();
    // 다른 기기에서 그 홍보를 고쳤다 — 다시 읽으면 스티커 1장짜리 서버 칸이 온다
    update.mockRejectedValueOnce(new ApiError('PROMOTION_NOT_FOUND', '없음', 404));
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
    await submit(screen);
    await waitFor(() => expect(screen.getByText('다른 기기 글')).toBeTruthy());
    expect(stickerStyles(screen)).toHaveLength(1);
    expect(screen.queryByTestId('promotion-delete')).toBeNull();
  });
});

describe('스티커·테이프·틀·글', () => {
  it('서랍에서 붙이면 가운데에 붙고 6번째는 안내만 뜬다', async () => {
    const { screen, e } = await open({ latest: null });
    for (let i = 0; i < 5; i++)
      await fireEvent.press(screen.getByTestId('drawer-mag.cat-black-book'));
    expect(stickerStyles(screen)).toHaveLength(5);
    expect(e.notify).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('drawer-mag.cat-black-book'));
    expect(stickerStyles(screen)).toHaveLength(5);
    expect(e.notify).toHaveBeenCalledWith('스티커는 5개까지 붙일 수 있어요');
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

  it('테이프에는 크기·맨 앞으로가 없다 — 스크린리더 동작은 실제로 되는 것만, 지우기는 ✕', async () => {
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
    // 고른 테이프도 점선 상자 왼쪽 위 ✕로 지운다
    await fireEvent.press(screen.getByTestId('promotion-delete'));
    expect(screen.queryByTestId('canvas-tape')).toBeNull();
  });

  it('틀을 고르면 칸 틀이 바뀌고, 글은 코드포인트 60자에서 자르고 줄바꿈은 띄어쓰기로', async () => {
    const { screen } = await open({}, env(), 'frame');
    await fireEvent.press(screen.getByTestId('frame-mag.frame-ticket'));
    // 종이를 고르면 바로 글 단계 — 칸 안 글 자리에 커서가 선다
    expect(screen.getByTestId('promotion-body').props.autoFocus).toBe(true);
    await fireEvent.press(screen.getByTestId('promotion-back'));
    expect(screen.getByTestId('frame-mag.frame-ticket').props.accessibilityState.selected).toBe(
      true,
    );
    await fireEvent.press(screen.getByTestId('frame-mag.frame-ticket'));
    await fireEvent.changeText(screen.getByTestId('promotion-body'), `🐟${'가'.repeat(70)}`);
    expect(Array.from(screen.getByTestId('promotion-body').props.value)).toHaveLength(60);
    await fireEvent.changeText(screen.getByTestId('promotion-body'), '첫 줄\n둘째 줄');
    expect(screen.getByTestId('promotion-body').props.value).toBe('첫 줄 둘째 줄');
    // 서버가 거절하는 제어 문자(탭 등)와 U+2028·U+2029 도 띄어쓰기로
    await fireEvent.changeText(screen.getByTestId('promotion-body'), '탭\t글\u2028끝\u0085!');
    expect(screen.getByTestId('promotion-body').props.value).toBe('탭 글 끝 !');
  });

  it('스티커를 누르면 맨 앞으로 오고, 버튼 줄 없이 점선 상자 왼쪽 위 ✕로 지운다', async () => {
    const { screen } = await open(EXISTING);
    const driver = createTouchDriver(screen.getByTestId('promotion-canvas').props);
    const cellW =
      StyleSheet.flatten(screen.getByTestId('promotion-canvas').props.style).width /
      (1 + 2 * CANVAS_PAD);
    const at = (x: number, y: number) => ({
      x: (CANVAS_PAD + x) * cellW,
      y: (CANVAS_PAD + y) * cellW * CELL_ASPECT,
    });
    // 큰 고양이(0번)를 누르면 배열 끝(맨 위에 그려짐)으로 간다
    const picked = stickerStyles(screen)[0].width;
    await act(async () => {
      driver.down(at(0.5, 0.5));
      driver.up();
    });
    expect(stickerStyles(screen)[1].width).toBe(picked);
    expect(stickerStyles(screen)[0].width).toBeLessThan(picked);
    expect(screen.queryAllByTestId(/^op-/)).toEqual([]);
    expect(screen.getByTestId('promotion-delete').props.accessibilityLabel).toMatch(/^지우기: /);
    await fireEvent.press(screen.getByTestId('promotion-delete'));
    expect(stickerStyles(screen)).toHaveLength(1);
    expect(screen.queryByTestId('promotion-delete')).toBeNull();
  });
});

describe('칸 위 손가락', () => {
  async function canvas() {
    const opened = await open(EXISTING);
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
    const after = centerOf(stickerStyles(screen).at(-1)); // 누른 스티커는 맨 앞(배열 끝)으로
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
    const after = stickerStyles(screen).at(-1); // 누른 스티커는 맨 앞(배열 끝)으로
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
    const before = stickerStyles(screen).at(-1).width; // 누른 스티커는 맨 앞(배열 끝)으로 갔다
    await act(async () => driver().drag(start, { x: start.x + 40, y: start.y + 30 }));
    expect(stickerStyles(screen).at(-1).width).toBeGreaterThan(before);
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

  it('스크린리더 동작으로도 고른다·크게·옮긴다·지운다', async () => {
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
    // 옮기기는 버튼 줄에 없다 — 스크린리더는 동작으로 옮긴다
    const left = stickerStyles(screen)[0].left;
    await fireEvent(screen.getByTestId('canvas-sticker-0'), 'accessibilityAction', {
      nativeEvent: { actionName: 'right' },
    });
    expect(stickerStyles(screen)[0].left).toBeGreaterThan(left);
    await fireEvent(screen.getByTestId('canvas-sticker-0'), 'accessibilityAction', {
      nativeEvent: { actionName: 'delete' },
    });
    expect(stickerStyles(screen)).toHaveLength(1);
  });
});

describe('싣기·고치기', () => {
  it('신청은 멱등 키와 {body, layout} 를 보내고, 같은 글 다시 시도는 같은 키다', async () => {
    // 10/15 호 마감 전(KST 10/14 14:00)에 받은 성공 — 실제 시계면 그 호가 나온 뒤 「이미 나옴」이 되어 발도장이 없다
    const now = jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-14T05:00:00Z'));
    try {
      const { screen, e } = await open();
      apply.mockRejectedValueOnce(new ApiError('NETWORK', '연결', 0, { retryable: true }));
      await submit(screen);
      apply.mockResolvedValueOnce({
        promotionId: 'p1',
        issueDate: '2026-10-15',
        feeFish: 60,
        balanceAfter: 1180,
        newsId: 'n1',
      });
      await submit(screen);
      expect(apply).toHaveBeenCalledTimes(2);
      const [islandId, draft, key] = apply.mock.calls[0];
      expect(islandId).toBe('soda');
      expect(draft).toEqual({
        body: '우리 섬에 놀러 와요',
        layout: { v: 1, frameId: 'mag.frame-scallop', stickers: [], tape: null },
      });
      expect(apply.mock.calls[1][2]).toBe(key);
      // 실리면 토스트 한 줄과 함께 회관으로 돌아간다(접수 확인창·발도장 없음)
      expect(screen.queryByTestId('promotion-stamp')).toBeNull();
      expect(e.notify).toHaveBeenCalledWith('잡지에 신청했어요');
      expect(e.back).toHaveBeenCalledTimes(1);
    } finally {
      now.mockRestore();
    }
  });

  it('[완료]는 값을 버튼에 적지 않고, 누르면 가격 확인창 — 취소하면 보내지 않는다', async () => {
    const { screen } = await open();
    expect(screen.getByText('완료')).toBeTruthy();
    // 평소에는 잔액·안내 줄이 없다
    expect(screen.queryByText(/섬 통장 1,240마리/)).toBeNull();
    await fireEvent.press(screen.getByTestId('promotion-submit'));
    expect(screen.getByTestId('promotion-confirm-price').props.accessibilityLabel).toBe(
      '물고기 60마리',
    );
    expect(screen.getByText('60')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('promotion-confirm-cancel'));
    expect(screen.queryByTestId('promotion-confirm-price')).toBeNull();
    expect(apply).not.toHaveBeenCalled();
  });

  it('빈 글이면 스티커 단계로 넘어가지 않고 글 칸 아래에 안내한다', async () => {
    const { screen } = await open({ latest: null }, env(), 'text');
    expect(screen.getByTestId('promotion-next').props.accessibilityState.disabled).toBe(true);
    await fireEvent(screen.getByTestId('promotion-body'), 'submitEditing');
    expect(screen.getByText('한 줄 글을 적어 주세요')).toBeTruthy();
    expect(screen.queryByTestId('promotion-canvas')).toBeNull();
    expect(apply).not.toHaveBeenCalled();
  });

  it('틀 → 글 → 스티커 순서이고, 뒤로가기는 한 단계씩 돌아가 틀 단계에서 회관으로 나간다', async () => {
    const { screen, e } = await open({ latest: null }, env(), 'frame');
    expect(screen.getByText('종이를 골라주세요.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('frame-mag.frame-cloud'));
    await fireEvent.changeText(screen.getByTestId('promotion-body'), '같이 집중해요');
    await fireEvent.press(screen.getByTestId('promotion-next'));
    expect(screen.getByTestId('sticker-drawer')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('promotion-back'));
    expect(screen.getByTestId('promotion-body').props.value).toBe('같이 집중해요');
    await fireEvent.press(screen.getByTestId('promotion-back'));
    expect(screen.getByTestId('frame-mag.frame-cloud').props.accessibilityState.selected).toBe(
      true,
    );
    expect(e.back).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('promotion-back'));
    expect(e.back).toHaveBeenCalled();
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
    await submit(screen);
    expect(e.notify).toHaveBeenCalledWith(message);
    await waitFor(() => expect(getEditor).toHaveBeenCalledTimes(reload ? 2 : 1));
  });

  it('금칙어는 글 칸 아래 빨간 안내', async () => {
    const { screen, e } = await open();
    apply.mockRejectedValueOnce(new ApiError('BANNED_WORD', '쓸 수 없는 말이 있어요', 400));
    await submit(screen);
    // 글 단계로 돌아가 칸 아래에 안내한다
    expect(screen.getByText('쓸 수 없는 말이 있어요')).toBeTruthy();
    expect(screen.getByTestId('promotion-body')).toBeTruthy();
    expect(e.notify).not.toHaveBeenCalled();
  });

  it('이미 낸 다음 호 홍보가 있으면 [완료] → 확인창 없이 PUT', async () => {
    const next = { promotionId: 'p9', issueDate: '2026-10-15', body: '다음 호 글', layout: LAYOUT };
    const { screen, e } = await open({ next: { ...next, appliedAt: 'x', editable: true } });
    // 이미 낸 홍보는 틀·글이 정해져 있어 바로 칸 전체(스티커) 단계로 연다
    expect(screen.getByTestId('sticker-drawer')).toBeTruthy();
    expect(screen.getByText('다음 호 글')).toBeTruthy();
    update.mockResolvedValueOnce({ ...next, updatedAt: 'y' });
    await fireEvent.press(screen.getByText('완료'));
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
    expect(screen.queryByTestId('promotion-body')).toBeNull();
    expect(screen.queryByTestId('promotion-frames')).toBeNull();
    expect(screen.getByText('다음 호 글')).toBeTruthy();
    expect(screen.queryByTestId('promotion-submit')).toBeNull();
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

  it('다시 읽는 동안에는 [완료]가 꺼진다', async () => {
    const { screen } = await open();
    apply.mockRejectedValueOnce(new ApiError('INSUFFICIENT_FUNDS', '부족', 409));
    getEditor.mockReturnValueOnce(new Promise(() => {})); // 다시 읽기가 끝나지 않는다
    await submit(screen);
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
      const e = env();
      const screen = await render(<PromotionEditor e={e} driver={driver} />);
      await ready(screen);
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
      // 늦은 성공 — 이미 잠긴 칸이라도 실린 것은 맞다: 토스트 한 줄과 함께 회관으로
      expect(screen.queryByTestId('sticker-drawer')).toBeNull();
      expect(e.notify).toHaveBeenCalledWith('잡지에 신청했어요');
      expect(e.back).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('응답 유실 뒤 자정을 넘겨 같은 키로 다시 보내 성공을 받으면 신청된 것으로 알리고 회관으로', async () => {
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
      const e = env();
      const screen = await render(<PromotionEditor e={e} driver={driver} />);
      await ready(screen);
      await act(async () => {
        await driver.current!.submit();
      });
      jest.setSystemTime(Date.parse('2026-10-14T15:05:00Z')); // KST 00:05 — 타이머는 돌지 않았다
      await act(async () => {
        await driver.current!.submit();
      });
      expect(apply).toHaveBeenCalledTimes(2);
      expect(apply.mock.calls[1][2]).toBe(apply.mock.calls[0][2]);
      expect(e.notify).toHaveBeenCalledWith('잡지에 신청했어요');
      expect(e.back).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('23:59 에 보낸 신청의 응답이 다시 읽기 없이 00:05 에 와도 신청된 것으로 알리고 회관으로', async () => {
    jest.useFakeTimers({ now: Date.parse('2026-10-14T14:59:00Z') }); // KST 23:59
    try {
      let succeed: (v: unknown) => void = () => {};
      apply.mockReturnValueOnce(new Promise((resolve) => (succeed = resolve)));
      getEditor.mockResolvedValueOnce(editorResponse());
      const driver: { current: EditorDriver | null } = { current: null };
      const e = env();
      const screen = await render(<PromotionEditor e={e} driver={driver} />);
      await ready(screen);
      await act(async () => {
        void driver.current!.submit();
      });
      jest.setSystemTime(Date.parse('2026-10-14T15:05:00Z')); // KST 00:05 — 자정 다시 읽기는 아직 돌지 않았다
      await act(async () => {
        succeed({
          promotionId: 'p1',
          issueDate: '2026-10-15',
          feeFish: 60,
          balanceAfter: 1180,
          newsId: 'n',
        });
      });
      expect(e.notify).toHaveBeenCalledWith('잡지에 신청했어요');
      expect(e.back).toHaveBeenCalledTimes(1);
      expect(getEditor).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('06:59 에 다시 보낸 지난 호 신청의 성공이 07시 다시 읽기 뒤(07:05)에 와도 신청된 것으로 알리고 회관으로', async () => {
    jest.useFakeTimers({ now: Date.parse('2026-10-14T14:59:30Z') }); // KST 23:59:30
    try {
      const published = {
        promotionId: 'p1',
        issueDate: '2026-10-15',
        body: '같이 공부해요!',
        layout: LAYOUT,
      };
      const morning = editorResponse({
        window: {
          open: true,
          issueDate: '2026-10-16',
          opensAt: '2026-10-14T22:00:00Z',
          closesAt: '2026-10-15T15:00:00Z',
        },
        next: null,
        latest: published,
        balance: 1180,
      });
      getEditor
        .mockResolvedValueOnce(editorResponse())
        .mockResolvedValueOnce(morning) // 07시 다시 읽기: 낸 칸이 실렸고 10/16 창이 열렸다
        .mockResolvedValueOnce(morning); // 늦은 성공 뒤 다시 읽기
      let succeed: (v: unknown) => void = () => {};
      apply
        .mockRejectedValueOnce(new ApiError('NETWORK', '연결', 0, { retryable: true }))
        .mockReturnValueOnce(new Promise((resolve) => (succeed = resolve)));
      const driver: { current: EditorDriver | null } = { current: null };
      const e = env();
      const screen = await render(<PromotionEditor e={e} driver={driver} />);
      await ready(screen);
      await act(async () => {
        await driver.current!.submit(); // 23:59:30 — 응답 유실
      });
      jest.setSystemTime(Date.parse('2026-10-14T21:59:00Z')); // KST 06:59 — 앱이 밤새 뒤에 있었다
      await act(async () => {
        void driver.current!.submit(); // 같은 키로 다시 보낸다
      });
      expect(apply.mock.calls[1][2]).toBe(apply.mock.calls[0][2]);
      jest.setSystemTime(Date.parse('2026-10-14T22:05:00Z')); // KST 07:05
      await act(async () => {
        jest.advanceTimersByTime(31_000); // 밀린 다시 읽기가 먼저 돈다 → 10/16 새 신청 창
      });
      await waitFor(() => expect(getEditor).toHaveBeenCalledTimes(2));
      await act(async () => {
        succeed({
          promotionId: 'p1',
          issueDate: '2026-10-15',
          feeFish: 60,
          balanceAfter: 1180,
          newsId: 'n',
        });
      });
      expect(e.notify).toHaveBeenCalledWith('잡지에 신청했어요');
      expect(e.back).toHaveBeenCalledTimes(1);
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
      await ready(screen);
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
      await ready(screen); // 「올린 홍보글을 수정하시겠습니까?」 → [수정]
      // 고치다가 저장하지 않고 자정을 넘긴다
      await fireEvent.press(screen.getByTestId('promotion-back'));
      await fireEvent.changeText(screen.getByTestId('promotion-body'), '저장 안 한 글');
      await act(async () => {
        jest.advanceTimersByTime(61_000); // 00:00:01
      });
      await waitFor(() => expect(screen.queryByTestId('sticker-drawer')).toBeNull());
      expect(getEditor).toHaveBeenCalledTimes(2);
      // 실릴 것은 서버에 남은 칸이다 — 읽기 전용 칸 전체로 돌아가고 저장 안 한 글은 보이지 않는다
      expect(screen.getByText('다음 호 글')).toBeTruthy();
      expect(screen.queryByText('저장 안 한 글')).toBeNull();
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
      await ready(screen);
      await waitFor(() =>
        expect(screen.getAllByText('아침 7시에 다시 열려요').length).toBeGreaterThan(0),
      );
      expect(screen.getByTestId('promotion-submit').props.accessibilityState.disabled).toBe(true);
      await act(async () => {
        jest.advanceTimersByTime(61_000); // 07:00:01
      });
      await waitFor(() => expect(screen.getByText('완료')).toBeTruthy());
      expect(getEditor).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('en 로케일', () => {
  const mockLocales = jest.requireMock('expo-localization').getLocales as jest.Mock;
  afterEach(() => {
    mockLocales.mockReturnValue([{ languageCode: 'ko', languageTag: 'ko-KR' }]);
    applyLocalePref('system');
  });
  // 섬 이름은 사용자 데이터 — 영문 이름의 섬으로 본다
  const enEnv = () => {
    const state = initialState(true);
    state.islands.forEach((island, i) => (island.name = `Isle${i}`));
    return env({ state });
  };
  const noHangul = (screen: any) => {
    expect(screen.queryByText(/[가-힣]/)).toBeNull();
    expect(screen.queryByLabelText(/[가-힣]/)).toBeNull();
    expect(screen.queryByPlaceholderText(/[가-힣]/)).toBeNull();
  };

  test('en — 종이 고르기 → 글 → 스티커 → 싣기 확인창까지 한글이 없다', async () => {
    mockLocales.mockReturnValue([{ languageCode: 'en', languageTag: 'en-US' }]);
    applyLocalePref('system');
    const { screen } = await open({}, enEnv(), 'frame');
    expect(screen.getByText('Pick a paper.')).toBeTruthy();
    noHangul(screen);
    await fireEvent.press(screen.getByTestId('frame-mag.frame-ticket'));
    noHangul(screen);
    await fireEvent.changeText(screen.getByTestId('promotion-body'), 'Come focus with us');
    await fireEvent.press(screen.getByTestId('promotion-next'));
    await fireEvent.press(screen.getByTestId('drawer-mag.cat-black-book'));
    noHangul(screen);
    await fireEvent.press(screen.getByTestId('promotion-submit'));
    expect(screen.getByText('Put it in the magazine as is?')).toBeTruthy();
    noHangul(screen);
  });

  test('en — 올린 홍보 고치기 확인창에도 한글이 없다', async () => {
    mockLocales.mockReturnValue([{ languageCode: 'en', languageTag: 'en-US' }]);
    applyLocalePref('system');
    getEditor.mockResolvedValue(
      editorResponse({
        next: { ...EXISTING.next!, body: 'Come focus with us' },
      }),
    );
    const screen = await render(<PromotionEditor e={enEnv()} />);
    await waitFor(() => expect(screen.getByText('Edit your posted promotion?')).toBeTruthy());
    noHangul(screen);
  });
});

describe('안드로이드 하드웨어 뒤로가기', () => {
  // 나중에 단 리스너가 먼저 받는다 — 화면이 단 마지막 리스너를 부른다
  const pressBack = async () => {
    const add = BackHandler.addEventListener as jest.Mock;
    const handler = add.mock.calls.at(-1)?.[1] as () => boolean;
    let handled = false;
    await act(async () => {
      handled = handler();
    });
    return handled;
  };
  beforeEach(() => jest.spyOn(BackHandler, 'addEventListener'));

  it('싣기 확인창이 떠 있으면 단계를 바꾸지 않고 확인창부터 닫는다', async () => {
    const { screen } = await open();
    await fireEvent.press(screen.getByTestId('promotion-submit'));
    expect(screen.getByTestId('promotion-confirm-price')).toBeTruthy();
    expect(await pressBack()).toBe(true);
    expect(screen.queryByTestId('promotion-confirm-price')).toBeNull();
    expect(screen.getByTestId('sticker-drawer')).toBeTruthy();
  });

  it('고치기 확인창이 떠 있으면 단계를 바꾸지 않고 회관으로', async () => {
    getEditor.mockResolvedValue(editorResponse(EXISTING));
    const e = env();
    const screen = await render(<PromotionEditor e={e} />);
    await waitFor(() => expect(screen.getByText('올린 홍보글을 수정하시겠습니까?')).toBeTruthy());
    expect(await pressBack()).toBe(true);
    expect(e.back).toHaveBeenCalledTimes(1);
  });
});
