import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import axios from 'axios';
import { T } from '@/constants/theme';
import { SheetShell, useSheetClose } from '@/components/SheetShell';
import { useUser } from '@/store/UserContext';
import { getGroupOverview, groupErrorCode, joinGroup } from '@/services/groupApi';
import { logGroupInviteSheetViewed, logGroupJoinAttempted } from '@/services/analyticsEvents';
import { getAppInstanceId } from '@/services/analytics';
import type { GroupOverviewResponse } from '@/types/dto/group';
import { acquireJoinLock, releaseJoinLock, useJoinLocked } from '../joinLock';

// 초대 링크 프리뷰 시트 — 명세 docs/app/group-plan.md §6-6.
//
// 이 시트가 뜨는 경로(1단계에서 배선 완료):
//   랜딩(§12) → gromo://join?g=<uuid>
//     → DeepLinkGate의 Linking 수신(getInitialURL / addEventListener) — App.tsx 루트,
//       인증 분기 밖이라 로그인 전에 도착한 링크도 받는다
//     → navigationRef.navigateToDeepLink() 의 'join' 케이스가 parseInviteLink로 groupId 추출
//     → 그룹 탭으로 이동 + 모듈 버퍼에 저장 & 리스너 통지(navigationRef.notifyGroupInvite)
//     → GroupScreen이 리스너/peekPendingInvite로 받아 이 시트를 groupId와 함께 렌더
//   ⚠️ 버퍼 수명은 GroupScreen이 관리한다(onClose/onJoined에서 clearPendingInvite 호출).
//      **이 파일 안에서 navigationRef의 버퍼를 직접 만지지 않는다** — 게스트 로그인 후 복귀가 깨진다.
//      로그인 유도는 onLogin(시트만 내림, 버퍼 유지)이라 onClose(버퍼 삭제)와 역할이 다르다.
//
// 상태 분기(§6-6) — 프리뷰 판정은 getGroupOverview(groupId) 한 번으로 끝낸다.
//   (상세 getGroupDetail은 그룹원만이라 참여 전에 부르면 403 — §3-1-4)
//  | 조건                          | 화면                                                     |
//  |------------------------------|----------------------------------------------------------|
//  | 게스트(useUser().isGuest)     | "로그인하고 참여하기" — 로그인 후 이 시트가 다시 뜬다      |
//  | isMember === true             | 시트 없이 바로 그룹방으로 (onJoined 호출)                  |
//  | memberCount >= maxMembers     | "정원이 가득 찼어요" — 참여 버튼 비활성                    |
//  | 404(NOT_FOUND)                | "사라진 그룹이에요"                                       |
//  | 그 외                         | 그룹명·인원·미션 프리뷰 + '참여하기'                       |
//
// ⚠️ 2차(docs/app/group-plan-2.md §0-6·§3-3)에서 **그룹 1개 전제를 폐기**했다.
// 1차엔 이 시트가 getMyGroups()로 '이미 다른 그룹에 속함'을 사전 차단하고, 확인이 실패하면
// 참여까지 막았다(fail-closed). 멀티 그룹이 열린 지금은 그 가드가 전부 오답이라 걷어냈고,
// 참여 상한은 서버가 판정해 GROUP_LIMIT_EXCEEDED(409)로 알려준다 — 앱은 그 코드만 받아 안내한다.
// (사전 조회가 사라져 시트가 뜨는 속도도 왕복 한 번만큼 빨라졌다.)

