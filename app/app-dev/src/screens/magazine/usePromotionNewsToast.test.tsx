// 주민 소식 토스트(GROMO-2289 · C3) — 아직 안 본 가장 최근 홍보 소식만 한 번, 하루 지난 소식·꺼진 상태는 조용히.
import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { render, waitFor } from '@testing-library/react-native';
import * as api from '@/services/api/magazine';
import { newsSeenKey, usePromotionNewsToast } from './usePromotionNewsToast';

jest.mock('@/services/api/magazine', () => ({
  ...jest.requireActual('@/services/api/magazine'),
  getIslandNews: jest.fn(),
}));
const getNews = api.getIslandNews as jest.Mock;
const NOW = Date.parse('2026-10-14T03:00:00Z');

function Probe(props: { active: boolean; notify: (m: string) => void }) {
  usePromotionNewsToast({ ...props, islandId: 'i1', now: () => NOW });
  return null;
}
const item = (id: string, minutesAgo: number, kind = 'PROMOTION') => ({
  id,
  kind,
  body: '…',
  createdAt: new Date(NOW - minutesAgo * 60_000).toISOString(),
});

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

it('새 홍보 소식이면 한 번 알리고 「본 소식」으로 남긴다', async () => {
  getNews.mockResolvedValue([item('n2', 5), item('n1', 600)]);
  const notify = jest.fn();
  await render(<Probe active notify={notify} />);
  await waitFor(() => expect(notify).toHaveBeenCalledTimes(1));
  expect(notify).toHaveBeenCalledWith(
    '섬장이 오늘 잡지 홍보에 60마리를 썼어요 · 내일 아침 잡지에 실려요',
  );
  expect(await AsyncStorage.getItem(newsSeenKey('i1'))).toBe('n2');
});

it('이미 본 소식이면 알리지 않는다', async () => {
  await AsyncStorage.setItem(newsSeenKey('i1'), 'n2');
  getNews.mockResolvedValue([item('n2', 5)]);
  const notify = jest.fn();
  await render(<Probe active notify={notify} />);
  await waitFor(() => expect(getNews).toHaveBeenCalledTimes(1));
  await new Promise((r) => setTimeout(r, 10));
  expect(notify).not.toHaveBeenCalled();
});

it.each([
  ['하루 지난 소식', [item('old', 60 * 25)]],
  ['홍보가 아닌 소식', [item('x', 1, 'OTHER')]],
])('%s은 알리지 않는다', async (_, items) => {
  getNews.mockResolvedValue(items);
  const notify = jest.fn();
  await render(<Probe active notify={notify} />);
  await waitFor(() => expect(getNews).toHaveBeenCalledTimes(1));
  await new Promise((r) => setTimeout(r, 10));
  expect(notify).not.toHaveBeenCalled();
});

it('꺼져 있으면(섬장·방문자) 부르지도 않는다', async () => {
  const notify = jest.fn();
  await render(<Probe active={false} notify={notify} />);
  expect(getNews).not.toHaveBeenCalled();
});

it('소식을 못 읽어도 조용히 넘어간다', async () => {
  getNews.mockRejectedValue(new Error('offline'));
  const notify = jest.fn();
  await render(<Probe active notify={notify} />);
  await waitFor(() => expect(getNews).toHaveBeenCalled());
  expect(notify).not.toHaveBeenCalled();
});
