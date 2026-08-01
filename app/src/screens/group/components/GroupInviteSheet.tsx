import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import axios from 'axios';
import { T } from '@/constants/theme';
import { SheetShell } from '@/components/SheetShell';
import { useUser } from '@/store/UserContext';
import { getGroupOverview, getMyGroups, groupErrorCode, joinGroup } from '@/services/groupApi';
import { logGroupJoinAttempted } from '@/services/analyticsEvents';
import type { GroupOverviewResponse } from '@/types/dto/group';

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
// 여기에 더해 **그룹 1개 전제(§0)** 를 앱이 지킨다 — 백엔드 joinGroup은 이미 다른 그룹에 속한
// 유저를 막지 않으므로(GroupService:207-243) 앱이 getMyGroups()로 사전 차단한다.
// 자동 탈퇴는 시키지 않는다 — "이미 참여 중인 그룹이 있어요. 나가고 참여해주세요."로 안내만 한다.

export interface GroupInviteSheetProps {
  // 초대 링크에서 뽑은 그룹 UUID(형식 검증 완료 — parseInviteLink 통과값).
  groupId: string;
  // 닫기(딤 탭·취소·사라진 그룹 확인) — 부모가 시트를 내리고 초대 버퍼를 비운다.
  onClose: () => void;
  // 참여 성공 또는 이미 멤버 — 부모가 시트를 내리고 getMyGroups()를 재조회해 그룹방으로 전환한다.
  onJoined: () => void;
  // 게스트 로그인 유도 — 부모가 **시트만 내리고 초대 버퍼는 남긴 채** 계정 화면으로 보낸다.
  // ⚠️ onClose와 혼용 금지: onClose는 버퍼까지 비워 로그인 후 복귀(§6-6)가 깨진다.
  //    이 시트는 asModal(RN 네이티브 Modal)이라 내리지 않으면 계정 화면 위에 남아 로그인 버튼을 가린다.
  onLogin: () => void;
}

// 참여를 막는 사유 — 버튼 비활성 + 안내 문구가 함께 결정된다.
type BlockReason = 'full' | 'otherGroup' | 'password';