export interface GroupInviteSheetProps {
  // 초대 링크에서 뽑은 그룹 UUID(형식 검증 완료 — parseInviteLink 통과값).
  groupId: string;
  // 초대 링크 slug — 어트리뷰션 앵커(초대 링크 스펙 §4-1). 구형 링크로 들어오면 null.
  // 6b 이벤트·group_join_attempted·joinGroup 어트리뷰션에 그대로 실어 보낸다.
  slug: string | null;
  // 이 시트가 열린 경로 — 'link'(링크로 직행) | 'deferred'(설치 후 서버 매치로 복원).
  // join_method가 여기서 갈린다(invite / deferred_invite).
  entry: 'link' | 'deferred';
  // 닫기(딤 탭·취소·사라진 그룹 확인) — 부모가 시트를 내리고 초대 버퍼를 비운다.
  onClose: () => void;
  // 참여 성공 또는 이미 멤버 — 부모가 시트를 내리고 getMyGroups()를 재조회해 그룹방으로 전환한다.
  // ⚠️ **실제로 가입된 그룹 id를 인자로 준다** — 이 시트는 key 없이 재사용돼(GroupScreen) 참여 요청이
  //    떠 있는 동안 두 번째 초대 링크가 도착하면 prop groupId가 갈린다. 부모가 현재 groupId를 목적지로
  //    삼으면 가입한 그룹이 아니라 나중에 온 그룹으로 보내려다 아무 방도 못 여는 결과가 된다.
  onJoined: (joinedGroupId: string) => void;
  // 게스트 로그인 유도 — 부모가 **시트만 내리고 초대 버퍼는 남긴 채** 계정 화면으로 보낸다.
  // ⚠️ onClose와 혼용 금지: onClose는 버퍼까지 비워 로그인 후 복귀(§6-6)가 깨진다.
  //    이 시트는 asModal(RN 네이티브 Modal)이라 내리지 않으면 계정 화면 위에 남아 로그인 버튼을 가린다.
  onLogin: () => void;
}

// 참여를 막는 사유 — 버튼 비활성 + 안내 문구가 함께 결정된다.
//   full    : 프리뷰에서 미리(정원) · 참여 시 ROOM_FULL로도 세워진다
//   limit   : 참여 상한 초과(GROUP_LIMIT_EXCEEDED). 서버만 아는 값이라 참여를 눌러야 드러난다 —
//             같은 초대장에서 다시 눌러도 결과가 같으므로 버튼을 그대로 잠근다.
//   password: 비밀번호 그룹(레거시) — 앱엔 비번을 받을 입구가 없어 프리뷰에서 미리 막는다.
type BlockReason = 'full' | 'limit' | 'password';

const BLOCK_TEXT: Record<BlockReason, string> = {
  full: '정원이 가득 찼어요',
  limit: '참여할 수 있는 그룹 수를 초과했어요',
  // 비밀번호는 폐기 개념(§0)이라 앱은 항상 빈 바디로 join한다 — 기존 비번 그룹은 눌러도
  // WRONG_PASSWORD로만 끝나므로, 눌러 보게 두지 말고 이유를 먼저 말한다.
  password: '비밀번호가 걸린 그룹이라 참여할 수 없어요',
};

// 404 판정 — 에러 바디의 code가 원칙이지만(§3-2), 바디 없는 404도 '사라진 그룹'으로 본다.
function isGone(e: unknown): boolean {
  if (groupErrorCode(e) === 'NOT_FOUND') return true;
  return axios.isAxiosError(e) && e.response?.status === 404;
}

// '이미 이 그룹의 멤버인가' 판정 — 와이어 키 두 개를 함께 흡수한다.
//   현재 서버는 Jackson이 boolean 게터의 'is'를 떼서 `member`로 내려주고(§7 DTO 주석),
//   백엔드가 @JsonProperty("isMember")를 붙이면 `isMember`로 바뀐다.
//   이 시트는 비공개방의 유일한 입구라 어느 쪽이 와도 같은 분기를 타야 한다 —
//   앱/서버 배포 순서가 어긋나도(앱 선배포/후배포 모두) 동작이 변하지 않게 두 키를 다 본다.
// 이 판정이 틀어지면: 이미 멤버가 자기 링크를 열었을 때 참여 프리뷰가 뜨고,
// 정원이 찬 그룹이면 자기 방인데 '정원이 가득 찼어요'로 막힌다.
function readIsMember(ov: GroupOverviewResponse): boolean {
  return ov.isMember ?? ov.member ?? false;
}

