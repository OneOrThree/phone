// 챌린지 결과 모달의 데이터 선택 + 1회 노출 가드 — 정본 docs/prd/challenge/ (IA §4.3 · LLD §2.1 · N53).
//
// 소스는 참가자 스코프 `GET /me/challenge-results` **하나**다(GROMO-1279, N53) — 그룹 카드
// 조회(오늘/어제 date 재조회)로 결과를 역산하던 구 구조는 폐기됐다:
//   · 요일 반복에서는 챌린지마다 직전 회차일이 달라 "오늘+어제 2건 조회"로는 못 덮는다
//   · 카드 조회는 그룹 멤버십을 검증하므로 탈퇴자가 자기 결과를 영영 못 본다(C8)
//   · 안 본 결과 여럿이 최신 1건으로 접힌다
// 날짜 역산이 사라졌고, 자정 걸침 창 자체가 금지돼(N25) 그 분기도 만들지 않는다.
// 카드의 lastSettledSession(지난 결과 1줄)은 별개 용도로 잔류한다(N53) — 여기서 읽지 않는다.
//
// 노출 가드는 AsyncStorage 1회 마커 `gromo:sessionResult:{userId}:{sessionId}` (IA §8) —
//   · 계정 스코프: 한 기기 두 계정이 같은 회차에 참가할 수 있다(A가 본 결과가 B에게 스킵되면 안 됨)
//   · 값은 sessionDate — 60일 지난 마커를 기록 시점에 정리한다. 서버 큐가 최근 30일 경계라
//     마커가 항상 더 오래 산다(30일 프룬이면 마커가 먼저 지워진 회차가 이미 본 모달로 재생된다).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '@/types/storage';
import { kstDateStr } from '@/utils/localDate';
import type {
  BetSessionStatus,
  BetSessionVoidReason,
  MissionCategory,
  MissionType,
  MyChallengeResultEntry,
} from '@/types/dto/group';

// 모달 한 장이 그릴 결과 — 모달은 표현 전용이고 계산은 여기서 끝낸다.
//
// 결과 명단 한 줄 — 이름과 함께 판정 근거(기록 분)·정산 금액을 들고 간다 (GROMO-1191·1279).
// progressMinutes는 3상을 그대로 옮긴다: 미집계는 null, 실측 0분은 0.
// **0과 null을 뭉개면 '0분 집중'과 '미집계'가 같은 칸으로 보인다**(카드 진행 리스트와 같은 규칙).
// payout도 같은 규칙 — null(미판정·부분 정산 실패)을 0으로 읽으면 판돈을 잃은 것처럼 보인다.
export interface ChallengeResultMember {
  // 렌더 키 — 닉네임은 그룹 안에서 유일하다는 보장이 없다. 카드 진행 리스트도 userId 를 쓴다.
  userId: string;
  nickname: string;
  progressMinutes: number | null;
  payout: number | null;
}

export interface ChallengeResultCandidate {
  sessionId: string;
  challengeId: string;
  groupId: string;
  // 어느 그룹의 결과인가 — 큐가 그룹 무관(참가자 스코프)이라 모달이 그룹 이름을 직접 말해야 한다.
  groupName: string;
  // 회차 날짜(YYYY-MM-DD, KST) — 가드 프룬 기준과 표시 날짜에 함께 쓴다.
  date: string;
  // 정산 결말 — 문구가 갈린다(IA §4.3 "무산·환불도 결과다").
  status: BetSessionStatus;
  voidReason: BetSessionVoidReason | null;
  stake: number;
  pot: number;
  // 판정 기준(분) — 미션 스냅샷. null이면 분모를 지어내지 않고 기록 분만 적는다.
  goalMinutes: number | null;
  // 미션 스냅샷 나머지(GROMO-1583) — 모달의 FOCUS 창 관용치 고지 조건이 읽는다.
  // 스냅샷은 **한 덩어리로** 옮긴다: 창 시각은 지금 모달이 쓰지 않지만, 조각내면 다음 소비자가
  // DTO→후보 배선을 또 해야 하고 그 사이 두 필드가 서로 다른 회차의 값이 될 여지가 생긴다.
  // 전부 선택 필드다 — 구서버 응답에는 없고(undefined), 손으로 후보를 만드는 화면(MenuScreen
  // 디자인 프리뷰)도 생략할 수 있어야 한다. 조건은 '모른다'면 서지 않는다.
  missionCategory?: MissionCategory | null;
  missionType?: MissionType | null;
  windowStart?: string | null;
  windowEnd?: string | null;
  // 달성(achieved=true) · 미달성(false) · 미판정(null) 명단 — 3상을 뭉개지 않는다.
  achievers: ChallengeResultMember[];
  failed: ChallengeResultMember[];
  pending: ChallengeResultMember[];
  // 내 결과 — GA4 achieved 파라미터·헤드라인 분기용. 미판정이면 null.
  myAchieved: boolean | null;
  myPayout: number | null;
  memberCount: number;
}

