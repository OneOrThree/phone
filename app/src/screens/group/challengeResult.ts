// 챌린지 결과 모달의 데이터 선택 + 1회 노출 가드 — 계약 contract.md §2 "앱 UI 계약 (A3)".
//
// 신규 서버 API 없이 기존 챌린지 조회를 재사용한다:
//   · 어제 결과 = getChallenges(groupId, 어제) 응답의 memberProgress (그룹방 load()에 1콜 합류)
//   · 오늘 종료된 창형(창 endAt < now) = 이미 받는 오늘 조회의 결과를 **오늘 date로** 사용
//     — 창형은 매일 반복 시간대라(계약 설계 보정) 창이 끝난 순간 오늘 판정이 확정된다.
//     오늘 창이 끝난 챌린지는 어제 결과를 만들지 않는다("오늘 date 결과 사용" = 대체) —
//     하루 한 번 들어오는 사용자에게 같은 챌린지의 모달이 연달아 두 번 뜨는 것을 막는다.
//
// 노출 가드는 AsyncStorage 1회 마커 `gromo:challengeResult:{challengeId}:{date}` —
// 날짜가 지나면 값이 쓸모없어지므로 어제보다 오래된 마커는 기록 시점에 정리한다.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '@/types/storage';
import { kstDateStr, yesterdayStrKst } from '@/utils/localDate';
import { nowSecondsInZone } from '@/utils/challengeTime';
import type {
  ChallengeMemberProgress,
  GroupChallengeResponse,
  MissionCategory,
  MissionType,
} from '@/types/dto/group';
import { categoryLabel, missionLabel } from './components/challengeLabel';

// 창 종료 판정의 벽시계 축 — 서버가 창 시각을 KST로 고정한다(ChallengeCard의 KST_ZONE과 같은 결).
const KST_ZONE = 'Asia/Seoul';

// 모달 한 장이 그릴 결과 — 모달은 표현 전용이고 계산은 여기서 끝낸다.
//
// 결과 명단 한 줄 — 이름과 함께 판정 근거(기록 분)를 들고 간다 (GROMO-1191).
// progressMinutes는 3상을 그대로 옮긴다: FOCUS는 통계가 없어도 0, SCREEN_TIME 미집계는 null.
// **0과 null을 뭉개면 '0분 집중'과 '미집계'가 같은 칸으로 보인다**(카드 진행 리스트와 같은 규칙).
export interface ChallengeResultMember {
  // 렌더 키 — 닉네임은 그룹 안에서 유일하다는 보장이 없다. 카드 진행 리스트도 userId 를 쓴다.
  userId: string;
  nickname: string;
  progressMinutes: number | null;
}

export interface ChallengeResultCandidate {
  challengeId: string;
  // 결과의 기준일(YYYY-MM-DD) — 가드 키와 표시 날짜에 함께 쓴다.
  date: string;
  missionType: MissionType;
  missionCategory: MissionCategory;
  // 챌린지 한 줄 요약(카드·시트와 같은 문장 — challengeLabel).
  label: string;
  // 판정 기준(분). 목표를 모르는 챌린지(구 창·durationMinutes null)는 null —
  // 이때 표기는 분모를 지어내지 않고 기록 분만 적는다.
  goalMinutes: number | null;
  // 달성(achieved=true) · 미달성(false) · 집계 중(null) 명단 — 3상을 뭉개지 않는다.
  achievers: ChallengeResultMember[];
  failed: ChallengeResultMember[];
  pending: ChallengeResultMember[];
  // 내 결과 — GA4 achieved 파라미터용. 명단에 내가 없으면 null.
  myAchieved: boolean | null;
  memberCount: number;
  // 그 날짜에 내기가 걸려 있었나 — 코인 정산 안내 문구를 세우는 조건.
  hadBet: boolean;
}

// 'HH:mm(:ss)'·ISO 등 서버 시각 문자열 → 하루 중 초. 형식을 못 읽으면 null.
// (challengeLabel.hhmm과 같은 방식 — 시각 부분만 뽑아 쓴다.)
function windowEndSeconds(v: string | null | undefined): number | null {
  if (!v) return null;
  const m = /(\d{2}):(\d{2})(?::(\d{2}))?/.exec(v);
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] ?? 0);
}

