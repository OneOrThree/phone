import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';
import * as api from '@/services/api/developerNotices';
import { isBelowMinVersion, STORE_URLS } from '@/services/developerLetter';
import { useForceUpdateLetter } from './useForceUpdateLetter';

jest.mock('expo-application', () => ({ nativeApplicationVersion: '1.0.2' }));
jest.mock('@/services/api/developerNotices', () => ({ getAppRequirements: jest.fn() }));
const get = api.getAppRequirements as jest.Mock;
const res = (over = {}) => ({
  minVersion: '1.0.10',
  title: '업데이트',
  body: '본문',
  publicationId: 'p',
  publishedAt: '2026-10-30T00:00:00Z',
  ...over,
});
let latest: ReturnType<typeof useForceUpdateLetter>;
function Probe({ enabled }: { enabled: boolean }) {
  latest = useForceUpdateLetter({ enabled });
  return null;
}

test('isBelowMinVersion 은 자리별 숫자로 비교하고 형식 오류는 거짓이다', () => {
  expect(isBelowMinVersion('1.0.2', '1.0.10')).toBe(true);
  expect(isBelowMinVersion('2.0.1', '10.0.0')).toBe(true);
  expect(isBelowMinVersion('1.0.2', '1.0.2')).toBe(false);
  expect(isBelowMinVersion('1.0.3', '1.0.2')).toBe(false);
  for (const bad of [null, '', '1.0', '1.0.0-beta'])
    expect(isBelowMinVersion('1.0.0', bad)).toBe(false);
  expect(isBelowMinVersion('1.0', '2.0.0')).toBe(false);
  expect(isBelowMinVersion(undefined, '2.0.0')).toBe(false);
});

test('스토어 주소에 id0 이 없다', () => {
  expect(STORE_URLS.ios).not.toMatch(/id0(\D|$)/);
  expect(STORE_URLS.android).toContain('com.oneorthree.gromo');
});

describe('useForceUpdateLetter', () => {
  let listener: (s: string) => void;
  beforeEach(() => {
    get.mockReset();
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((_: string, l: any) => {
      listener = l;
      return { remove: jest.fn() };
    }) as never);
  });

  test('낮으면 requirement 를 세우고 플랫폼 인자로 부른다', async () => {
    get.mockResolvedValue(res());
    await render(<Probe enabled />);
    await waitFor(() => expect(latest?.title).toBe('업데이트'));
    expect(get).toHaveBeenCalledTimes(1);
    expect(['ios', 'android']).toContain(get.mock.calls[0][0]);
  });

  test('enabled 가 거짓이면 호출하지 않는다', async () => {
    await render(<Probe enabled={false} />);
    expect(get).not.toHaveBeenCalled();
    expect(latest).toBeNull();
  });

  test.each([
    ['실패', () => get.mockRejectedValue(new Error('x'))],
    ['minVersion null', () => get.mockResolvedValue(res({ minVersion: null }))],
    ['title 누락', () => get.mockResolvedValue(res({ title: null }))],
    ['응답 없음', () => get.mockResolvedValue(undefined)],
  ])('%s 이면 통과한다', async (_n, arrange) => {
    arrange();
    await render(<Probe enabled />);
    await waitFor(() => expect(get).toHaveBeenCalled());
    await act(async () => {});
    expect(latest).toBeNull();
  });

  test('포그라운드 복귀 때 min 이 낮아지면 내려가고, 실패하면 막힌 채다', async () => {
    get.mockResolvedValueOnce(res());
    await render(<Probe enabled />);
    await waitFor(() => expect(latest).not.toBeNull());
    get.mockRejectedValueOnce(new Error('x'));
    await act(async () => {
      listener('background');
      listener('active');
    });
    expect(get).toHaveBeenCalledTimes(2);
    expect(latest).not.toBeNull();
    get.mockResolvedValueOnce(res({ minVersion: '1.0.0' }));
    await act(async () => {
      listener('background');
      listener('active');
    });
    await waitFor(() => expect(latest).toBeNull());
  });

  test.each([
    ['title 누락', { title: undefined }, true],
    ['minVersion 형식 오류', { minVersion: '1.0' }, true],
    ['키 없음', { minVersion: undefined }, true],
    ['minVersion null', { minVersion: null }, false],
    ['낮아진 min', { minVersion: '1.0.0' }, false],
  ])('막힌 뒤 재조회가 %s 이면 %s', async (_n, over, stays) => {
    get.mockResolvedValueOnce(res());
    await render(<Probe enabled />);
    await waitFor(() => expect(latest).not.toBeNull());
    get.mockResolvedValueOnce(res(over));
    await act(async () => {
      listener('background');
      listener('active');
    });
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    await act(async () => {});
    expect(latest !== null).toBe(stays);
  });

  test('늦게 온 옛 응답은 새 응답을 덮지 않는다', async () => {
    let slow!: (v: unknown) => void;
    get.mockReturnValueOnce(new Promise((r) => (slow = r)));
    await render(<Probe enabled />);
    get.mockResolvedValueOnce(res({ minVersion: '1.0.0' }));
    await act(async () => {
      listener('background');
      listener('active');
    });
    await act(async () => slow(res()));
    expect(latest).toBeNull();
  });
});