// 모달을 만들 수 있는 정산 결말 — 이 밖의 상태(OPEN·UNUSED·미래의 신설값)는 방어적으로 버린다.
// OPEN은 계약상 응답에 없고, UNUSED(참가 0명)는 결과·알림에서 제외가 정책이다(N52).
const RESULT_STATUSES: readonly BetSessionStatus[] = ['SETTLED', 'FORFEITED', 'VOIDED', 'REFUNDED'];

// 판정값이 같은 사람만 모아 표시용 줄로 옮긴다 — 순서는 서버가 준 그대로(카드 진행 리스트와 동일).
function members(
  rows: MyChallengeResultEntry['results'],
  achieved: boolean | null,
): ChallengeResultMember[] {
  return rows
    .filter((r) => r.achieved === achieved)
    .map((r) => ({
      userId: r.userId,
      nickname: r.nickname,
      progressMinutes: r.progressMinutes ?? null,
      payout: r.payout ?? null,
    }));
}

// /me/challenge-results 응답 → 모달 후보 큐(가드 반영 전 — 순수 계산).
// 정렬은 sessionDate 내림차순(최근 것부터 — IA §4.3), 동률은 서버 순서 유지(안정 정렬).
// 서버 계약상 이미 걸러져 오는 것들도 방어적으로 다시 거른다:
//   · 삭제된 챌린지의 회차(challengeDeleted) · voidReason=CHALLENGE_DELETED —
//     삭제 환불은 BET_VOID_REFUND 푸시가 알린다(N48). 모달까지 띄우면 같은 사건 이중 통지다.
//   · 결말이 아닌 상태(OPEN 등) · 명단 없는 항목(렌더할 것이 없다)
export function pickChallengeResults(
  entries: MyChallengeResultEntry[],
): ChallengeResultCandidate[] {
  return entries
    .filter(
      (e) =>
        RESULT_STATUSES.includes(e.status) &&
        e.challengeDeleted !== true &&
        e.voidReason !== 'CHALLENGE_DELETED' &&
        Array.isArray(e.results) &&
        e.results.length > 0,
    )
    .map((e) => ({
      sessionId: e.sessionId,
      challengeId: e.challengeId,
      groupId: e.groupId,
      groupName: e.groupName,
      date: e.sessionDate,
      status: e.status,
      voidReason: e.voidReason ?? null,
      stake: e.stake,
      pot: e.pot,
      goalMinutes: e.goalMinutes,
      // undefined(구서버)와 null(창형이 아닌 회차)을 여기서 null로 합친다 — 소비자는 '모른다'
      // 하나만 보면 된다(LastBetResultSheet가 goalMinutes에 쓰는 규칙과 같다).
      missionCategory: e.missionCategory ?? null,
      missionType: e.missionType ?? null,
      windowStart: e.windowStart ?? null,
      windowEnd: e.windowEnd ?? null,
      achievers: members(e.results, true),
      failed: members(e.results, false),
      pending: members(e.results, null),
      myAchieved: e.myAchieved ?? null,
      myPayout: e.myPayout ?? null,
      memberCount: e.results.length,
    }))
    .sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1));
}

function guardKey(userId: string, sessionId: string): string {
  return `${STORAGE_KEYS.sessionResultSeen}:${userId}:${sessionId}`;
}

