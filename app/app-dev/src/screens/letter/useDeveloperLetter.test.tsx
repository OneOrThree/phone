import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, render, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';
import * as api from '@/services/api/developerNotices';
import { letterSeenKey } from '@/services/developerLetter';
import { useDeveloperLetter } from './useDeveloperLetter';

jest.mock('@/services/api/developerNotices', () => ({ listDeveloperNotices: jest.fn() }));
const list = api.listDeveloperNotices as jest.Mock;
const notice = (id: string, at: string) => ({
  publicationId: id,
  title: id,
  body: 'b',
  startsAt: at,
  endsAt: null,
  publishedAt: at,
});
let latest: ReturnType<typeof useDeveloperLetter>;
function Probe(p: { ready: boolean; userId: string | null }) {
  latest = useDeveloperLetter(p);
  return null;
}
const seen = (u: string) => AsyncStorage.getItem(letterSeenKey(u));

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

it('키 없는 첫 실행: 최신 시각만 저장하고 띄우지 않는다', async () => {
  list.mockResolvedValue({
    items: [notice('a', '2026-10-01T00:00:00Z'), notice('b', '2026-10-02T00:00:00Z')],
  });
  await render(<Probe ready userId="u1" />);
  await waitFor(async () =>
    expect(await seen('u1')).toBe(String(Date.parse('2026-10-02T00:00:00Z'))),
  );
  expect(latest.notice).toBeNull();
});

it('안 읽은 공지가 여럿이면 최신 1건만 뜨고, 닫으면 저장돼 다시 안 뜬다', async () => {
  await AsyncStorage.setItem(letterSeenKey('u1'), String(Date.parse('2026-09-01T00:00:00Z')));
  list.mockResolvedValue({
    items: [notice('a', '2026-10-01T00:00:00Z'), notice('b', '2026-10-02T00:00:00Z')],
  });
  const r = await render(<Probe ready userId="u1" />);
  await waitFor(() => expect(latest.notice?.publicationId).toBe('b'));
  await act(() => latest.dismiss());
  expect(latest.notice).toBeNull();
  await waitFor(async () =>
    expect(await seen('u1')).toBe(String(Date.parse('2026-10-02T00:00:00Z'))),
  );
  await r.rerender(<Probe ready={false} userId="u1" />);
  await r.rerender(<Probe ready userId="u1" />);
  expect(list).toHaveBeenCalledTimes(1);
  expect(latest.notice).toBeNull();
});

it('응답을 기다리는 사이 게이트가 닫히면 버리고, 다시 참일 때 조회한다', async () => {
  await AsyncStorage.setItem(letterSeenKey('u1'), '1');
  let resolve!: (v: unknown) => void;
  list.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
  list.mockResolvedValue({ items: [notice('a', '2026-10-01T00:00:00Z')] });
  const r = await render(<Probe ready userId="u1" />);
  await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
  await r.rerender(<Probe ready={false} userId="u1" />);
  await act(async () => resolve({ items: [notice('a', '2026-10-01T00:00:00Z')] }));
  expect(latest.notice).toBeNull();
  await r.rerender(<Probe ready userId="u1" />);
  await waitFor(() => expect(latest.notice?.publicationId).toBe('a'));
  expect(list).toHaveBeenCalledTimes(2);
});

it('응답을 기다리는 사이 계정이 바뀌면 표시하지 않는다', async () => {
  await AsyncStorage.setItem(letterSeenKey('u1'), '1');
  let resolve!: (v: unknown) => void;
  list.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
  list.mockResolvedValue({ items: [] });
  const r = await render(<Probe ready userId="u1" />);
  await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
  await r.rerender(<Probe ready userId="u2" />);
  await act(async () => resolve({ items: [notice('a', '2026-10-01T00:00:00Z')] }));
  expect(latest.notice).toBeNull();
});

it('forcesUpdate 만 있으면 표시도 저장값 변화도 없다', async () => {
  await AsyncStorage.setItem(letterSeenKey('u1'), '5');
  list.mockResolvedValue({
    items: [{ ...notice('f', '2026-10-01T00:00:00Z'), forcesUpdate: true }],
  });
  await render(<Probe ready userId="u1" />);
  await waitFor(() => expect(list).toHaveBeenCalled());
  expect(latest.notice).toBeNull();
  expect(await seen('u1')).toBe('5');
});

it('조회 실패는 조용히 넘기고 포그라운드 복귀 때 다시 본다', async () => {
  let handler: (s: string) => void = () => {};
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((
    _: string,
    h: (s: string) => void,
  ) => {
    handler = h;
    return { remove: jest.fn() };
  }) as never);
  await AsyncStorage.setItem(letterSeenKey('u1'), '1');
  list.mockRejectedValueOnce(new Error('x'));
  list.mockResolvedValue({ items: [notice('a', '2026-10-01T00:00:00Z')] });
  const r = await render(<Probe ready userId="u1" />);
  await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
  expect(latest.notice).toBeNull();
  await act(() => handler('background'));
  await r.rerender(<Probe ready={false} userId="u1" />);
  await r.rerender(<Probe ready userId="u1" />);
  await waitFor(() => expect(latest.notice?.publicationId).toBe('a'));
});

it('첫 실행: 조회 대기 중 게이트가 닫히면 키를 저장하지 않고, 다시 참일 때 재조회해 그때 기준을 저장한다', async () => {
  let resolve!: (v: unknown) => void;
  list.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
  list.mockResolvedValue({ items: [notice('b', '2026-10-03T00:00:00Z')] });
  const r = await render(<Probe ready userId="u1" />);
  await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
  await r.rerender(<Probe ready={false} userId="u1" />);
  await act(async () => resolve({ items: [notice('a', '2026-10-01T00:00:00Z')] }));
  expect(await seen('u1')).toBeNull();
  await r.rerender(<Probe ready userId="u1" />);
  await waitFor(async () =>
    expect(await seen('u1')).toBe(String(Date.parse('2026-10-03T00:00:00Z'))),
  );
  expect(list).toHaveBeenCalledTimes(2);
  expect(latest.notice).toBeNull();
});
