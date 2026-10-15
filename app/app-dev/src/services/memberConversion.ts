// GROMO-2005 회원 전환 — 친구·편지·구매의 게스트 제한 거절을 하나의 전환 흐름으로 연결한다.
// 친구·편지·주문의 앱 명령은 자기 티켓 몫이고, 여기는 그 명령들이 403 을 받았을 때 부르는
// 공통 진입점이다 — 여기서 도메인 API 를 대신 호출하거나 응답을 재전송하지 않는다.
//
// 서버 계약(business-api, 계정 LLD §2.1 「게스트 제한과 기존 계정 충돌의 2단계 확인」):
//  - ① POST /auth/sessions + 현재 게스트 AT + 제공자 자격 → 미연결이면 그대로 승격,
//    이미 연결돼 있으면 409 SOCIAL_ACCOUNT_ALREADY_LINKED.
//  - ② 사용자가 확인하면 같은 자격 + `accountSwitchConfirmed: true` + **새
//    X-Login-Attempt-Id** 로 다시 보낸다 — 확정 요청엔 AT 를 싣지 않는다(폐기된 게스트
//    세션을 실으면 401). 취소면 아무것도 바뀌지 않는다.
//  - 같은 자격의 실패 재시도는 같은 attemptId 로 보낸다 — 서버가 유실된 첫 결과를 재생한다.
import { login as apiLogin, me as apiMe } from '@/services/api/auth';
import type { Account, LoginResult, Provider } from '@/services/api/auth';
import { ApiError, uuid } from '@/services/api/client';
import { getSession, sessionGeneration } from '@/services/api/session';

/** 서버 게이트 — 이 코드에만 회원 전환 시트를 연다. 일반 FORBIDDEN·게이트 밖 403 은 아니다. */
export const isMemberGateError = (e: unknown): boolean =>
  e instanceof ApiError && e.status === 403 && e.code === 'SOCIAL_LOGIN_REQUIRED';

/** 2단계 확인의 안내 응답 — 「이 소셜 계정은 다른 계정에 연결돼 있다」. */
export const isAccountConflict = (e: unknown): boolean =>
  e instanceof ApiError && e.status === 409 && e.code === 'SOCIAL_ACCOUNT_ALREADY_LINKED';

export type MemberConversionDeps = {
  /** 게이트 거절을 받았을 때 전환 시트를 연다(App 의 모달 상태). */
  openPrompt: () => void;
  /** 「이미 연결된 계정」 확인창 — true=전환 승인(게스트 데이터 폐기 동의), false=취소 */
  confirmSwitch: () => Promise<boolean>;
  /**
   * 채택된 세션을 앱 상태에 반영한다 — GET /me 재조회, 사용자 귀속 로컬 상태 초기화,
   * 새 계정의 화면 결정({@link adoptSignedInAccount}).
   */
  adopt: (result: LoginResult, previousUserId: string | null) => Promise<unknown>;
  /** 서버 필수 필드. 앱의 약관 버전 상수. */
  termsVersion: string;
  login?: typeof apiLogin;
  newAttemptId?: () => string;
  /** 기본 session.getSession — 전환 전 로그인한 사용자를 기억한다. */
  sessionUserId?: () => string | null;
  /** 기본 session.sessionGeneration — 채택 재시도 때 같은 세션인지 확인한다. */
  sessionGeneration?: () => number;
};

export type MemberConversion = {
  /**
   * 제한 행동 호출의 catch 에서 부른다. 게이트 거절이면 전환 시트를 열고 true 를 돌려
   * 호출부의 성공 확정(로컬 반영·토스트)을 막는다. 다른 오류는 false — 호출부가 평소대로 처리한다.
   */
  offer: (error: unknown) => boolean;
  /**
   * 전환 실행 — 'converted' | 'cancelled'. 로그인·확인·채택 실패는 그대로 던지고
   * 같은 (provider, credential) 재시도는 같은 attemptId 로 서버 재생을 노린다.
   */
  convert: (provider: Provider, credential: string) => Promise<'converted' | 'cancelled'>;
  /** 로그인 세션은 발급됐지만 앱 상태 채택이 끝나지 않은 복구 대기 상태인지 확인한다. */
  hasPendingAdoption: () => boolean;
  /** 세션 세대 변경·로그아웃 경계에서 재시도용 자격과 attemptId를 버린다. */
  clearPending: () => void;
};