// createdAt(ISO) → KST 날짜 문자열 — 기준일(date)이 서버 KST 축이라 같은 축으로 비교해야
// "기준일보다 뒤에 만들어졌다" 판정이 어긋나지 않는다(GROMO-1219). 파싱이 깨지면 앞 10글자 폴백.
function createdDateStr(createdAt: string): string {
  const d = new Date(createdAt);
  return Number.isNaN(d.getTime()) ? createdAt.slice(0, 10) : kstDateStr(d);
}

// 챌린지 하나 + 기준일 → 모달 후보. 결과가 없으면 null:
//   · memberProgress가 null/빈 배열 — 진행률 미지원(구서버·TIME_WINDOW 미구현)이거나 값이 없다
//   · 전원 achieved=null — 아직 판정이 하나도 확정되지 않았다(스크린타임 전원 미보고 등).
//     여기서 모달을 띄우고 가드를 태우면 확정 결과를 영영 보여줄 수 없어, 확정이 하나라도
//     생길 때까지 미룬다(다음 조회가 다시 판단한다).
//   · 기준일보다 뒤에 만들어진 챌린지 — 존재하지 않던 날의 "전원 미달성"을 만들지 않는다.
// 판정값이 같은 사람만 모아 표시용 줄로 옮긴다 — 순서는 서버가 준 그대로(카드 진행 리스트와 동일).
function members(
  progress: ChallengeMemberProgress[],
  achieved: boolean | null,
): ChallengeResultMember[] {
  return progress
    .filter((p) => p.achieved === achieved)
    .map((p) => ({
      userId: p.userId,
      nickname: p.nickname,
      progressMinutes: p.progressMinutes,
    }));
}

function toCandidate(
  c: GroupChallengeResponse,
  date: string,
  myUserId: string | null,
): ChallengeResultCandidate | null {
  const progress = c.memberProgress;
  if (!progress || progress.length === 0) return null;
  if (!progress.some((p) => p.achieved !== null)) return null;
  if (createdDateStr(c.createdAt) > date) return null;
  const mine = myUserId ? progress.find((p) => p.userId === myUserId) : undefined;
  return {
    challengeId: c.id,
    date,
    missionType: c.missionType,
    missionCategory: c.missionCategory,
    label: missionLabel(c) ?? categoryLabel(c),
    goalMinutes: c.durationMinutes,
    achievers: members(progress, true),
    failed: members(progress, false),
    pending: members(progress, null),
    myAchieved: mine ? mine.achieved : null,
    memberCount: progress.length,
    hadBet: !!c.bet,
  };
}

