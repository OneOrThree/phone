// focus 도메인 API 래퍼 (FocusController, base /api/v1).
// 모든 호출은 axios 인스턴스 api(JWT 자동 주입, 401 refresh) 경유. axios는 non-2xx 시 throw.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, getUserIdFromToken } from '@/services/api';
import { STORAGE_KEYS } from '@/types/storage';
import type {
  FocusTagResponse,
  FocusTagSetupRequest,
  FocusTagUpdateRequest,
  FocusSessionRequest,
  FocusSessionResponse,
  FocusSessionSaveResponse,
  FocusSessionSliceResponse,
  FocusSessionStartRequest,
  FocusSessionStartResponse,
  FocusSessionCancelRequest,
  FocusSessionEndRequest,
  FocusSessionEndResponse,
  OccupationDefaultTagsResponse,
} from '@/types/dto/focus';
import type { Occupation } from '@/types/dto/user';

// GET /api/v1/tag — 유저별 집중 태그 목록 조회.
export async function getFocusTags(): Promise<FocusTagResponse[]> {
  const { data } = await api.get<FocusTagResponse[]>('/api/v1/tag');
  return data;
}

// GET /api/v1/tag/defaults?occupation= — occupation별 기본(추천) 태그(과목) 조회.
// occupation 생략 시 서버가 로그인 유저의 저장 occupation을 사용(미설정이면 400).
export async function getDefaultTags(
  occupation?: Occupation,
): Promise<OccupationDefaultTagsResponse> {
  const { data } = await api.get<OccupationDefaultTagsResponse>('/api/v1/tag/defaults', {
    params: occupation ? { occupation } : undefined,
  });
  return data;
}

// POST /api/v1/tag — 태그 초기 등록.
export async function setupFocusTag(body: FocusTagSetupRequest): Promise<void> {
  await api.post('/api/v1/tag', body);
}

// PATCH /api/v1/tag — 태그 수정.
export async function updateFocusTag(body: FocusTagUpdateRequest): Promise<void> {
  await api.patch('/api/v1/tag', body);
}

// DELETE /api/v1/tag/{tagId} — 태그 삭제.
export async function deleteFocusTag(tagId: string): Promise<void> {
  await api.delete(`/api/v1/tag/${tagId}`);
}

// 세션 저장을 앱 전역에서 **한 번에 하나씩** 보내는 체인.
//
// 동시에 보내면 서버가 같은 UserWallet 을 낙관락(@Version)으로 갱신하다 충돌해, 한쪽이 409 로
// 실패하며 세션·통계·지급이 통째로 롤백된다(코덱스 리뷰 P1). 뽀모도로가 실드 해제 후 여러 블록
// 경계를 한꺼번에 정산할 때 실제로 동시 요청이 나간다. 세션 저장은 블록당 1회로 드물어
// 직렬화 비용이 무시할 만하다.
let saveChain: Promise<unknown> = Promise.resolve();

// 지금 저장된 액세스 토큰과 그 주인(JWT sub). 저장이 체인에서 대기하는 동안 계정이 바뀌었는지
// 판별하고, **검증한 그 토큰 그대로** 요청에 실어 보내는 데 쓴다.
async function currentAccessToken(): Promise<{ token: string | null; accountId: string | null }> {
  const token = await AsyncStorage.getItem(STORAGE_KEYS.accessToken);
  return { token, accountId: token ? getUserIdFromToken(token) : null };
}

/**
 * 지금 저장된 토큰의 주인. 저장 경로 밖(부팅 복구 등)에서 **네트워크를 건드리기 전에**
 * 계정 일치를 확인해야 할 때 쓴다 — 전송 직전 대조(commitSession)는 업로드만 막을 뿐,
 * 그 전에 도는 태그 조회·생성까지는 못 막는다.
 */
export function currentAccountId(): Promise<string | null> {
  return currentAccessToken().then(({ accountId }) => accountId);
}

// 계정이 바뀌어 전송을 취소했을 때 던진다 — 호출부는 이 실패를 받아 **저장을 시작한 계정**으로
// 대기열에 넣는다(그래야 나중에 그 계정으로만 올라간다).
export class FocusSaveAccountChangedError extends Error {
  constructor() {
    super('세션 저장 취소 — 대기 중 계정이 전환됨');
    this.name = 'FocusSaveAccountChangedError';
  }
}

