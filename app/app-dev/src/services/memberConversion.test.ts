// GROMO-2005 회원 전환 회귀 — 게이트 판별, 409 2단계 확인, attemptId 재생, 계정 채택 순서.
import assert from 'node:assert/strict';
import {
  adoptSignedInAccount,
  createMemberConversion,
  isAccountConflict,
  isMemberGateError,
} from '@/services/memberConversion';
import { ApiError } from '@/services/api/client';
import type { Account, LoginOptions, LoginResult, Provider } from '@/services/api/auth';

const result = (userId: string): LoginResult => ({
  accessToken: 'AT',
  refreshToken: 'RT',
  userId,
  onboardingComplete: true,
});

const account = (id: string): Account => ({
  id,
  name: '냥이',
  catColor: 'black',
  mainIslandId: null,
  linkedProviders: ['apple'],
  onboardingComplete: true,
});

const gate = () => new ApiError('SOCIAL_LOGIN_REQUIRED', '소셜 로그인하면 이용할 수 있어요.', 403);
const conflict = () =>
  new ApiError('SOCIAL_ACCOUNT_ALREADY_LINKED', '이미 다른 계정에 연동된 소셜 계정입니다', 409);

type LoginCall = {
  provider: Provider;
  credential: string;
  options: LoginOptions | undefined;
};

/** login 이 호출마다 outcomes 를 하나씩 소비한다 — LoginResult 면 성공, Error 면 던진다. */
const make = (
  outcomes: (LoginResult | Error)[],
  { confirm = true }: { confirm?: boolean } = {},
) => {
  const calls: LoginCall[] = [];
  const adopted: { result: LoginResult; previousUserId: string | null }[] = [];
  let opened = 0;
  let asked = 0;
  let ids = 0;
  const conversion = createMemberConversion({
    termsVersion: '2026-09',
    openPrompt: () => {
      opened += 1;
    },
    confirmSwitch: async () => {
      asked += 1;
      return confirm;
    },
    adopt: async (r, previousUserId) => {
      adopted.push({ result: r, previousUserId });
    },
    login: async (provider, credential, _terms, options) => {
      calls.push({ provider, credential, options });
      const out = outcomes[Math.min(calls.length - 1, outcomes.length - 1)];
      if (out instanceof Error) throw out;
      return out;
    },
    newAttemptId: () => `attempt-${++ids}`,
    sessionUserId: () => 'guest-1',
  });
  return {
    conversion,
    calls,
    adopted,
    opened: () => opened,
    asked: () => asked,
  };
};

test('게이트 판별 — 403 SOCIAL_LOGIN_REQUIRED 만 전환 진입이고 나머지는 아니다', () => {
  assert.equal(isMemberGateError(gate()), true);
  assert.equal(isMemberGateError(new ApiError('FORBIDDEN', '금지', 403)), false);
  assert.equal(isMemberGateError(conflict()), false);
  assert.equal(isMemberGateError(new Error('network')), false);
  assert.equal(isAccountConflict(conflict()), true);
  assert.equal(isAccountConflict(gate()), false);
});

test('offer — 게이트 거절이면 시트를 열고 true, 다른 오류는 false 로 호출부에 돌려준다', () => {
  const { conversion, opened } = make([result('u1')]);
  assert.equal(conversion.offer(gate()), true);
  assert.equal(opened(), 1);
  assert.equal(conversion.offer(new ApiError('FRIEND_NOT_FOUND', '없음', 404)), false);
  assert.equal(conversion.offer(new Error('x')), false);
  assert.equal(opened(), 1);
});

test('convert 성공 — 게스트 AT 를 동봉해 승격하고 채택한다', async () => {
  const { conversion, calls, adopted } = make([result('guest-1')]);

  const outcome = await conversion.convert('apple', 'apple-jwt');

  assert.equal(outcome, 'converted');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options?.attachCurrentSession, true);
  assert.equal(calls[0].options?.accountSwitchConfirmed, undefined);
  assert.equal(typeof calls[0].options?.attemptId, 'string');
  // 승격은 같은 userId — 이전 세션 사용자를 채택에 넘긴다.
  assert.deepEqual(adopted, [{ result: result('guest-1'), previousUserId: 'guest-1' }]);
});

test('convert 충돌 취소 — 확인창에서 취소하면 두 번째 로그인도 채택도 없다', async () => {
  const { conversion, calls, adopted, asked } = make([conflict()], { confirm: false });

  const outcome = await conversion.convert('apple', 'apple-jwt');

  assert.equal(outcome, 'cancelled');
  assert.equal(asked(), 1);
  assert.equal(calls.length, 1);
  assert.equal(adopted.length, 0);
});

