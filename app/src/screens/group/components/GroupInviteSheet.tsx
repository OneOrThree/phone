import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import axios from 'axios';
import { T } from '@/constants/theme';
import { SheetShell } from '@/components/SheetShell';
import { useUser } from '@/store/UserContext';
import { getGroupOverview, getMyGroups, groupErrorCode, joinGroup } from '@/services/groupApi';
import { logGroupJoinAttempted } from '@/services/analyticsEvents';
import type { GroupOverviewResponse } from '@/types/dto/group';
import type { V2RootStackParamList } from '@/navigation/types';

// 초대 링크 프리뷰 시트 — 명세 docs/app/group-plan.md §6-6.
//
// 이 시트가 뜨는 경로(1단계에서 배선 완료):
//   랜딩(§12) → gromo://join?g=<uuid>
//     → RootNavigator의 Linking 수신(getInitialURL / addEventListener)
//     → navigationRef.navigateToDeepLink() 의 'join' 케이스가 parseInviteLink로 groupId 추출
//     → 그룹 탭으로 이동 + 모듈 버퍼에 저장 & 리스너 통지(navigationRef.notifyGroupInvite)
//     → GroupScreen이 리스너/peekPendingInvite로 받아 이 시트를 groupId와 함께 렌더
//   ⚠️ 버퍼 수명은 GroupScreen이 관리한다(onClose/onJoined에서 clearPendingInvite 호출).
//      **이 파일 안에서 navigationRef의 버퍼를 직접 만지지 않는다** — 게스트 로그인 후 복귀가 깨진다.
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
}

// 참여를 막는 사유 — 버튼 비활성 + 안내 문구가 함께 결정된다.
type BlockReason = 'full' | 'otherGroup';

const BLOCK_TEXT: Record<BlockReason, string> = {
  full: '정원이 가득 찼어요',
  otherGroup: '이미 참여 중인 그룹이 있어요. 나가고 참여해주세요.',
};

// 404 판정 — 에러 바디의 code가 원칙이지만(§3-2), 바디 없는 404도 '사라진 그룹'으로 본다.
function isGone(e: unknown): boolean {
  if (groupErrorCode(e) === 'NOT_FOUND') return true;
  return axios.isAxiosError(e) && e.response?.status === 404;
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

export default function GroupInviteSheet({ groupId, onClose, onJoined }: GroupInviteSheetProps) {
  const navigation = useNavigation<NativeStackNavigationProp<V2RootStackParamList>>();
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
  // 조회 완료 시점에 부모 콜백을 부르므로, 콜백 신원 변화로 재조회가 돌지 않게 ref로 잡는다.
  const joinedRef = useRef(onJoined);
  useEffect(() => {
    joinedRef.current = onJoined;
  }, [onJoined]);

  // 내 그룹 1건 조회. 실패는 undefined로 남겨 프리뷰를 막지 않는다(보조 조회).
  const fetchMyGroupId = useCallback(
    () =>
      getMyGroups()
        .then((gs) => gs[0]?.groupId ?? null)
        .catch(() => undefined),
    [],
  );

  // 프리뷰 조회 — 게스트는 호출 전에 차단한다(서버도 403이지만 왕복을 아낀다, §5-3).
  useEffect(() => {
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
    (async () => {
      const mine = await fetchMyGroupId();
      if (!alive) return;
      myGroupId.current = mine;
      try {
        const ov = await getGroupOverview(groupId);
        if (!alive) return;
        setOverview(ov);
        // 이미 멤버 — 프리뷰를 보여줄 이유가 없다. 부모가 시트를 내리고 그룹방으로 전환한다.
        if (ov.isMember) {
          joinedRef.current();
          return;
        }
        if (mine && mine !== groupId) setBlock('otherGroup');
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
    setJoinError(null);
    // 보조 조회가 실패해 내 그룹 상태를 모르면 참여 직전에 다시 확인한다(그룹 1개 전제 방어).
    // 여기서도 실패하면 막지 않는다 — 초대 참여를 네트워크 사정으로 죽이지 않는 쪽을 택한다.
    if (myGroupId.current === undefined) {
      const mine = await fetchMyGroupId();
      myGroupId.current = mine;
      if (mine && mine !== groupId) {
        setBlock('otherGroup');
        return;
      }
    }
    setJoining(true);
    try {
      await joinGroup(groupId);
      logGroupJoinAttempted({ join_method: 'invite' });
      joinedRef.current();
    } catch (e) {
      switch (groupErrorCode(e)) {
        // 이미 멤버 — 성공 취급(§3-2). 링크로 들어온 참여 시도이므로 계측도 동일하게 남긴다.
        case 'ALREADY_MEMBER':
          logGroupJoinAttempted({ join_method: 'invite' });
          joinedRef.current();
          return;
        case 'ROOM_FULL':
          setBlock('full');
          break;
        case 'NOT_FOUND':
          setGone(true);
          break;
        case 'GUEST_FORBIDDEN':
          setGuestBlocked(true);
          break;
        default:
          setJoinError('참여하지 못했어요. 잠시 후 다시 시도해주세요.');
      }
    } finally {
      setJoining(false);
    }
  }, [block, fetchMyGroupId, groupId, joining]);

  // 로그인 유도 — 시트를 닫지 않는다. 로그인하면 앱이 재부팅되고 초대 버퍼가 남아 있어
  // GroupScreen이 같은 그룹으로 이 시트를 다시 띄운다(§6-6 QA: 게스트 링크 진입).
  const goLogin = useCallback(() => {
    navigation.navigate('SettingsAccount');
  }, [navigation]);

  // ── 게스트 — 조회 없이 로그인 유도(§5-3) ──
  if (isGuest || guestBlocked) {
    return (
      <SheetShell onClose={onClose}>
        <Text style={s.title}>로그인하면 그룹에 참여할 수 있어요</Text>
        <Text style={s.desc}>로그인한 뒤 이 초대장이 다시 열려요.</Text>
        <TouchableOpacity style={s.primaryBtn} activeOpacity={0.85} onPress={goLogin}>
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
      <SheetShell onClose={onClose}>
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
      <SheetShell onClose={onClose}>
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
  if (loading || !overview || overview.isMember) {
    return (
      <SheetShell onClose={onClose}>
        <View style={s.loadingBox}>
          <ActivityIndicator color={T.accent} />
        </View>
      </SheetShell>
    );
  }

  const mission = missionLabel(overview);

  // ── 프리뷰 ──
  return (
    <SheetShell onClose={onClose}>
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
          <Text style={s.metaValue}>
            {overview.memberCount} / {overview.maxMembers}명
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
      >
        {joining ? (
          <ActivityIndicator color={T.white} />
        ) : (
          <Text style={[s.primaryText, !!block && s.primaryTextOff]}>참여하기</Text>
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

  notice: { ...T.text.caption, color: T.dangerInk, marginTop: T.space.md },

  primaryBtn: {
    height: 52,
    borderRadius: 16,
    backgroundColor: T.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: T.space.lg,
  },
  primaryBtnOff: { backgroundColor: T.chipBg },
  primaryText: { ...T.text.subtitle, color: T.white },
  primaryTextOff: { color: T.inkMuted },
  ghostBtn: {
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: T.space.xs,
    marginBottom: T.space.xs,
  },
  ghostText: { ...T.text.label, color: T.inkSub },
});
