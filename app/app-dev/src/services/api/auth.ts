/**
 * 인증·계정 도메인 모듈. 다음 티켓은 **여기 말고 자기 파일**을 `src/services/api/` 에 만든다
 * (`islands.ts`·`focus.ts`·`shop.ts`·`friends.ts` …) — 한 파일에 몰면 서로의 머지 충돌이 된다.
 *
 * 서버 계약(business-api):
 *  - `POST   /auth/sessions`          소셜 로그인. `X-Login-Attempt-Id`(UUID36) 필수, AT 는 선택.
 *  - `DELETE /auth/sessions/current`  로그아웃. `X-Refresh-Token` 필수.
 *  - `GET    /me`                     내 계정.
 */
import { ApiError, CLIENT_STALE_SESSION, request, uuid } from './client';
import {
  clearRejectedSession,
  clearSession,
  getSession,
  saveSession,
  sessionGeneration,
} from './session';

/**
 * 정책(2026-09-14 「인증·게스트 계정」): 로그인 수단은 이 셋뿐이고, 회원 하나에 하나만 연결한다.
 * 서버(`SocialCredential.PROVIDERS`)는 line·instagram·facebook 까지 6종을 받지만 2.0 은 셋만 쓴다.
 */
export type Provider = 'apple' | 'google' | 'kakao';

/**
 * 제공자별 자격 종류(`SocialCredential.supportedKind`). **어긋나면 서버가 422 로 거절한다.**
 * 호출부가 고르게 두면 틀리기 쉬운 값이라 여기서 정한다.
 * `authorization_code` 는 교환 어댑터가 아직 없어 서버가 422 로 막는다 — 앱은 보내지 않는다.
 */
const CREDENTIAL_KIND: Record<Provider, string> = {
  apple: 'id_token',
  google: 'id_token',
  kakao: 'access_token',
};

export interface LoginOptions {
  /** 재시도할 때 **같은 값**을 넘긴다. 서버가 저장된 결과를 돌려주고 제공자 교환을 다시 하지 않는다. */
  attemptId?: string;
  /**
   * 저장된 현재 세션의 AT 를 함께 보낸다. 서버는 이걸 보고 **게스트 승격**(정책 「미연결 소셜
   * 계정으로 전환하면 기존 고양이·섬 소속·집중 기록을 같은 사용자 계정으로 이전한다」) 또는
   * **정상 계정 전환**(LLD §2.1: 유효한 guest=false AT 도 허용하되 승격 대상에서만 제외)으로
   * 처리한다. 동봉한 AT 가 무효면 401 이고 익명 로그인으로 강등되지 않으므로 기본값은 false 다.
   */
  attachCurrentSession?: boolean;
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  userId: string;
  /** 고양이 색·이름까지 고른 계정인지. 재시작 복구에서 이 값이 정본이다. */
  onboardingComplete: boolean;
}

/** `GET /me` 의 data. `name`·`catColor` 는 온보딩 전 null 이다. */
export interface Account {
  id: string;
  name: string | null;
  catColor: string | null;
  linkedProviders: string[];
  onboardingComplete: boolean;
}

/**
 * 소셜 로그인. 성공하면 토큰을 보안 저장소에 넣고 세션 세대를 올린다.
 *
 * `credential` 은 제공자가 준 **원 토큰 문자열**이다(종류는 {@link CREDENTIAL_KIND} 가 정한다).
 * 최초 로그인에는 우리 AT 가 없고 **폐기된 AT 를 실으면 서버가 401 로 끊으므로** 기본은 AT 미전송이다
 * — 게스트 승격·계정 전환만 `attachCurrentSession` 으로 AT 를 함께 보낸다.
 */
