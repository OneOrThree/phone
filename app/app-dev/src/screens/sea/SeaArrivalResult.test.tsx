import { applyLocalePref } from '@/i18n';
import React from 'react';
import { render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import type { CatalogEntry } from '@/services/customizationCatalog';
import { SeaArrivalResult } from './SeaArrivalResult';
import { GOWUN } from '@/screens/island/sceneKit';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@/services/customizationCatalog', () => ({
  useCustomizationCatalog: () => mockTable,
}));
let mockTable: Record<string, CatalogEntry> = {};
const mockAddUnseen = jest.fn(async (_recordId: string, _ids: readonly string[]) => {});
jest.mock('@/services/unseenOutfits', () => ({
  addUnseenOutfits: (recordId: string, ids: readonly string[]) => mockAddUnseen(recordId, ids),
}));
beforeEach(() => mockAddUnseen.mockClear());
// 집중 보상 목걸이(GROMO-2382) — 원본 1254² 중 앞 장식 영역만 잘라 보인다
const loaded: Record<string, CatalogEntry> = {
  'cust.neck.bell': {
    productId: 'cust.neck.bell',
    kind: 'neck',
    slot: 'neck',
    title: '버터 방울 목걸이',
    imageUrl: 'https://api.test/static/customization/neck/bell.c1750340.png',
    width: 512,
    height: 512,
    anchorX: 0.5,
    anchorY: 0.5,
    sortOrder: 10,
    retiredAt: null,
    catFit: {
      width: 1254,
      height: 1254,
      crop: [406, 406, 839, 913],
      colors: ['black'],
      motions: { walk: 6, focus: 4, reel: 4 },
      stills: [],
      rigUrls: { black: 'https://api.test/static/customization/rigs/neck.22a4cc24.json' },
      neck: {
        style: 'pendant',
        front: [406, 406, 839, 913],
        commonBand: {
          url: 'https://api.test/static/customization/neck/common-band.1acc2be4.png',
          box: [82, 392, 1693, 493],
        },
      },
    },
  },
};
const result = (rewards: string[], newRewards?: string[]) => ({
  recordId: 'r1',
  destinationId: 'i1',
  destinationName: '별고래섬',
  activeSeconds: 1800,
  rewards,
  minutesToNextTier: null,
  rewardsUnknown: false,
  ...(newRewards ? { newRewards } : {}),
});

test('집중 보상 아이템은 상품 id 대신 한국어 이름과 대표 영역만 자른 그림을 보인다', async () => {
  mockTable = loaded;
  const screen = await render(
    <SeaArrivalResult result={result(['cust.neck.bell'])} pending={false} onExplore={jest.fn()} />,
  );
  expect(screen.getByText('버터 방울 목걸이')).toBeTruthy();
  expect(screen.queryByText('cust.neck.bell')).toBeNull();
  // 앞 장식 433×507 을 120 상자에 맞춘다(높이 기준)
  const scale = 120 / 507;
  const art = screen.getByTestId('sea-reward-cust.neck.bell');
  expect(art.props.style[1]).toEqual({ width: 433 * scale, height: 507 * scale });
  expect((art.children[0] as unknown as { props: { style: unknown[] } }).props.style[1]).toEqual({
    width: 1254 * scale,
    height: 1254 * scale,
    left: -406 * scale,
    top: -406 * scale,
  });
});

test('카탈로그를 아직 못 읽었으면 상품 id 를 보이지 않고 보상 칸을 숨긴다', async () => {
  mockTable = {};
  const screen = await render(
    <SeaArrivalResult
      result={result(['cust.neck.bell', 'cust.head.mandarin'])}
      pending={false}
      onExplore={jest.fn()}
    />,
  );
  expect(screen.queryByText(/cust\./)).toBeNull();
  expect(screen.queryByText('낚은 아이템')).toBeNull();
  expect(screen.queryByText('이번 항해에서 건진 아이템은 없어요')).toBeNull();
  // 일부만 알면 아는 것만 — 모르는 id 는 「함께 받았어요」 목록에서도 빠진다
  mockTable = loaded;
  const partial = await render(
    <SeaArrivalResult
      result={result(['cust.head.mandarin', 'cust.neck.bell'])}
      pending={false}
      onExplore={jest.fn()}
    />,
  );
  expect(partial.getByText('버터 방울 목걸이')).toBeTruthy();
  expect(partial.queryByText(/cust\./)).toBeNull();
});

test('「낚은 아이템」 아래 보이고, 처음 받은 것만 NEW! — 필드가 없으면 배지 없음', async () => {
  mockTable = loaded;
  const props = { pending: false, onExplore: jest.fn() };
  const fresh = await render(
    <SeaArrivalResult result={result(['cust.neck.bell'], ['cust.neck.bell'])} {...props} />,
  );
  expect(fresh.getByText('낚은 아이템')).toBeTruthy();
  expect(fresh.getByText('NEW!')).toBeTruthy();
  expect(mockAddUnseen).toHaveBeenCalledWith('r1', ['cust.neck.bell']);
  mockAddUnseen.mockClear();
  const owned = await render(
    <SeaArrivalResult result={result(['cust.neck.bell'], [])} {...props} />,
  );
  expect(owned.queryByText('NEW!')).toBeNull();
  const old = await render(<SeaArrivalResult result={result(['cust.neck.bell'])} {...props} />);
  expect(old.queryByText('NEW!')).toBeNull();
  expect(mockAddUnseen).not.toHaveBeenCalled();
});

test('결과창 제목·시간·버튼 글자는 고운돋움이다(GROMO-2334)', async () => {
  mockTable = loaded;
  const screen = await render(
    <SeaArrivalResult result={result(['cust.neck.bell'])} pending={false} onExplore={jest.fn()} />,
  );
  for (const text of ['별고래섬', '30분 0초', '버터 방울 목걸이', '섬 둘러보기'])
    expect(StyleSheet.flatten(screen.getByText(text).props.style).fontFamily).toBe(GOWUN);
});

afterEach(() => applyLocalePref('system'));

test('영어 항해 결과의 대표·추가 보상은 같은 번역을 쓰고 목적지 이름은 유지한다', async () => {
  mockTable = {
    ...loaded,
    'cust.head.peach': {
      ...loaded['cust.neck.bell'],
      productId: 'cust.head.peach',
      title: '복숭아 한 알',
    },
  };
  applyLocalePref('en');
  const screen = await render(
    <SeaArrivalResult
      result={result(['cust.neck.bell', 'cust.head.peach'])}
      pending={false}
      onExplore={jest.fn()}
    />,
  );
  expect(screen.getByText('Butter Bell Necklace')).toBeTruthy();
  expect(screen.getByText(/Peach/)).toBeTruthy();
  expect(screen.getByText('별고래섬')).toBeTruthy();
  expect(screen.queryByText('버터 방울 목걸이')).toBeNull();
});