// 오늘·어제 챌린지 조회 결과에서 모달 후보를 고른다(가드 반영 전 — 순수 계산).
// 어느 한쪽 조회가 실패했으면 null로 받는다 — 성공한 쪽만으로 가능한 후보를 만든다(화면 무영향 원칙).
// 순서: 어제 결과 → 오늘(창 종료) 결과 — 오래된 소식부터 읽게 한다.
//
// ⚠️ INACTIVE(끝난) 챌린지는 지목(딥링크) 여부와 무관하게 후보가 되지 않는다. 서버가 INACTIVE
//    챌린지의 memberProgress를 **항상 null로 내려주기 때문**이다(GroupChallengeService.
//    isProgressTarget — "끝난 챌린지 목표와 오늘 통계를 대조하면 과거 결과가 매일 바뀌어 보이고,
//    ended_at이 없어 당시 진행률을 복원할 수도 없다"). 여기서 상태 필터만 열어 줘도 toCandidate가
//    progress 없는 항목을 곧바로 버려 아무 효과가 없다(코덱스 리뷰). 종료 푸시가 가리키는 결과는
//    챌린지가 아직 ACTIVE인 동안 확정돼야 한다(창형이 그렇게 동작한다).
export function pickChallengeResults(args: {
  today: GroupChallengeResponse[] | null;
  yesterday: GroupChallengeResponse[] | null;
  todayDate: string;
  yesterdayDate: string;
  now?: Date;
  myUserId: string | null;
}): ChallengeResultCandidate[] {
  const { today, yesterday, todayDate, yesterdayDate, now = new Date(), myUserId } = args;
  // 창 종료 판정은 KST 벽시계다(GROMO-1219) — windowEnd가 그룹 타임존(KST) 시각이라 기기 로컬
  // 벽시계와 비교하면 비KST 기기에서 아직 안 끝난 창을 끝난 것으로(또는 반대로) 읽는다.
  const nowSec = nowSecondsInZone(KST_ZONE, now);

  // 오늘 창이 이미 끝난 창형 — 오늘 date 결과. 자정에 걸친 창(start > end)은 계약 밖이라
  // end 시각만으로 판정한다(창은 하루 안에서 끝나는 것이 생성 규칙).
  const todayByChallenge = new Map<string, ChallengeResultCandidate>();
  for (const c of today ?? []) {
    if (c.status !== 'ACTIVE' || c.missionType !== 'TIME_WINDOW') continue;
    const endSec = windowEndSeconds(c.windowEnd);
    if (endSec === null || nowSec <= endSec) continue;
    const candidate = toCandidate(c, todayDate, myUserId);
    if (candidate) todayByChallenge.set(c.id, candidate);
  }

  const out: ChallengeResultCandidate[] = [];
  for (const c of yesterday ?? []) {
    if (c.status !== 'ACTIVE') continue;
    if (todayByChallenge.has(c.id)) continue; // 창형 당일 결과가 있으면 그쪽을 쓴다(대체)
    const candidate = toCandidate(c, yesterdayDate, myUserId);
    if (candidate) out.push(candidate);
  }
  out.push(...todayByChallenge.values());
  return out;
}

function guardKey(challengeId: string, date: string): string {
  return `${STORAGE_KEYS.challengeResultSeen}:${challengeId}:${date}`;
}

// 이미 보여준 결과를 걸러낸다. 가드를 못 읽으면 아무것도 노출하지 않는다 —
// 같은 결과를 두 번 띄우는 것보다 한 번 거르는 쪽이 낫고, 다음 조회가 다시 시도한다.
export async function filterUnseenChallengeResults(
  candidates: ChallengeResultCandidate[],
): Promise<ChallengeResultCandidate[]> {
  if (candidates.length === 0) return candidates;
  try {
    const pairs = await AsyncStorage.multiGet(
      candidates.map((c) => guardKey(c.challengeId, c.date)),
    );
    const seen = new Set(pairs.filter(([, value]) => value !== null).map(([key]) => key));
    return candidates.filter((c) => !seen.has(guardKey(c.challengeId, c.date)));
  } catch {
    return [];
  }
}

// 노출 마커 기록(1회 가드) — **모달이 뜬 순간** 부른다. 닫을 때 기록하면 모달이 떠 있는 사이의
// 재조회(당겨서 새로고침)가 같은 결과를 큐에 또 넣는다. 실패는 삼킨다(다음 노출이 한 번 더 뜰 뿐).
// 함께 어제보다 오래된 마커를 정리한다 — 지난 날짜의 가드는 다시 쓰일 일이 없다.
export function markChallengeResultSeen(challengeId: string, date: string): void {
  // 가드 기록 실패는 삼킨다 — 다음 진입에서 같은 결과가 한 번 더 뜰 수 있을 뿐, 막을 방법이 없다.
  writeSeenGuard(challengeId, date).catch(() => {});
}

async function writeSeenGuard(challengeId: string, date: string): Promise<void> {
  await AsyncStorage.setItem(guardKey(challengeId, date), '1');
  // 가드 키의 date가 KST 축이므로 prune 기준(어제)도 같은 축이다(GROMO-1219).
  const min = yesterdayStrKst();
  const prefix = `${STORAGE_KEYS.challengeResultSeen}:`;
  const stale = (await AsyncStorage.getAllKeys()).filter(
    (key) => key.startsWith(prefix) && key.slice(key.lastIndexOf(':') + 1) < min,
  );
  if (stale.length > 0) await AsyncStorage.multiRemove(stale);
}