// 서버 시각 문자열 → 화면에 쓸 'HH:mm'.
// windowStart/windowEnd는 서버가 KST 벽시계 "HH:mm:ss"로 내려준다(GROMO-1206 — /challenges와
// 동일 계약). 벽시계 문자열은 Date 파싱이 엔진마다 달라 파싱하지 않고 HH:mm만 뽑는다.
// 이 regex 추출은 구서버(Instant ISO를 내려주던 전환기)의 방어선이기도 하다 — ISO가 와도
// 원문에서 HH:mm을 그대로 뽑아 UTC 시각이 찍힐지언정 화면이 깨지진 않는다.
// 종전의 'ISO면 Date로 파싱해 기기 로컬로 변환' 분기는 제거했다 — 창은 KST 고정 개념이라
// 비KST 기기에서 초대 프리뷰만 기기 로컬 시각으로 표시되던 버그가 이 제거로 함께 사라졌다.
// 어느 패턴도 아니면 원문 유지.
function hhmm(v: string): string {
  return /(\d{2}:\d{2})/.exec(v)?.[1] ?? v;
}

// 스크린타임 목표는 '이상'이 아니라 '이하'다 — 초대 프리뷰는 참여를 결정하는 유일한 정보 화면이라
// `목표 · 하루 60분 스크린타임`만 두면 60분을 채우라는 뜻으로 뒤집혀 읽힌다.
// 문구는 그룹 만들기 폼·챌린지 만들기 시트의 캡션과 같은 뜻으로 맞춘다(카테고리 설명은 세 자리 동일).
const SCREEN_TIME_HINT = '하루 스크린타임을 목표 이하로 유지하면 달성이에요';

// 미션 한 줄 요약 — 대표 챌린지가 없으면 null(행을 숨긴다).
function missionLabel(ov: GroupOverviewResponse): string | null {
  const what = ov.missionCategory === 'SCREEN_TIME' ? '스크린타임' : '집중';
  if (ov.missionType === 'DURATION' && ov.durationMinutes) {
    return `하루 ${ov.durationMinutes}분 ${what}`;
  }
  if (ov.missionType === 'TIME_WINDOW' && ov.windowStart && ov.windowEnd) {
    return `매일 ${hhmm(ov.windowStart)}~${hhmm(ov.windowEnd)} ${what}`;
  }
  return null;
}