export async function login(
  provider: Provider,
  credential: string,
  termsVersion: string,
  { attemptId = uuid(), attachCurrentSession = false }: LoginOptions = {},
): Promise<LoginResult> {
  // 준비: 전환 «전에» 이전 세션의 RT 와 세대를 쥔다. 새 세션을 커밋한 뒤엔 꺼낼 수 없다.
  const generation = sessionGeneration();
  const previous = getSession();
  const result = await request<LoginResult>('/auth/sessions', {
    method: 'POST',
    auth: attachCurrentSession,
    generation,
    headers: { 'X-Login-Attempt-Id': attemptId },
    body: {
      provider,
      credential: { type: CREDENTIAL_KIND[provider], value: credential },
      termsVersion,
    },
  });
  // commit: 3키 + 마커가 다 쓰인 뒤에만 새 세션이 공개된다(session.saveSession).
  // 응답이 request 의 세대 검사를 통과한 «뒤»에도 저장은 다시 양보한다 — 그 사이 로그아웃이나 두
  // 번째 로그인이 끝났으면 saveSession 이 잡아 둔 세대를 보고 저장을 버린다. 직렬화는 session.ts 의
  // single-flight 가 맡는다. 여기서 잠금을 들고 request 를 부르면 401 정리와 교착한다.
  const published = await saveSession(
    {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      userId: result.userId,
    },
    generation,
  );
  if (!published) {
    // 버려진 로그인의 **서버** 세션은 그대로 살아 있다 — 방금 받은 RT 로 그 세션만 끊는다.
    revokeUnlessCurrent(result.refreshToken);
    throw new ApiError(CLIENT_STALE_SESSION, '로그인 정보가 바뀌었어요. 다시 시도해 주세요.', 0);
  }
  // commit 뒤 전달: 이전 세션의 RT 를 «독립적으로» 폐기한다(LLD §2.4 「준비 → commit → commit 뒤 전달」).
  // 여기서는 이전 RT 폐기까지만 — FCM 재등록·deliveryTag 대조는 기기 등록 티켓 몫이다.
  if (previous) revokeUnlessCurrent(previous.refreshToken);
  return result;
}

/**
 * 채택된 세션이 **아닌** 세션을 서버에서 끊는다. 실패해도 새 세션 저장을 되돌리거나 전역
 * 로그아웃하지 않으므로 기다리지 않고 결과도 보지 않는다.
 *
 * 판정은 사용자 UUID 가 아니라 **세션**이다 — 같은 사용자 s1→s2 재로그인도 전환이다. 앱이 sid 를
 * 들고 있지 않아 RT 값으로 세션을 가른다: 2.0 표면엔 refresh 가 없어 같은 sid 의 RT 회전이 없고,
 * 같은 attemptId 재시도로 재생된 «같은» 세션은 RT 가 같아 여기서 걸러진다(그 RT 를 폐기하면
 * 방금 채택한 세션이 끊긴다). sid 가 앱에 노출되면 그때 sid 비교로 바꾼다.
 */
function revokeUnlessCurrent(refreshToken: string): void {
  if (refreshToken === getSession()?.refreshToken) return;
  revokeRefreshToken(refreshToken).catch(() => {});
}

/** RT 하나로 그 세션만 끝낸다. AT 는 싣지 않는다 — 이유는 {@link logout}. */
function revokeRefreshToken(refreshToken: string): Promise<{ revoked: boolean }> {
  return request<{ revoked: boolean }>('/auth/sessions/current', {
    method: 'DELETE',
    auth: false,
    headers: { 'X-Refresh-Token': refreshToken },
  });
}

/**
 * 현재 기기 세션만 끝낸다(정책: 「로그아웃은 서버 데이터를 유지하고 현재 기기 세션만 종료한다」).
 *
 * 순서가 계약이다 — **RT 를 꺼내 두고 로컬을 먼저 무효화한 뒤** 서버를 부른다. 서버 호출 뒤에
 * 지우면 느린 네트워크에서 사용자가 앱을 종료했을 때 토큰이 남아 다음 실행에 다시 로그인된다
 * (계정 LLD 검증표 :1005 「outbox/직접 삭제 양쪽 실패에도 RT 폐기·원 세션 로컬 정리 진행」).
 *
 * **AT 는 싣지 않는다**(`auth: false`). AT 만료 + RT 유효는 흔한 상태이고, 만료 AT 를 실으면
 * 서버가 401 로 거절해 **RT 만 보냈으면 폐기됐을 서버 세션이 그대로 남는다**(LLD §2.4 :108
 * 「만료 AT 를 실어 보내면 401 이므로 앱은 RT 만으로 로그아웃할 수 있다」).
 */
