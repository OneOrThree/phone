import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useConstructionAnnouncements } from './useConstructionAnnouncements';
import { getConstructionOptions } from '@/services/api/home';
jest.mock('@/services/api/home', () => ({ getConstructionOptions: jest.fn() }));
let mockGeneration = 1;
jest.mock('@/services/api/session', () => ({ sessionGeneration: () => mockGeneration }));
const api = jest.mocked(getConstructionOptions);
beforeEach(() => {
  mockGeneration = 1;
  api.mockReset();
});

test('완공 목록만 있는 신규 가입자에게는 축하하지 않고 서버 기여자에게만 안내한다', async () => {
  api.mockResolvedValueOnce({ contributedCompletions: [] } as any);
  const h = await renderHook(
    ({ built }: { built: string }) => useConstructionAnnouncements('a', 'island', built, true),
    { initialProps: { built: 'hall,mail' } },
  );
  await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
  expect(h.result.current).toEqual([]);
  api.mockResolvedValueOnce({ contributedCompletions: ['mail', 'shop'] } as any);
  await h.rerender({ built: 'hall,mail,tower' });
  await waitFor(() => expect(h.result.current).toEqual(['mail']));
});

test('이전 섬·계정 응답은 새 섬의 완공 안내에 섞이지 않는다', async () => {
  let resolve!: (data: any) => void;
  api.mockReturnValueOnce(
    new Promise((r) => {
      resolve = r;
    }),
  );
  const h = await renderHook(
    ({ island }: { island: string }) => useConstructionAnnouncements('a', island, 'mail', true),
    { initialProps: { island: 'old' } },
  );
  api.mockResolvedValueOnce({ contributedCompletions: [] } as any);
  mockGeneration += 1;
  await h.rerender({ island: 'new' });
  await act(async () => {
    resolve({ contributedCompletions: ['mail'] });
  });
  expect(h.result.current).toEqual([]);
});