export function createMemberConversion(deps: MemberConversionDeps): MemberConversion {
  const login = deps.login ?? apiLogin;
  const newAttemptId = deps.newAttemptId ?? uuid;
  const sessionUserId = deps.sessionUserId ?? (() => getSession()?.userId ?? null);
  const currentSessionGeneration = deps.sessionGeneration ?? sessionGeneration;
  // 실패한 시도는 (자격, 확정 여부)와 attemptId 를 묶어 둔다 — 같은 키의 재시도는 서버가
  // 저장 결과를 재생해 제공자 자격 교환을 다시 하지 않는다(LLD §3 내구 attempt). 키가
  // 바뀌면 — 사용자가 다른 자격을 골랐거나 ② 확정으로 의도가 바뀌면 — 새 시도다.
  let pending:
    | {
        provider: Provider;
        credential: string;
        mode: 'initial' | 'confirmed' | 'recovery';
        attemptId: string;
        generation: number;
      }
    | {
        provider: Provider;
        credential: string;
        mode: 'adopt';
        result: LoginResult;
        previousUserId: string | null;
        generation: number;
      }
    | null = null;

  const attemptIdFor = (
    provider: Provider,
    credential: string,
    mode: 'initial' | 'confirmed' | 'recovery',
  ) => {
    const generation = currentSessionGeneration();
    if (
      pending?.provider !== provider ||
      pending.credential !== credential ||
      pending.mode !== mode ||
      pending.generation !== generation
    )
      pending = { provider, credential, mode, attemptId: newAttemptId(), generation };
    return pending.attemptId;
  };

  const convert = async (
    provider: Provider,
    credential: string,
  ): Promise<'converted' | 'cancelled'> => {
    if (!deps.termsVersion.trim())
      throw new ApiError(
        'TERMS_VERSION_REQUIRED',
        '약관 버전이 설정되지 않아 소셜 로그인을 사용할 수 없어요.',
        0,
      );
    const attemptGeneration = currentSessionGeneration();
    if (pending && pending.generation !== attemptGeneration) pending = null;
    // 로그인은 성공했지만 /me 채택이 실패한 경우, 다음 클릭에서는 로그인 응답을 재사용한다.
    // 채택이 끝나기 전까지 최초 사용자 ID도 유지해 게스트 데이터를 회원에 섞지 않는다.
    if (pending?.mode === 'adopt') {
      // 채택 재시도는 결과를 만든 소셜 자격으로만 이어간다. 다른 제공자나
      // 자격을 선택했다면 이전 결과는 버리고 새 로그인 흐름을 시작한다.
      // /me 의 401 은 세션을 비우고 세대를 올린다. 그 사이 다른 계정에 로그인한 경우도
      // 결과는 달라진다. 이때 옛 로그인 결과를 다시 채택하지 말고 현재 세션으로 새 로그인한다.
      if (
        pending.provider === provider &&
        pending.credential === credential &&
        pending.generation === currentSessionGeneration() &&
        sessionUserId() === pending.result.userId
      ) {
        await deps.adopt(pending.result, pending.previousUserId);
        pending = null;
        return 'converted';
      }
      pending = null;
    }
    // 전환이 끝나면 저장된 세션은 새 계정의 것이다 — 이전 계정 판정은 시작 시에 잡는다.
    const previousUserId = sessionUserId();
    const adopt = async (result: LoginResult) => {
      pending = {
        provider,
        credential,
        mode: 'adopt',
        result,
        previousUserId,
        generation: currentSessionGeneration(),
      };
      await deps.adopt(result, previousUserId);
      pending = null;
    };
    // ② 확정 요청의 응답만 유실된 경우에는 ①부터 다시 시작하지 않고, 저장해 둔 확정
    // attemptId로 같은 요청을 재생한다. 호출부도 이때 같은 provider credential을 보존한다.
    if (
      pending?.provider === provider &&
      pending.credential === credential &&
      pending.mode === 'confirmed'
    ) {
      let replayed: LoginResult;
      try {
        replayed = await login(provider, credential, deps.termsVersion, {
          attemptId: attemptIdFor(provider, credential, 'confirmed'),
          attachCurrentSession: true,
          accountSwitchConfirmed: true,
        });
      } catch (error) {
        // 확정 attempt의 게스트 삭제만 커밋되면 같은 attempt는 탈퇴된 게스트 AT 검사에서
        // USER_NOT_FOUND로 끝난다(LLD §2.1). 새 attempt로 AT 없이 대상 회원 로그인을 잇는다.
        if (!(error instanceof ApiError && error.status === 404 && error.code === 'USER_NOT_FOUND'))
          throw error;
        pending = {
          provider,
          credential,
          mode: 'recovery',
          attemptId: newAttemptId(),
          generation: currentSessionGeneration(),
        };
        replayed = await login(provider, credential, deps.termsVersion, {
          attemptId: pending.attemptId,
        });
      }
      await adopt(replayed);
      return 'converted';
    }
    // 부분 커밋 복구 로그인도 응답 유실 시 같은 시도 ID로 재생한다. AT와 확정 신호는 싣지 않는다.
    if (
      pending?.provider === provider &&
      pending.credential === credential &&
      pending.mode === 'recovery'
    ) {
      const replayed = await login(provider, credential, deps.termsVersion, {
        attemptId: attemptIdFor(provider, credential, 'recovery'),
      });
      await adopt(replayed);
      return 'converted';
    }
    try {
      const result = await login(provider, credential, deps.termsVersion, {
        attemptId: attemptIdFor(provider, credential, 'initial'),
        attachCurrentSession: true,
      });
      await adopt(result);
      return 'converted';
    } catch (thrown) {
      // 충돌이 아니면 그대로 던진다 — attemptId 를 지우지 않아 다음 재시도가 재생을 받는다.
      if (!isAccountConflict(thrown)) throw thrown;
    }
    if (currentSessionGeneration() !== attemptGeneration) {
      pending = null;
      return 'cancelled';
    }
    if (!(await deps.confirmSwitch())) {
      pending = null;
      return 'cancelled';
    }
    if (currentSessionGeneration() !== attemptGeneration) {
      pending = null;
      return 'cancelled';
    }
    // ② 확정 — 의도가 바뀌었으므로 새 attemptId(attemptIdFor 가 갈아 끼운다). 원 게스트 AT를
    // 동봉해 서버가 게스트 체크포인트 삭제/탈퇴를 수행하게 한다.
    const result = await login(provider, credential, deps.termsVersion, {
      attemptId: attemptIdFor(provider, credential, 'confirmed'),
      attachCurrentSession: true,
      accountSwitchConfirmed: true,
    });
    await adopt(result);
    return 'converted';
  };

  return {
    offer: (error) => {
      if (!isMemberGateError(error)) return false;
      deps.openPrompt();
      return true;
    },
    convert,
    hasPendingAdoption: () => pending?.mode === 'adopt',
    clearPending: () => {
      pending = null;
    },
  };
}