export async function logout(): Promise<void> {
  let refreshToken = getSession()?.refreshToken;
  // 로컬 삭제와 서버 폐기는 **서로 독립**이다(LLD §2.4 「양쪽 실패에도 각각 진행」).
  // 여기만 fence 가 **없다** — 401 정리·checkSession 과 달리 사용자가 직접 누른 로그아웃은
  // 그 사이 로그인이 끝났더라도 이겨야 한다. 무엇을 지웠는지는 cleared 로 되받아 교정한다.
  // 로컬을 먼저 끝내되(느린 네트워크 중 앱이 죽어도 토큰이 남지 않는다) 키체인 삭제가
  // 던졌다는 이유로 서버 폐기를 건너뛰지 않는다 — 건너뛰면 서버 세션이 그대로 남는다.
  // clearSession 은 커밋 마커를 먼저 지우고, 실패해도 나머지를 마저 지운 뒤에 던진다.
  const clearFailure = await clearSession().then(
    (cleared) => {
      // 폐기 대상은 «정리 시점»의 세션이다. 진행 중이던 로그인이 줄 앞에서 먼저 공개했으면
      // 위에서 읽은 RT 는 이미 옛 세션의 것이고, 새 세션이 서버에 살아남는다.
      refreshToken = cleared?.refreshToken ?? refreshToken;
      return null;
    },
    (error: unknown) => error ?? new Error('세션 삭제 실패'),
  );
  if (refreshToken) await revokeRefreshToken(refreshToken);
  if (clearFailure) throw clearFailure;
}

export function me(): Promise<Account> {
  return request<Account>('/me');
}

export type SessionCheck =
  | { status: 'active'; account: Account }
  /** 서버가 이 세션을 거절했다 — 답은 재로그인뿐이고 로컬 세션은 비었다. */
  | { status: 'rejected' }
  /** 확인하지 못했을 뿐이다(네트워크·타임아웃·서버 장애). 세션은 그대로 둔다. */
  | { status: 'unreachable' };

/**
 * 저장돼 있던 세션이 아직 살아 있는지 확인한다. 재시작 복구가 쓴다.
 *
 * 「거절」과 「확인 실패」를 가르는 것이 핵심이다:
 *  - **404 `USER_NOT_FOUND`** — 다른 기기에서 탈퇴했다. 계약이 재로그인 분기로 못 박은 코드이고
 *    (LLD §5 :934, §2.5 :247), 401 이 아니라서 client 가 세션을 지우지 않는다 → 여기서 지운다.
 *    빠뜨리면 **탈퇴한 계정으로 홈에 진입한다.**
 *  - **401** — client 가 이미 세션을 비우고 세션 상실을 알렸다.
 *  - **그 밖(네트워크·타임아웃·5xx)** — 확인 실패다. 특히 502 `UPSTREAM_AUTH_FAILED` 는 LLD §5 가
 *    「사용자 로그아웃 유도 금지」로 못 박았다. 오프라인 시작을 막지 않는다.
 */
export async function checkSession(): Promise<SessionCheck> {
  // 확인을 시작한 세대. client 의 401 정리와 **같은 fence** 다 — 응답을 기다리는 사이 로그인이
  // 끝났으면 옛 세션의 거절 판정으로 새 세션을 지우지도, 로그인 화면으로 보내지도 않는다.
  const generation = sessionGeneration();
  try {
    return { status: 'active', account: await me() };
  } catch (thrown) {
    const error = thrown as ApiError;
    // 거절이면 저장본까지 비운다. 401 은 client 가 이미 비운 경우가 대부분이고 중복 호출은
    // 무해하다 — client 가 「우리 AT 거절」만 정리하도록 좁혀졌으므로, 계약 밖 코드로 오는
    // 401 이 「화면만 로그인, 키체인엔 세션」으로 남지 않게 여기서 한 번 더 못 박는다.
    if (error.code === 'USER_NOT_FOUND' || error.status === 401) {
      // 401 은 client 가 **같은 fence 로 이미** 정리했고 그 정리가 세대를 올린다 — 여기서 시작
      // 세대로 다시 fence 를 걸면 스스로 올린 세대에 막힌다. 그래서 「지금 공개된 세션」으로 가른다:
      //  - 없으면(정리 완료·로그아웃) 거절이 맞다. 키체인 삭제가 실패했어도 메모리 세션은 비었다.
      //  - 있으면 우리가 확인한 그 세션일 때만 지운다(404 경로). 그 사이 새 로그인이 공개한
      //    세션이면 fence 에 걸리고, 옛 세션의 거절 판정으로 새 세션을 끊지 않는다.
      if (getSession() === null) return { status: 'rejected' };
      if (await clearRejectedSession(generation)) return { status: 'rejected' };
    }
    return { status: 'unreachable' };
  }
}