const BLOCK_TEXT: Record<BlockReason, string> = {
  full: '정원이 가득 찼어요',
  otherGroup: '이미 참여 중인 그룹이 있어요. 나가고 참여해주세요.',
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

// 'HH:mm:ss' · ISO 등 서버 시각 문자열에서 HH:mm만 뽑는다. 형식이 다르면 원문 유지.
function hhmm(v: string): string {
  return /(\d{2}:\d{2})/.exec(v)?.[1] ?? v;
}

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
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  // 서버가 GUEST_FORBIDDEN을 준 경우(로그인 시점 태깅이 어긋난 구 세션) 게스트 화면으로 떨어뜨린다.
  const [guestBlocked, setGuestBlocked] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // 내 그룹 id — undefined는 '아직 모름'(조회 실패). 참여 직전에 한 번 더 확인한다.
  const myGroupId = useRef<string | null | undefined>(undefined);
  // 지금 이 시트가 보고 있는 groupId. 시트는 key 없이 재사용돼(GroupScreen) 두 번째 초대 링크가
  // 도착하면 groupId만 갈린다 — 진행 중이던 참여 요청이 그 뒤에 끝나면 앞 그룹의 결과를
  // 새 프리뷰에 덮어쓰게 되므로, 참여 시작 시점의 groupId와 비교해 최신일 때만 반영한다.
  const groupIdRef = useRef(groupId);
  // 조회 완료 시점에 부모 콜백을 부르므로, 콜백 신원 변화로 재조회가 돌지 않게 ref로 잡는다.
  const joinedRef = useRef(onJoined);
  useEffect(() => {
    joinedRef.current = onJoined;
  }, [onJoined]);

  // 내 그룹 1건 조회. 실패는 undefined('모름')로 남겨 **프리뷰까지는** 막지 않는다(보조 조회).
  // 참여는 모름 상태에서 허용하지 않는다 — join()의 fail-closed 주석 참고.
  const fetchMyGroupId = useCallback(
    () =>
      getMyGroups()
        .then((gs) => gs[0]?.groupId ?? null)
        .catch(() => undefined),
    [],
  );

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
    // 진행 중이던 이전 그룹의 참여 요청이 남아 있어도 새 프리뷰의 버튼은 눌릴 수 있어야 한다
    // (아래 join()이 세대 가드로 늦은 응답을 버린다).
    setJoining(false);
    // guestBlocked도 함께 되돌린다 — 시트는 key 없이 재사용돼(GroupScreen) 두 번째 초대 링크가
    // 도착하면 groupId만 바뀐다. 앞 그룹에서 GUEST_FORBIDDEN으로 세운 값이 남으면 정상 프리뷰를
    // 보여줘야 할 그룹에 게스트 차단 화면이 뜬다.
    setGuestBlocked(false);
    (async () => {
      const mine = await fetchMyGroupId();
      if (!alive) return;
      myGroupId.current = mine;
      try {
        const ov = await getGroupOverview(groupId);
        if (!alive) return;
        setOverview(ov);
        // 이미 멤버 — 프리뷰를 보여줄 이유가 없다. 부모가 시트를 내리고 그룹방으로 전환한다.
        if (readIsMember(ov)) {
          joinedRef.current();
          return;
        }
        // 종료된 그룹 — 마지막 멤버가 나가면 서버가 close()로 ENDED로 내린다(Group.java).
        // 그런데 서버 join은 상태를 보지 않아, 그냥 두면 ENDED 그룹에 멤버십만 생기는 모순
        // 데이터가 만들어진다. 사용자 입장에선 이미 없어진 방이라 404와 같은 화면으로 끝낸다.
        if (ov.status === 'ENDED') {
          setGone(true);
          return;
        }
        // 비밀번호 그룹은 앱이 참여시킬 수단이 없다(§0에서 비번 폐기) — 정원·소속보다 먼저 막는다.
        if (ov.hasPassword) setBlock('password');
        else if (mine && mine !== groupId) setBlock('otherGroup');
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
  }, [groupId, isGuest, reloadKey, fetchMyGroupId]);

  const join = useCallback(async () => {
    if (joining || block) return;
    // 이 요청이 겨냥한 그룹. 응답이 오기 전에 두 번째 초대 링크가 도착하면 groupId가 갈리는데,
    // 그때 이 결과(정원·404·오류 문구)를 그대로 반영하면 **다른 그룹의 프리뷰**가 오염된다.
    const target = groupId;
    const isStale = () => groupIdRef.current !== target;
    setJoinError(null);
    // 보조 조회가 실패해 내 그룹 상태를 모르면 참여 직전에 다시 확인한다(그룹 1개 전제 방어).
    // 여기서도 실패하면 **막는다(fail-closed)** — 통과시키면 이미 다른 그룹에 있는 사용자가
    // 두 그룹에 걸치고, 앱은 groups[0]만 보여줘 나머지 한 곳은 나갈 수도 없는 상태로 남는다(§0).
    if (myGroupId.current === undefined) {
      const mine = await fetchMyGroupId();
      if (isStale()) return;
      myGroupId.current = mine;
      if (mine === undefined) {
        setJoinError('소속 그룹을 확인하지 못했어요. 잠시 후 다시 시도해주세요.');
        return;
      }
      if (mine && mine !== target) {
        setBlock('otherGroup');
        return;
      }
    }
    setJoining(true);
    try {
      await joinGroup(target);
      logGroupJoinAttempted({ join_method: 'invite' });
      // 성공만은 세대를 보지 않는다 — 실제로 target에 가입됐으므로 부모가 재조회해 그룹방으로
      // 넘어가야 한다. 여기서 버리면 사용자는 이미 가입한 채 다른 그룹 프리뷰를 계속 보게 된다.
      joinedRef.current();
    } catch (e) {
      const code = groupErrorCode(e);
      // 이미 멤버 — 성공 취급(§3-2). 위와 같은 이유로 세대와 무관하게 넘긴다.
      if (code === 'ALREADY_MEMBER') {
        logGroupJoinAttempted({ join_method: 'invite' });
        joinedRef.current();
        return;
      }
      // 나머지는 target 프리뷰에만 의미가 있는 실패다 — 시트가 다른 그룹으로 갈렸으면 버린다.
      if (isStale()) return;
      switch (code) {
        case 'ROOM_FULL':
          setBlock('full');
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
      // 늦게 끝난 이전 그룹의 요청이 새 프리뷰의 진행 상태를 건드리지 않게 한다.
      if (!isStale()) setJoining(false);
    }
  }, [block, fetchMyGroupId, groupId, joining]);

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
        <TouchableOpacity style={s.ghostBtn} activeOpacity={0.7} onPress={onClose}>
          <Text style={s.ghostText}>다음에 할게요</Text>
        </TouchableOpacity>
      </SheetShell>
    );
  }

  // ── 404 — 사라진 그룹 ──
  if (gone) {
    return (
      <SheetShell onClose={onClose} asModal>
        <Text style={s.title}>사라진 그룹이에요</Text>
        <Text style={s.desc}>초대 링크가 만료됐거나 그룹이 없어졌어요.</Text>
        <TouchableOpacity style={s.primaryBtn} activeOpacity={0.85} onPress={onClose}>
          <Text style={s.primaryText}>확인</Text>
        </TouchableOpacity>
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
        <TouchableOpacity style={s.ghostBtn} activeOpacity={0.7} onPress={onClose}>
          <Text style={s.ghostText}>닫기</Text>
        </TouchableOpacity>
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
      <TouchableOpacity style={s.ghostBtn} activeOpacity={0.7} onPress={onClose}>
        <Text style={s.ghostText}>닫기</Text>
      </TouchableOpacity>
    </SheetShell>
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