export type AdoptDeps = {
  /**
   * 사용자 귀속 로컬 상태 초기화 — AsyncStorage blob 삭제 + reducer 를 빈 상태로.
   * 계정이 바뀐 전환에만 부른다(같은 userId 의 게스트 승격은 서버가 데이터를 보존한다).
   */
  resetLocal: () => void | Promise<void>;
  /** 서버 정본 계정을 state 에 반영한다(LOGIN + PROFILE dispatch). */
  applyAccount: (account: Account) => void;
  /** 새 계정의 시작 화면을 결정해 이동한다 — 부팅과 같은 decideBootRoute 경로(섬 재조회 포함). */
  navigate: (account: Account) => void | Promise<void>;
  me?: typeof apiMe;
};

/**
 * 전환으로 채택된 계정을 앱 상태에 반영한다.
 * GET /me 재조회가 먼저다 — 새 세션의 계정 상태를 서버가 확인한 뒤에만 로컬을 비운다.
 * (/me 가 실패한 채 비우면 이전 데이터도 새 상태도 없는 화면이 된다.)
 */
export async function adoptSignedInAccount(
  result: LoginResult,
  previousUserId: string | null,
  deps: AdoptDeps,
): Promise<Account> {
  const account = await (deps.me ?? apiMe)();
  if (previousUserId !== result.userId) await deps.resetLocal();
  deps.applyAccount(account);
  await deps.navigate(account);
  return account;
}
