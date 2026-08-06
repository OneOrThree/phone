// 세션 저장 직렬화(GROMO-1049) — 응답의 balanceAfter 가 '그 트랜잭션 시점' 잔액이라,
// 저장이 동시에 뜨면 오래된 값이 최신을 덮을 수 있다(코덱스 리뷰 P1). 요청을 한 번에 하나씩
// 보내면 응답 순서가 곧 커밋 순서라 역전이 성립하지 않는다.
import { saveFocusSession } from './focusApi';
import { api } from '@/services/api';

jest.mock('@/services/api', () => ({ api: { post: jest.fn() } }));

const mockPost = api.post as jest.MockedFunction<typeof api.post>;

const body = (startedAt: string) => ({
  focusTagId: null,
  subject: '수학',
  startedAt,
  endedAt: startedAt,
  distractionCount: 0,
  totalDistractionSeconds: 0,
});

beforeEach(() => {
  jest.clearAllMocks();
});

test('앞선 저장이 끝나기 전에는 다음 저장을 보내지 않는다', async () => {
  let finishFirst: (v: { data: { balanceAfter: number } }) => void = () => {};
  mockPost
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishFirst = resolve as (v: { data: { balanceAfter: number } }) => void;
        }) as never,
    )
    .mockResolvedValueOnce({ data: { balanceAfter: 112 } } as never);

  const first = saveFocusSession(body('2026-08-07T01:00:00Z'));
  const second = saveFocusSession(body('2026-08-07T02:00:00Z'));

  // 첫 요청이 떠 있는 동안 두 번째는 아직 나가지 않았다.
  await Promise.resolve();
  expect(mockPost).toHaveBeenCalledTimes(1);

  finishFirst({ data: { balanceAfter: 107 } });
  await expect(first).resolves.toEqual({ balanceAfter: 107 });
  await expect(second).resolves.toEqual({ balanceAfter: 112 });
  expect(mockPost).toHaveBeenCalledTimes(2);
});

test('앞선 저장이 실패해도 체인이 끊기지 않고 다음 저장이 진행된다', async () => {
  mockPost
    .mockRejectedValueOnce(new Error('network'))
    .mockResolvedValueOnce({ data: { balanceAfter: 99 } } as never);

  const failing = saveFocusSession(body('2026-08-07T01:00:00Z'));
  const next = saveFocusSession(body('2026-08-07T02:00:00Z'));

  // 실패는 호출자에게 그대로 전파된다(대기열 인계가 이 예외로 동작한다).
  await expect(failing).rejects.toThrow('network');
  await expect(next).resolves.toEqual({ balanceAfter: 99 });
});