// 세션 커밋(POST 저장 · PATCH 마커 종료) 공통 발사대 — 위 saveChain 직렬화 + 계정 대조.
//
// ownerUserId: 이 커밋을 시작한 계정. 직렬화 때문에 전송까지 대기가 생기는데, 그 사이 계정이
// 바뀌면 api 인터셉터가 **전송 시점의 토큰**을 붙여 옛 계정의 세션·보상이 새 계정에 커밋된다.
// 전송 직전에 대조하고, **검증한 그 토큰을 직접 실어** 보낸다 — 대조와 전송 사이에 계정이 바뀌어도
// 인터셉터가 새 토큰으로 갈아끼우지 못하게(코덱스 리뷰 P1). 401 재발급 재시도도 끈다: 재발급
// 토큰은 전환된 계정 것일 수 있어 재시도가 곧 계정 오귀속이 된다. 실패하면 대기열로 간다.
function commitSession<T>(
  ownerUserId: string | null,
  send: (config: Parameters<typeof api.post>[2]) => Promise<{ data: T }>,
): Promise<T> {
  const run = saveChain.then(async () => {
    const { token, accountId } = await currentAccessToken();
    if (accountId !== ownerUserId) {
      throw new FocusSaveAccountChangedError();
    }
    const { data } = await send({
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      _noAuthRetry: true,
    } as Parameters<typeof api.post>[2]);
    return data;
  });
  // 체인은 실패해도 끊기지 않게 삼키고, 호출자에겐 실패를 그대로 전파한다.
  saveChain = run.catch(() => {});
  return run;
}

// POST /api/v1/focus-session — 집중 세션 저장. 응답은 그날 누적·스트릭 서버 판정(GROMO-806).
// 앞선 저장이 끝난 뒤에 보낸다(위 saveChain) — 실패해도 체인은 이어진다.
export function saveFocusSession(
  body: FocusSessionRequest,
  ownerUserId: string | null,
): Promise<FocusSessionSaveResponse> {
  return commitSession(ownerUserId, (config) =>
    api.post<FocusSessionSaveResponse>('/api/v1/focus-session', body, config),
  );
}

// PATCH /api/v1/focus-session — 라이브 마커 종료(GROMO-1214). 서버가 발급한 마커 id를 거쳐
// 시간·코인이 귀속된다. 이미 종료/취소/자동마감된 세션은 409.
// POST 저장과 **같은 체인**에 태운다 — 둘 다 UserWallet(@Version)을 갱신해, 동시에 나가면
// 낙관락 충돌로 한쪽이 통째로 롤백된다(뽀모도로가 여러 블록을 한꺼번에 정산할 때 실제로 겹친다).
export function endFocusSession(
  body: FocusSessionEndRequest,
  ownerUserId: string | null,
): Promise<FocusSessionEndResponse> {
  return commitSession(ownerUserId, (config) =>
    api.patch<FocusSessionEndResponse>('/api/v1/focus-session', body, config),
  );
}

// POST /api/v1/focus-session/start — 라이브 세션 시작(진행 중 레코드 생성, GROMO-873).
// 이 레코드가 친구/리그의 isFocusing·focusStartedAt·focusTagName 라이브 표시의 원천이다.
// 표시용 마커일 뿐이라 시간 저장은 여전히 saveFocusSession(POST)이 담당한다.
export async function startFocusSession(
  body: FocusSessionStartRequest,
): Promise<FocusSessionStartResponse> {
  const { data } = await api.post<FocusSessionStartResponse>('/api/v1/focus-session/start', body);
  return data;
}

// PATCH /api/v1/focus-session/cancel — 진행 중 세션 취소(통계 미귀속). 이미 마감이면 409.
export async function cancelFocusSession(body: FocusSessionCancelRequest): Promise<void> {
  await api.patch('/api/v1/focus-session/cancel', body);
}

// GET /api/v1/focus-session?from&to&cursor?&size — 기간 필터 + 커서(keyset) 페이지네이션 조회.
// from/to는 UTC Instant(ISO 문자열, 필수), cursor 생략 시 첫 페이지, size 필수.
export async function getFocusSessions(
  from: string,
  to: string,
  size: number,
  cursor?: string,
): Promise<FocusSessionSliceResponse> {
  const { data } = await api.get<FocusSessionSliceResponse>('/api/v1/focus-session', {
    params: { from, to, cursor, size },
  });
  return data;
}

// 기간 내 세션 전량 조회 — 커서를 끝까지 따라간다(서버 필터는 startedAt 기준, 재로그인 복원·통계 공용).
// 페이지 상한은 무한 루프 방지용 안전장치 — 50페이지=5,000건이면 한 달 내내 뽀모도로로 쪼개 저장하는
// 헤비유저도 여유(10페이지는 조기 절단 위험, 리뷰 반영).
export async function getAllFocusSessions(
  from: string,
  to: string,
): Promise<FocusSessionResponse[]> {
  const all: FocusSessionResponse[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 50; page++) {
    const slice = await getFocusSessions(from, to, 100, cursor);
    // 진행 중(endedAt null) 세션은 제외 — 라이브 마커 도입(GROMO-873)으로 목록에 섞일 수 있는데,
    // 소비처 전부(복원·통계·주간 합산)가 완료 구간을 전제한다. 취소된 마커는 서버가 제외(GROMO-872).
    all.push(...slice.content.filter((s) => s.endedAt != null));
    if (!slice.hasNext || !slice.nextCursor) break;
    cursor = slice.nextCursor;
  }
  return all;
}
