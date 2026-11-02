import { applyLocalePref } from '@/i18n';
import React from 'react';
import { render } from '@testing-library/react-native';
import type { CatalogEntry } from '@/services/customizationCatalog';
import { FocusResultSummary } from './FocusResultSummary';

jest.mock('@/services/customizationCatalog', () => ({
  useCustomizationCatalog: () => mockTable,
}));
const mockAddUnseen = jest.fn(async (_recordId: string, _ids: readonly string[]) => {});
jest.mock('@/services/unseenOutfits', () => ({
  addUnseenOutfits: (recordId: string, ids: readonly string[]) => mockAddUnseen(recordId, ids),
}));
beforeEach(() => mockAddUnseen.mockClear());
const mockTable: Record<string, CatalogEntry> = {
  'cust.head.mandarin': {
    productId: 'cust.head.mandarin',
    kind: 'head',
    slot: 'head',
    title: '귤 한 알',
    imageUrl: 'https://api.test/static/customization/head/mandarin.cfb06049.png',
    width: 512,
    height: 512,
    anchorX: 0.5,
    anchorY: 0.5,
    sortOrder: 0,
    retiredAt: null,
    catFit: {
      width: 1254,
      height: 1254,
      crop: [329, 349, 940, 942],
      colors: ['black'],
      motions: { walk: 6, focus: 4, reel: 4 },
      stills: [],
      rigUrls: { black: 'https://api.test/static/customization/rigs/head.0093c1a9.json' },
      head: {
        drawWidth: 64,
        depthY: 9,
        contacts: {},
        shadow: { widthFactor: 0.22, height: 2.5 },
      },
    },
  },
};
const summary = (rewardId?: string, rewardNew?: boolean) => (
  <FocusResultSummary
    subject="수학"
    seconds={1800}
    fish={3}
    questTitles={[]}
    recordId="rec-1"
    rewardId={rewardId}
    rewardNew={rewardNew}
  />
);

test('낚시섬 집중에서 받은 꾸미기 아이템을 「낚은 아이템」 아래 그림·이름으로 보인다', async () => {
  const screen = await render(summary('cust.head.mandarin'));
  expect(screen.getByTestId('focus-result-item').props.accessibilityLabel).toBe(
    '낚은 아이템 귤 한 알',
  );
  expect(screen.getByText('낚은 아이템')).toBeTruthy();
  expect(screen.getByText('귤 한 알')).toBeTruthy();
  // 이미 가진 것(NEW 아님)·구버전 서버(필드 없음)는 배지가 없고 옷장 목록에도 넣지 않는다
  expect(screen.queryByText('NEW!')).toBeNull();
  expect(mockAddUnseen).not.toHaveBeenCalled();
});

test('처음 받은 것이면 NEW! 배지를 붙이고 옷장의 안 본 새 꾸미기에 넣는다', async () => {
  const screen = await render(summary('cust.head.mandarin', true));
  expect(screen.getByText('NEW!')).toBeTruthy();
  expect(screen.getByTestId('focus-result-item').props.accessibilityLabel).toBe(
    '낚은 아이템 귤 한 알 NEW!',
  );
  expect(mockAddUnseen).toHaveBeenCalledWith('rec-1', ['cust.head.mandarin']);
});

test('받은 아이템이 없거나 카탈로그가 모르면 보상 칸이 없다', async () => {
  expect((await render(summary())).queryByTestId('focus-result-item')).toBeNull();
  expect(
    (await render(summary('cust.head.unknown'))).queryByTestId('focus-result-item'),
  ).toBeNull();
});

afterEach(() => applyLocalePref('system'));

test('영어 결과창은 꾸미기 이름과 스크린리더 설명을 함께 번역한다', async () => {
  applyLocalePref('en');
  const screen = await render(summary('cust.head.mandarin', true));
  expect(screen.getByText('Mandarin')).toBeTruthy();
  expect(screen.getByTestId('focus-result-item').props.accessibilityLabel).toContain('Mandarin');
  expect(screen.queryByText('귤 한 알')).toBeNull();
  expect(mockAddUnseen).toHaveBeenCalledWith('rec-1', ['cust.head.mandarin']);
});
