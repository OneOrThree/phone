// 세션 저장 직렬화(GROMO-1049) — 응답의 balanceAfter 가 '그 트랜잭션 시점' 잔액이라,
// 저장이 동시에 뜨면 오래된 값이 최신을 덮을 수 있다(코덱스 리뷰 P1). 요청을 한 번에 하나씩
// 보내면 응답 순서가 곧 커밋 순서라 역전이 성립하지 않는다.
import { saveFocusSession } from './focusApi';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '@/types/storage';
import { api } from '@/services/api';

jest.mock('@/services/api', () => ({
  api: { post: jest.fn() },
  // 저장이 체인에서 대기하는 동안 계정이 바뀌었는지 대조하는 데 쓰인다.
  // 토큰 문자열을 그대로 계정 id로 본다 — 테스트가 계정 전환을 토큰 교체로 흉내낼 수 있게.
  getUserIdFromToken: (token: string) => token,
}));

const mockPost = api.post as jest.MockedFunction<typeof api.post>;

// 목이 토큰 문자열을 그대로 계정 id로 돌려주므로, 저장 소유 계정 = 저장된 토큰이어야 전송된다.
const OWNER = 'u1';

const body = (startedAt: string) => ({
  focusTagId: null,
  subject: '수학',
  startedAt,
  endedAt: startedAt,
  distractionCount: 0,
  totalDistractionSeconds: 0,
});

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.setItem(STORAGE_KEYS.accessToken, OWNER);
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

  const first = saveFocusSession(body('2026-08-07T01:00:00Z'), OWNER);
  const second = saveFocusSession(body('2026-08-07T02:00:00Z'), OWNER);

  // 첫 요청이 떠 있는 동안 두 번째는 아직 나가지 않았다.
  // (전송 전 계정 대조가 AsyncStorage 를 읽으므로 마이크로태스크 한 번으로는 부족하다)
  await new Promise((resolve) => setTimeout(resolve, 0));
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

  const failing = saveFocusSession(body('2026-08-07T01:00:00Z'), OWNER);
  const next = saveFocusSession(body('2026-08-07T02:00:00Z'), OWNER);

  // 실패는 호출자에게 그대로 전파된다(대기열 인계가 이 예외로 동작한다).
  await expect(failing).rejects.toThrow('network');
  await expect(next).resolves.toEqual({ balanceAfter: 99 });
});

// 직렬화로 전송까지 대기가 생긴 탓에, 그 사이 계정이 바뀌면 api 인터셉터가 **전송 시점의 토큰**을
// 붙여 옛 계정의 세션·보상이 새 계정에 커밋된다(코덱스 리뷰 P1). 전송 직전에 대조해 취소한다.
test('대기 중 계정이 바뀌면 전송하지 않고 취소한다', async () => {
  let finishFirst: (v: { data: { balanceAfter: number } }) => void = () => {};
  mockPost.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishFirst = resolve as (v: { data: { balanceAfter: number } }) => void;
      }) as never,
  );

  const first = saveFocusSession(body('2026-08-07T01:00:00Z'), OWNER);
  // 옛 계정이 시작한 저장이 체인에서 대기한다.
  const queued = saveFocusSession(body('2026-08-07T02:00:00Z'), OWNER);

  // 첫 요청은 이미 전송에 들어갔다(계정 대조를 통과한 뒤다).
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(mockPost).toHaveBeenCalledTimes(1);

  // 그 사이 계정 전환 — 토큰이 새 계정 것으로 바뀐다.
  await AsyncStorage.setItem(STORAGE_KEYS.accessToken, 'u2');

  finishFirst({ data: { balanceAfter: 107 } });
  await expect(first).resolves.toEqual({ balanceAfter: 107 });
  // 대기하던 저장은 새 계정으로 커밋되지 않고 취소된다 — 호출부가 옛 계정으로 대기열에 넣는다.
  await expect(queued).rejects.toThrow('계정이 전환됨');
  // POST 는 첫 요청 1회만 나갔다.
  expect(mockPost).toHaveBeenCalledTimes(1);
});