test('convert 충돌 승인 — 같은 자격·새 attemptId·확정 신호·AT 없이 다시 보낸다', async () => {
  const { conversion, calls, adopted } = make([conflict(), result('member-9')]);

  const outcome = await conversion.convert('apple', 'apple-jwt');

  assert.equal(outcome, 'converted');
  assert.equal(calls.length, 2);
  // ② 확정 요청 — 의도가 바뀌었으므로 attemptId 는 새 값, accountSwitchConfirmed 만 담긴다.
  assert.equal(calls[1].credential, 'apple-jwt');
  assert.equal(calls[1].options?.accountSwitchConfirmed, true);
  assert.notEqual(calls[1].options?.attemptId, calls[0].options?.attemptId);
  assert.equal(calls[1].options?.attachCurrentSession, undefined);
  assert.equal(adopted[0].result.userId, 'member-9');
});

test('convert 실패 재시도 — 같은 자격은 같은 attemptId 로 서버 재생을 노린다', async () => {
  const { conversion, calls } = make([
    new ApiError('SERVER_ERROR', '서버 오류', 503, { retryable: true }),
    result('guest-1'),
  ]);

  await assert.rejects(() => conversion.convert('apple', 'apple-jwt'));
  const outcome = await conversion.convert('apple', 'apple-jwt');

  assert.equal(outcome, 'converted');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options?.attemptId, calls[1].options?.attemptId);
});

test('convert — 자격이 바뀌면 새 시도다(attemptId 도 새 값)', async () => {
  const { conversion, calls } = make([
    new ApiError('SERVER_ERROR', '서버 오류', 503, { retryable: true }),
    result('guest-1'),
  ]);

  await assert.rejects(() => conversion.convert('apple', 'apple-jwt'));
  await conversion.convert('google', 'google-jwt');

  assert.notEqual(calls[1].options?.attemptId, calls[0].options?.attemptId);
});

test('convert — 충돌이 아닌 거절은 확인창 없이 그대로 던진다', async () => {
  const { conversion, asked, adopted } = make([
    new ApiError('APPLE_TOKEN', '자격이 유효하지 않습니다.', 401),
  ]);

  const error = await conversion.convert('apple', 'bad').catch((e) => e);

  assert.equal(error.code, 'APPLE_TOKEN');
  assert.equal(asked(), 0);
  assert.equal(adopted.length, 0);
});

test('adopt — 같은 userId 의 게스트 승격은 로컬을 비우지 않고 /me 정본만 반영한다', async () => {
  const calls: string[] = [];
  const me = async () => {
    calls.push('me');
    return account('guest-1');
  };

  const acc = await adoptSignedInAccount(result('guest-1'), 'guest-1', {
    me,
    resetLocal: () => {
      calls.push('resetLocal');
    },
    applyAccount: (a) => {
      calls.push(`apply:${a.id}`);
    },
    navigate: (a) => {
      calls.push(`navigate:${a.id}`);
    },
  });

  assert.equal(acc.id, 'guest-1');
  assert.deepEqual(calls, ['me', 'apply:guest-1', 'navigate:guest-1']);
});

test('adopt — userId 가 바뀐 계정 전환은 /me 확인 뒤 사용자 귀속 상태를 비우고 반영한다', async () => {
  const calls: string[] = [];

  await adoptSignedInAccount(result('member-9'), 'guest-1', {
    me: async () => {
      calls.push('me');
      return account('member-9');
    },
    resetLocal: () => {
      calls.push('resetLocal');
    },
    applyAccount: (a) => {
      calls.push(`apply:${a.id}`);
    },
    navigate: (a) => {
      calls.push(`navigate:${a.id}`);
    },
  });

  assert.deepEqual(calls, ['me', 'resetLocal', 'apply:member-9', 'navigate:member-9']);
});

test('adopt — /me 가 실패하면 로컬을 비우지 않는다(이전 상태도 새 상태도 없는 화면 방지)', async () => {
  const calls: string[] = [];

  await assert.rejects(() =>
    adoptSignedInAccount(result('member-9'), 'guest-1', {
      me: async () => {
        calls.push('me');
        throw new ApiError('SERVER_ERROR', '서버 오류', 503, { retryable: true });
      },
      resetLocal: () => {
        calls.push('resetLocal');
      },
      applyAccount: () => {
        calls.push('apply');
      },
      navigate: () => {
        calls.push('navigate');
      },
    }),
  );

  assert.deepEqual(calls, ['me']);
});