export default function GroupInviteSheet({
  groupId,
  slug,
  entry,
  onClose,
  onJoined,
  onLogin,
}: GroupInviteSheetProps) {
  const { isGuest } = useUser();

  const [overview, setOverview] = useState<GroupOverviewResponse | null>(null);
  const [loading, setLoading] = useState(!isGuest);
  const [gone, setGone] = useState(false); // 404 — 사라진 그룹
  const [failed, setFailed] = useState(false); // 그 외 조회 실패 — 다시 시도
  const [block, setBlock] = useState<BlockReason | null>(null);
  // 참여 진행 표시(스피너·비활성)는 **전역 잠금**에서 파생시킨다 — 이 시트가 보낸 요청이든
  // 찾기 시트가 보낸 요청이든, 참여가 하나라도 떠 있으면 여기서 또 보낼 수 없다(joinLock.ts).
  const joining = useJoinLocked();
  const [joinError, setJoinError] = useState<string | null>(null);
  // 서버가 GUEST_FORBIDDEN을 준 경우(로그인 시점 태깅이 어긋난 구 세션) 게스트 화면으로 떨어뜨린다.
  const [guestBlocked, setGuestBlocked] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // 지금 이 시트가 보고 있는 groupId. 시트는 key 없이 재사용돼(GroupScreen) 두 번째 초대 링크가
  // 도착하면 groupId만 갈린다 — 진행 중이던 참여 요청이 그 뒤에 끝나면 앞 그룹의 결과를
  // 새 프리뷰에 덮어쓰게 되므로, 참여 시작 시점의 groupId와 비교해 최신일 때만 반영한다.
  const groupIdRef = useRef(groupId);
  // 조회 완료 시점에 부모 콜백을 부르므로, 콜백 신원 변화로 재조회가 돌지 않게 ref로 잡는다.
  const joinedRef = useRef(onJoined);
  useEffect(() => {
    joinedRef.current = onJoined;
  }, [onJoined]);

  // 6b group_invite_sheet_viewed(초대 링크 스펙 §4-3) — 시트가 실제로 화면에 올라간 시점.
  // 조회 완료가 아니라 **마운트**를 기준으로 삼는다: 게스트 로그인 유도·404·정원 초과도 전부
  // 사용자에게 보인 초대장이고, 조회 성공만 세면 실패 구간이 퍼널에서 통째로 사라진다.
  // groupId가 갈리면(두 번째 초대 링크 도착) 새 초대장이므로 다시 발행한다 — 시트는 key 없이
  // 재사용돼(GroupScreen) 마운트가 한 번뿐이라, 의존성으로 세대를 잡지 않으면 두 번째가 유실된다.
  useEffect(() => {
    logGroupInviteSheetViewed({ group_id: groupId, slug: slug ?? undefined, entry });
  }, [groupId, slug, entry]);

  // 프리뷰 조회 — 게스트는 호출 전에 차단한다(서버도 403이지만 왕복을 아낀다, §5-3).
  useEffect(() => {
    groupIdRef.current = groupId;
    if (isGuest) {
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    setGone(false);
    setFailed(false);
    setJoinError(null);
    setBlock(null);
    // 진행 중이던 이전 그룹의 참여 요청은 **끝날 때까지 잠근 채로 둔다**(joinLock.ts). 여기서 풀면
    // 초대 A가 멤버십을 바꾸는 동안 B의 참여 버튼이 살아나 두 요청이 모두 성공한다 — 잠금이 이제
    // 모듈 스코프라 groupId가 갈려도 그대로 유지되고, join()의 finally가 반드시 풀어 준다.
    // guestBlocked도 함께 되돌린다 — 시트는 key 없이 재사용돼(GroupScreen) 두 번째 초대 링크가
    // 도착하면 groupId만 바뀐다. 앞 그룹에서 GUEST_FORBIDDEN으로 세운 값이 남으면 정상 프리뷰를
    // 보여줘야 할 그룹에 게스트 차단 화면이 뜬다.
    setGuestBlocked(false);
    (async () => {
      try {
        const ov = await getGroupOverview(groupId);
        if (!alive) return;
        setOverview(ov);
        // 이미 멤버 — 프리뷰를 보여줄 이유가 없다. 부모가 시트를 내리고 그룹방으로 전환한다.
        if (readIsMember(ov)) {
          // 이 effect가 조회한 그룹을 그대로 넘긴다(alive 가드로 늦은 응답은 이미 버려진다).
          joinedRef.current(groupId);
          return;
        }
        // 종료된 그룹 — 마지막 멤버가 나가면 서버가 close()로 ENDED로 내린다(Group.java).
        // 그런데 서버 join은 상태를 보지 않아, 그냥 두면 ENDED 그룹에 멤버십만 생기는 모순
        // 데이터가 만들어진다. 사용자 입장에선 이미 없어진 방이라 404와 같은 화면으로 끝낸다.
        if (ov.status === 'ENDED') {
          setGone(true);
          return;
        }
        // 비밀번호 그룹은 앱이 참여시킬 수단이 없다(§0에서 비번 폐기) — 정원보다 먼저 막는다.
        // ⚠️ '이미 다른 그룹에 속함'(otherGroup) 차단은 2차에서 멀티 그룹이 열리며 사라졌다.
        //    참여 상한은 서버만 알고, join의 GROUP_LIMIT_EXCEEDED로만 드러난다.
        if (ov.hasPassword) setBlock('password');
        else if (ov.memberCount >= ov.maxMembers) setBlock('full');
      } catch (e) {
        if (!alive) return;
        if (isGone(e)) setGone(true);
        else setFailed(true);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [groupId, isGuest, reloadKey]);

  const join = useCallback(async () => {
    if (block) return;
    // 요청을 띄우기 **전에** 동기적으로 잠근다 — joining(useJoinLocked)은 리렌더 뒤에야 보이므로
    // 같은 틱의 연타를 막지 못한다. 잠그지 않으면 joinGroup이 병렬로 나가고, 첫 요청의 성공과
    // 뒤따르는 ALREADY_MEMBER가 각각 onJoined·계측을 불러 부모 콜백과 분석 이벤트가 중복된다.
    // 잠금을 못 잡으면 다른 참여(찾기 시트 포함)가 진행 중이다 — 버튼은 그동안 스피너·비활성이라
    // 여기 걸리는 건 같은 틱의 연타뿐이므로 문구 없이 조용히 돌려보낸다.
    const token = acquireJoinLock();
    if (!token) return;
    // 이 요청이 겨냥한 그룹. 응답이 오기 전에 두 번째 초대 링크가 도착하면 groupId가 갈리는데,
    // 그때 이 결과(정원·404·오류 문구)를 그대로 반영하면 **다른 그룹의 프리뷰**가 오염된다.
    const target = groupId;
    const isStale = () => groupIdRef.current !== target;
    setJoinError(null);
    try {
      // 계측은 **요청 직전**에 쏜다 — 이름 그대로 '시도'이고, 서버가 소유한 group_joined의
      // 분모다. 성공 뒤로 미루면 ROOM_FULL·404·네트워크 실패가 통째로 빠져 전환율이 항상
      // 100%로 보인다. 2차에서 멀티 그룹이 열리며 '이미 다른 그룹에 속함' 사전 차단이 사라져,
      // 여기까지 온 실행은 곧장 요청으로 이어진다 — 시도 하나에 계측 하나로 맞아떨어진다.
      // join_method는 entry로 갈린다(스펙 §4-3 7) — 'deferred_invite'는 미설치→설치 후
      // 서버 매치로 복원된 초대다. slug는 구형 링크면 없다.
      const joinMethod = entry === 'deferred' ? 'deferred_invite' : 'invite';
      logGroupJoinAttempted({ join_method: joinMethod, slug: slug ?? undefined });
      // 서버가 group_joined([S])를 이 값들로 발행한다(스펙 §4-3 8) — appInstanceId가 있어야
      // 서버 이벤트가 앱 SDK 이벤트와 같은 유저 타임라인에 붙는다(§2-3 ②).
      // 조회 실패는 null 이고, 그때는 필드를 빼고 보낸다(어트리뷰션만 약해질 뿐 참여는 진행).
      const appInstanceId = await getAppInstanceId();
      await joinGroup(target, {
        joinMethod,
        inviteSlug: slug ?? undefined,
        appInstanceId: appInstanceId ?? undefined,
      });
      // 성공만은 세대를 보지 않는다 — 실제로 target에 가입됐으므로 부모가 재조회해 그룹방으로
      // 넘어가야 한다. 여기서 버리면 사용자는 이미 가입한 채 다른 그룹 프리뷰를 계속 보게 된다.
      // 목적지도 현재 prop이 아니라 **이 요청이 겨냥한 target**이다(세대가 갈렸어도 가입된 건 target).
      joinedRef.current(target);
    } catch (e) {
      const code = groupErrorCode(e);
      // 이미 멤버 — 성공 취급(§3-2). 위와 같은 이유로 세대와 무관하게 넘긴다.
      // (계측은 요청 직전에 이미 나갔다 — 여기서 다시 쏘면 한 번의 시도가 두 번으로 세어진다.)
      if (code === 'ALREADY_MEMBER') {
        joinedRef.current(target);
        return;
      }
      // 나머지는 target 프리뷰에만 의미가 있는 실패다 — 시트가 다른 그룹으로 갈렸으면 버린다.
      if (isStale()) return;
      switch (code) {
        case 'ROOM_FULL':
          setBlock('full');
          break;
        // 참여 상한 초과(2차) — 이 초대장으로는 어차피 못 들어간다. 안내하고 버튼을 잠근다.
        case 'GROUP_LIMIT_EXCEEDED':
          setBlock('limit');
          break;
        case 'NOT_FOUND':
          setGone(true);
          break;
        case 'GUEST_FORBIDDEN':
          setGuestBlocked(true);
          break;
        // overview가 hasPassword를 안 실어 준 경우의 뒷문 — 공통 문구 대신 이유를 말한다.
        case 'WRONG_PASSWORD':
          setBlock('password');
          break;
        default:
          setJoinError('참여하지 못했어요. 잠시 후 다시 시도해주세요.');
      }
    } finally {
      // 세대가 갈렸어도 반드시 푼다 — 프리뷰 이펙트는 잠금을 풀지 않으므로(위 주석) 이 잠금을 쥔
      // 것은 이 요청뿐이고, 여기서 놓지 않으면 새 프리뷰의 참여 버튼이 영영 잠긴다.
      releaseJoinLock(token);
    }
    // joining(useJoinLocked)은 표시 전용이라 의존성에 넣지 않는다 — 단일 실행 판정은
    // 모듈 스코프 잠금(joinLock.ts)의 acquire 성공 여부가 한다.
    // slug·entry는 groupId와 한 몸으로 갈리는 값이라 실질적으로 groupId에 종속이지만,
    // 어트리뷰션이 앞 초대장의 값으로 굳는 사고를 막으려 의존성에 그대로 둔다.
  }, [block, groupId, slug, entry]);

  // ── 게스트 — 조회 없이 로그인 유도(§5-3) ──
  // 이동·시트 내리기는 부모(onLogin)가 한다. 시트는 내려도 초대 버퍼는 살아 있어,
  // 로그인으로 앱 트리가 리마운트되면 GroupScreen이 같은 그룹으로 이 시트를 다시 띄운다(§6-6).
  if (isGuest || guestBlocked) {
    return (
      <SheetShell onClose={onClose} asModal>
        <Text style={s.title}>로그인하면 그룹에 참여할 수 있어요</Text>
        <Text style={s.desc}>로그인한 뒤 이 초대장이 다시 열려요.</Text>
        <TouchableOpacity style={s.primaryBtn} activeOpacity={0.85} onPress={onLogin}>
          <Text style={s.primaryText}>로그인하고 참여하기</Text>
        </TouchableOpacity>
        <GhostCloseCta label="다음에 할게요" />
      </SheetShell>
    );
  }

  // ── 404 — 사라진 그룹 ──
  if (gone) {
    return (
      <SheetShell onClose={onClose} asModal>
        <Text style={s.title}>사라진 그룹이에요</Text>
        <Text style={s.desc}>초대 링크가 만료됐거나 그룹이 없어졌어요.</Text>
        <PrimaryCloseCta label="확인" />
      </SheetShell>
    );
  }

  // ── 조회 실패 — 다시 시도 ──
  if (failed) {
    return (
      <SheetShell onClose={onClose} asModal>
        <Text style={s.title}>초대장을 열지 못했어요</Text>
        <Text style={s.desc}>잠시 후 다시 시도해주세요.</Text>
        <TouchableOpacity
          style={s.primaryBtn}
          activeOpacity={0.85}
          onPress={() => setReloadKey((k) => k + 1)}
        >
          <Text style={s.primaryText}>다시 시도</Text>
        </TouchableOpacity>
        <GhostCloseCta label="닫기" />
      </SheetShell>
    );
  }

  // ── 로딩 · isMember 처리 직후(부모가 곧 시트를 내린다) ──
  if (loading || !overview || readIsMember(overview)) {
    return (
      <SheetShell onClose={onClose} asModal>
        <View style={s.loadingBox}>
          <ActivityIndicator color={T.accent} />
        </View>
      </SheetShell>
    );
  }

  const mission = missionLabel(overview);

  // ── 프리뷰 ──
  return (
    <SheetShell onClose={onClose} asModal>
      <Text style={s.title}>그룹 초대장이 도착했어요</Text>
      <Text style={s.desc}>함께 집중할 그룹이에요. 참여하면 바로 시작할 수 있어요.</Text>

      <View style={s.card}>
        <Text style={s.groupName} numberOfLines={2}>
          {overview.name}
        </Text>
        {!!overview.description && (
          <Text style={s.groupDesc} numberOfLines={2}>
            {overview.description}
          </Text>
        )}
        <View style={s.metaRow}>
          <Text style={s.metaLabel}>인원</Text>
          <Text style={s.metaValueNum}>
            {overview.memberCount}/{overview.maxMembers}명
          </Text>
        </View>
        {!!mission && (
          <View style={s.metaRow}>
            <Text style={s.metaLabel}>목표</Text>
            <Text style={s.metaValue}>{mission}</Text>
          </View>
        )}
        {!!mission && overview.missionCategory === 'SCREEN_TIME' && (
          <Text style={s.missionHint}>{SCREEN_TIME_HINT}</Text>
        )}
      </View>

      {!!block && <Text style={s.notice}>{BLOCK_TEXT[block]}</Text>}
      {!!joinError && <Text style={s.notice}>{joinError}</Text>}

      <TouchableOpacity
        style={[s.primaryBtn, (!!block || joining) && s.primaryBtnOff]}
        activeOpacity={0.85}
        disabled={!!block || joining}
        onPress={join}
        testID="group.invite.join"
      >
        {joining ? (
          <ActivityIndicator color={T.white} />
        ) : (
          <Text style={s.primaryText}>참여하기</Text>
        )}
      </TouchableOpacity>
      <GhostCloseCta label="닫기" />
    </SheetShell>
  );
}

// 순수 닫기 CTA — useSheetClose()로 퇴장 애니메이션을 태운 뒤 부모 onClose를 부른다.
// ⚠️ 별도 컴포넌트인 이유: SheetCloseContext는 SheetShell **안쪽**에서 제공되므로,
//    SheetShell을 그리는 컴포넌트 자신은 useSheetClose()를 호출할 수 없다(자식이어야 한다).
// ⚠️ 화면 전환이 따라붙는 CTA(로그인하러 가기·참여하기)는 이관 대상이 아니다 —
//    전환은 즉시 일어나야 하고, 퇴장 220ms가 그만큼 지연시킨다.
function GhostCloseCta({ label }: { label: string }) {
  const close = useSheetClose();
  return (
    <TouchableOpacity style={s.ghostBtn} activeOpacity={0.7} onPress={close}>
      <Text style={s.ghostText}>{label}</Text>
    </TouchableOpacity>
  );
}

function PrimaryCloseCta({ label }: { label: string }) {
  const close = useSheetClose();
  return (
    <TouchableOpacity style={s.primaryBtn} activeOpacity={0.85} onPress={close}>
      <Text style={s.primaryText}>{label}</Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  title: { ...T.text.body, fontWeight: '800', color: T.ink },
  desc: {
    ...T.text.label,
    fontWeight: '500',
    color: T.inkMuted,
    marginTop: 2,
    lineHeight: 19,
  },
  loadingBox: { height: 120, alignItems: 'center', justifyContent: 'center' },

  card: {
    marginTop: T.space.lg,
    padding: T.space.lg,
    borderRadius: 16,
    backgroundColor: T.paperAlt,
    borderWidth: 1,
    borderColor: T.border,
  },
  groupName: { ...T.text.heading, color: T.ink },
  groupDesc: { ...T.text.caption, fontWeight: '500', color: T.inkSub, marginTop: T.space.xs },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: T.space.md,
  },
  // 목표 행 아래 방향 안내 — 그룹 설명(s.groupDesc)과 같은 caption 규격을 쓴다.
  missionHint: { ...T.text.caption, fontWeight: '500', color: T.inkSub, marginTop: T.space.xs },
  metaLabel: { ...T.text.caption, color: T.inkMuted },
  metaValue: { ...T.text.label, color: T.ink },
  metaValueNum: { ...T.text.label, color: T.ink, fontVariant: ['tabular-nums'] },

  notice: { ...T.text.caption, color: T.dangerInk, marginTop: T.space.md },

  primaryBtn: {
    height: 52,
    borderRadius: 16,
    backgroundColor: T.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: T.space.lg,
  },
  // 버튼 비활성은 앱 다수파대로 opacity 하나로 표현한다(토큰 스왑은 카드/타일 상태 표현에만).
  primaryBtnOff: { opacity: 0.5 },
  primaryText: { ...T.text.subtitle, color: T.white },
  ghostBtn: {
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: T.space.xs,
    marginBottom: T.space.xs,
  },
  ghostText: { ...T.text.label, color: T.inkSub },
});