// 이미 보여준 결과를 걸러낸다. 가드를 못 읽으면 아무것도 노출하지 않되, 그 사실을 **null로
// 구분해서** 돌려준다(codex 후속 리뷰 P2).
//
// ⚠️ 예전엔 읽기 실패도 `[]`(= 볼 것이 없다)로 뭉갰다. 그러면 탈퇴자가 결과 푸시로 들어온
// 경우가 무너진다: 화면(GroupRoomScreen)은 MEMBER_ONLY를 받고 "보여줄 결과가 0건"이라 읽어
// **즉시 onLeft**로 방을 내리는데, 다른 소속 그룹이 없으면 "다음 조회"라는 것 자체가 없어
// 그 정산 결과를 영영 못 본다(N53·C8이 지키려던 바로 그 경로).
// 그래서 '모르겠다'와 '없다'를 같은 값으로 말하지 않는다 — null이면 호출자가 판단을 미룬다.
// 노출 자체는 여전히 보수적이다(이중 노출보다 한 번 거르는 쪽) — null은 '이번엔 아무것도
// 띄우지 않는다 + 없다고 확정하지도 않는다'는 뜻이다.
export async function filterUnseenChallengeResults(
  userId: string,
  candidates: ChallengeResultCandidate[],
): Promise<ChallengeResultCandidate[] | null> {
  if (candidates.length === 0) return candidates;
  try {
    const pairs = await AsyncStorage.multiGet(candidates.map((c) => guardKey(userId, c.sessionId)));
    const seen = new Set(pairs.filter(([, value]) => value !== null).map(([key]) => key));
    return candidates.filter((c) => !seen.has(guardKey(userId, c.sessionId)));
  } catch {
    return null; // 가드 읽기 실패 = 판정 불가
  }
}

// 노출 마커 기록(1회 가드) — **모달이 뜬 순간** 부른다. 닫을 때 기록하면 모달이 떠 있는 사이의
// 재조회(당겨서 새로고침)가 같은 결과를 큐에 또 넣는다. 실패는 삼킨다(다음 노출이 한 번 더 뜰 뿐).
// 함께 60일 지난 마커와 구 형식(gromo:challengeResult:*) 마커를 정리한다.
export function markChallengeResultSeen(userId: string, sessionId: string, date: string): void {
  writeSeenGuard(userId, sessionId, date).catch(() => {});
}

// 프룬 컷오프 — 오늘(KST)로부터 60일 전. 마커 값(sessionDate)이 KST 축이라 컷오프도 같은 축이다.
// KST는 DST가 없어 고정 오프셋 산법으로 충분하다(screentimeSync.epochSecAt과 같은 근거).
const SEEN_RETENTION_DAYS = 60;
function pruneCutoffDate(): string {
  return kstDateStr(new Date(Date.now() - SEEN_RETENTION_DAYS * 86_400_000));
}

async function writeSeenGuard(userId: string, sessionId: string, date: string): Promise<void> {
  // 값 = sessionDate — 키(sessionId)에 날짜가 없어, 값이 없으면 60일 프룬을 판정할 수 없다.
  await AsyncStorage.setItem(guardKey(userId, sessionId), date);
  const cutoff = pruneCutoffDate();
  const prefix = `${STORAGE_KEYS.sessionResultSeen}:`;
  const legacyPrefix = `${STORAGE_KEYS.challengeResultSeen}:`;
  const keys = await AsyncStorage.getAllKeys();
  // 구 형식 마커는 날짜와 무관하게 전부 정리한다 — 새 가드는 세션 id 축이라 다시 읽을 일이 없다.
  const legacy = keys.filter((key) => key.startsWith(legacyPrefix));
  const current = keys.filter((key) => key.startsWith(prefix));
  const pairs = current.length > 0 ? await AsyncStorage.multiGet(current) : [];
  // 값이 날짜가 아닌 마커(깨진 값)도 정리 대상 — 프룬 불능인 채 영영 남는 것보다 낫다
  // (최악은 그 회차 모달이 한 번 더 뜨는 것인데, 서버 큐 30일 경계 밖이면 그마저 없다).
  const stale = pairs
    .filter(([, value]) => value === null || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < cutoff)
    .map(([key]) => key);
  const remove = [...legacy, ...stale];
  if (remove.length > 0) await AsyncStorage.multiRemove(remove);
}
