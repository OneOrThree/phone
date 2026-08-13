import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Platform,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useIsFocused, useNavigation } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { T } from '@/constants/theme';
import { Skeleton, SkeletonGroup } from '@/components/Skeleton';
import { tabBarSafeBottom } from '@/components/tabBarLayout';
import { useUser } from '@/store/UserContext';
import { getMyGroups } from '@/services/groupApi';
import type { LeagueMemberResponse } from '@/types/api';
import type { GroupSummaryResponse } from '@/types/dto/group';
import { STORAGE_KEYS } from '@/types/storage';
import type { V2RootStackParamList } from '@/navigation/types';
import {
  clearPendingInvite,
  peekPendingInvite,
  setGroupInviteListener,
  type PendingInvite,
} from '@/navigation/navigationRef';
import {
  logGroupFindOpened,
  logGroupInviteShared,
  logGroupViewed,
} from '@/services/analyticsEvents';
import { issueInviteLink } from '@/services/inviteLinkApi';
import type { GroupCountBucket } from '@/services/analyticsEvents';
import {
  clearPendingGroupEntry,
  consumeGroupEntry,
  consumeInitialGroupRoomReturn,
  type GroupEntrySource,
} from '@/navigation/groupEntrySource';
import type { CardInteractionContext } from '@/services/cardInteraction';
import GroupListScreen, {
  estimateGroupDeckViewportHeight,
  resolveGroupCardHeight,
} from './GroupListScreen';
import { GROUP_CARD_FLIP_SAFE_INSET } from './components/GroupCardFlip';
import type { GroupCardSummarySnapshot } from './groupCardSummary';
import { isGroupDeckGuideCompletedInSession } from './groupDeckGuide';
import { groupDeckCardWidth } from './groupDeckLayout';
import GroupFindSheet from './components/GroupFindSheet';
import GroupInviteSheet from './components/GroupInviteSheet';
import { buildInviteShareMessage } from './inviteShare';

// 그룹 탭 진입점 — 명세 docs/app/group-plan.md §6-1 + 2차 docs/app/group-plan-2.md §0·§3-1
// + 3차 A-9(D22) "1개부터 목록 먼저". Fakedoor(GROMO-597)를 대체한다.
//
//   진입 → getMyGroups() → 실패 [에러+재시도]
//                        / 성공 <GroupListScreen/> (0건도 그룹 찾기 카드가 있는 목록 화면)
//
// 3차 전까진 소속이 1건이면 그룹방을 이 화면에 내장 렌더했지만, A-9에서 **소속이 1개든
// 여러 개든 항상 목록을 먼저 보여주는** 것으로 통일했다 — 목록 카드를 탭하면 소속 수와
// 무관하게 GroupRoom 라우트로 push 한다(내장 렌더·showList 분기 제거).
// 초대 링크로 들어온 경우엔 어느 분기 위에든 GroupInviteSheet를 덮어 띄운다(§6-6).

function groupCountBucket(count: number): GroupCountBucket {
  if (count === 0) return '0';
  if (count === 1) return '1';
  if (count <= 5) return '2_5';
  if (count <= 10) return '6_10';
  return '11_plus';
}
// 목록 헤더('내 그룹', T.text.title 26pt)의 글자 상자 높이 — 자리표시자가 같은 높이를 차지해야
// 데이터가 도착할 때 카드가 위아래로 밀리지 않는다.
const HEADER_TEXT_H = 30;

// 그룹이 아직 없는 신규 사용자가 카드 사용법을 배울 때만 쓰는 로컬 샘플이다.
// 서버 목록·그룹 순서·이모지 저장소에는 쓰지 않고, 안내가 끝나면 GroupScreen의 기존 빈 화면으로
// 즉시 돌아간다. UUID 모양도 일부러 쓰지 않아 실데이터/API 대상으로 오인하지 않게 한다.
const EMPTY_GUIDE_GROUP: GroupSummaryResponse = {
  groupId: 'guide-preview-group',
  name: '첫 집중 모임',
  description: '함께 집중하고 서로 응원해요',
  code: null,
  currentMembers: 3,
  maxMembers: 6,
  role: 'MEMBER',
  status: 'WAITING',
  isPrivate: false,
};

function emptyGuideSnapshot(userId: string): GroupCardSummarySnapshot<LeagueMemberResponse[]> {
  const members = [
    {
      userId,
      nickname: '나',
      role: 'MEMBER' as const,
      focusTimeMinutes: 24,
      totalFocusMinutes: 24,
    },
    {
      userId: 'guide-preview-member-1',
      nickname: '그로미',
      role: 'OWNER' as const,
      focusTimeMinutes: 40,
      totalFocusMinutes: 40,
    },
    {
      userId: 'guide-preview-member-2',
      nickname: '집중이',
      role: 'MEMBER' as const,
      focusTimeMinutes: 15,
      totalFocusMinutes: 15,
    },
  ];
  return {
    detail: {
      status: 'ready',
      data: {
        id: EMPTY_GUIDE_GROUP.groupId,
        name: EMPTY_GUIDE_GROUP.name,
        description: EMPTY_GUIDE_GROUP.description ?? null,
        missionCategory: null,
        missionType: null,
        durationMinutes: null,
        windowStart: null,
        windowEnd: null,
        maxMembers: EMPTY_GUIDE_GROUP.maxMembers,
        status: EMPTY_GUIDE_GROUP.status,
        members,
        code: null,
        codeExpiresAt: null,
        noticeGrantedUserIds: [],
        isPrivate: false,
      },
    },
    announcements: {
      status: 'ready',
      data: [
        {
          id: 'guide-preview-notice',
          title: '오늘도 같이 집중해요',
          content: '저녁 8시에 한 번 더 모여요.',
          createdAt: '2026-01-01T00:00:00Z',
        },
      ],
    },
    challenges: { status: 'ready', data: [] },
    focus: {
      status: 'ready',
      data: members.map((member, index) => ({
        rank: index + 1,
        userId: member.userId,
        nickname: member.nickname,
        tierLevel: 1,
        totalFocusSeconds: member.totalFocusMinutes * 60,
        isFocusing: index < 2,
        focusTimeMinutes: member.focusTimeMinutes ?? 0,
        focusStartedAt: index < 2 ? '2026-01-01T00:00:00Z' : null,
        focusTagName: index < 2 ? '공부' : null,
      })),
    },
  };
}

export default function GroupScreen() {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [loadingDeckViewportHeight, setLoadingDeckViewportHeight] = useState(() =>
    estimateGroupDeckViewportHeight(windowHeight, insets.top),
  );
  const navigation = useNavigation<NativeStackNavigationProp<V2RootStackParamList>>();
  const isScreenFocused = useIsFocused();
  const { userId } = useUser();

  const [groups, setGroups] = useState<GroupSummaryResponse[] | null>(null);
  const [groupsRevision, setGroupsRevision] = useState(0);
  const [successfulListEpisode, setSuccessfulListEpisode] = useState<number | null>(null);
  // useFocusEffect의 조회는 첫 렌더 뒤 시작된다. 초기값이 false면 서버 응답 전 한 프레임 동안
  // groups=null을 0건 목록으로 오인해 자식의 카드 순서·이모지 저장값을 정리할 수 있다.
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [emptyGuidePreview, setEmptyGuidePreview] = useState(false);
  // mutation(생성·참여) 직후의 전이 중인가 — 성공한 mutation을 후속 GET 실패가 삼키지 않게 한다.
  // 전이 중에는 기존 0건 목록을 그대로 렌더하지 않고 로딩/에러+재시도를 세운다.
  // (그러지 않으면 생성 성공 → GET 실패 시 다시 그룹 찾기 카드가 떠 같은 동작을 반복할 수 있다.)
  const [transitioning, setTransitioning] = useState(false);

  // ── 초대 링크 수신(§6-6) ──────────────────────────────────────────────
  // 시트는 라우트가 아니라 이 화면 위의 오버레이라, 링크 수신은 navigationRef의 모듈 버퍼 +
  // 리스너 계약으로 받는다(navigationRef.ts 상단 주석 참고).
  //  · 마운트 시 peekPendingInvite() — 콜드 스타트에서 화면보다 링크가 먼저 도착한 경우를 이어받는다.
  //    링크로 들어온 뒤 로그인해 앱 트리가 리마운트돼도 버퍼가 남아 같은 그룹으로 복귀한다.
  //  · 버퍼를 비우는 곳은 여기뿐 — 시트가 닫히거나(onClose) 참여가 끝났을 때(onJoined)만 clear.
  // 버퍼가 slug·entry까지 들고 온다(초대 링크 스펙 §7-3) — 시트가 6b 이벤트·join 어트리뷰션에 쓴다.
  const [invite, setInvite] = useState<PendingInvite | null>(() => peekPendingInvite());

  useEffect(() => {
    setGroupInviteListener((next) => {
      // 초대 시트와 찾기 시트는 상호 배타 — 둘 다 SheetShell이라 겹치면 딤이 2겹으로 포개진다.
      // 링크로 들어온 초대가 우선(사용자가 방금 밖에서 받은 맥락)이라 찾기 시트를 내린다.
      setFindOpen(false);
      setInvite(next);
    });
    return () => setGroupInviteListener(null);
  }, []);

  // 요청 시퀀스 — 포커스마다 조회가 나가므로 탭을 빠르게 오가면 이전 응답이 늦게 도착해
  // 최신 목록을 덮을 수 있다(생성/참여 직후 빈 상태로 되돌아 보이는 형태).
  // 최신 요청의 결과만 반영한다(useFriends.ts의 requestSeqRef와 같은 패턴).
  const requestSeqRef = useRef(0);

  // group_viewed는 성공한 전체 목록이 확정된 뒤 view episode당 한 번만 발행한다.
  // 첫 마운트의 기본 진입은 tab, 이후 child/다른 화면에서 돌아온 focus는 return이며,
  // 실제 새 focus를 만든 외부 진입만 navigationRef가 넣은 invite|push를 한 번 소비한다.
  const hasFocusedRef = useRef(false);
  const nextFocusFromTabRef = useRef(false);
  const viewEpisodeRef = useRef<{ id: number; source: GroupEntrySource; logged: boolean }>({
    id: 0,
    source: 'unknown',
    logged: false,
  });

  // 같은 GroupScreen 인스턴스가 유지돼도 다른 탭에서 그룹 버튼을 누른 재진입은 `tab`이다.
  // 자식 스택에서 돌아오는 focus에는 tabPress가 없으므로 `return`과 구분할 수 있다.
  useEffect(() => {
    const tabNavigation = navigation as unknown as {
      addListener: (event: 'tabPress', listener: () => void) => () => void;
      isFocused: () => boolean;
    };
    return tabNavigation.addListener('tabPress', () => {
      // 이미 선택된 그룹 탭 재선택은 새 episode를 만들지 않으므로 다음 focus에 남기지 않는다.
      // focus 중 열린 warm invite로 돌아오는 동작도 정책상 `return`이므로 tab 표식을 만들지 않는다.
      if (!tabNavigation.isFocused() && !peekPendingInvite()) nextFocusFromTabRef.current = true;
    });
  }, [navigation]);

  // 초대 링크가 가리킨 그룹방 — 참여(또는 '이미 멤버') 판정 뒤 재조회가 끝날 때까지 목적지를 들고 있는다.
  // 재조회하면 목록이 기본 화면이라(A-9), 이 값을 잃으면 초대 링크가 '목록 열기'로 전락한다.
  const pendingRoomIdRef = useRef<string | null>(null);

  // 내 그룹 조회.
  const fetchGroups = useCallback(async () => {
    const seq = ++requestSeqRef.current;
    setLoading(true);
    setError(false);
    try {
      const rows = await getMyGroups();
      if (seq !== requestSeqRef.current) return;
      setGroups(rows);
      setSuccessfulListEpisode(viewEpisodeRef.current.id);
      setGroupsRevision((revision) => revision + 1);
      const episode = viewEpisodeRef.current;
      if (!episode.logged) {
        episode.logged = true;
        logGroupViewed({
          group_entry: episode.source,
          group_count_bucket: groupCountBucket(rows.length),
        });
      }
      // 최신 목록을 받은 시점에만 전이가 끝난다 — 실패 때 풀면 빈 상태로 되돌아간다.
      setTransitioning(false);
    } catch {
      if (seq !== requestSeqRef.current) return;
      setError(true);
    } finally {
      if (seq === requestSeqRef.current) setLoading(false);
    }
  }, []);

  // mutation 성공 직후의 재조회 — 결과가 올 때까지(또는 실패가 확정될 때까지) 빈 상태를 렌더하지 않는다.
  const fetchAfterMutation = useCallback(() => {
    setTransitioning(true);
    fetchGroups();
  }, [fetchGroups]);

  // 포커스마다 재조회 — 생성/참여 직후(스택 pop·시트 닫힘) 그룹방으로 즉시 전환된다. 진입 계측도 여기서.
  // cleanup에서 시퀀스를 올려 진행 중이던 요청을 무효화한다 — 화면을 떠난 뒤 setState가 도는 것을 막는다.
  useFocusEffect(
    useCallback(() => {
      const returnedFromInitialRoom = consumeInitialGroupRoomReturn();
      const fallback: GroupEntrySource = returnedFromInitialRoom
        ? 'return'
        : !hasFocusedRef.current || nextFocusFromTabRef.current
          ? 'tab'
          : 'return';
      nextFocusFromTabRef.current = false;
      hasFocusedRef.current = true;
      viewEpisodeRef.current = {
        id: viewEpisodeRef.current.id + 1,
        // focus 시작 시 direct source를 이 episode가 소유한다. 조회 실패 후 같은 episode에서
        // 재시도할 때는 ref의 값을 유지하되, 다음 일반 진입으로 source를 흘리지 않는다.
        source: consumeGroupEntry(fallback),
        logged: false,
      };
      setSuccessfulListEpisode(null);
      fetchGroups();
      return () => {
        requestSeqRef.current++;
      };
    }, [fetchGroups]),
  );

  // ⚠️ 시트 퇴장 애니메이션(220ms) **뒤에** 불린다. 그 사이 새 초대 링크가 도착해 시트 내용이
  //    B로 바뀌었을 수 있는데, 확인 없이 지우면 방금 온 초대장이 조용히 증발한다(codex 리뷰).
  //    닫기를 요청한 초대가 지금도 떠 있는 그 초대일 때만 버퍼를 비운다.
  //    인자 없이 부르면 "무조건 닫기"다 — 참여 성공(onInviteJoined)처럼 어떤 초대가 떠 있든
  //    시트를 내려야 하는 경로에서 쓴다.
  const inviteRef = useRef(invite);
  inviteRef.current = invite;
  const closeInvite = useCallback((requested?: PendingInvite | null) => {
    const current = inviteRef.current;
    // ⚠️ groupId로 식별한다. slug는 구형 초대 링크에서 null이라, 구형 링크 두 개가 220ms 안에
    //    연달아 오면 둘 다 null이어서 비교를 통과해 버린다(codex 리뷰). 초대의 본체는 groupId다.
    if (requested && current && current.groupId !== requested.groupId) return;
    clearPendingInvite();
    clearPendingGroupEntry();
    setInvite(null);
  }, []);

  // 초대로 참여 완료 — 버퍼를 비우고 재조회해 **그 초대장이 가리킨** 그룹방으로 전환한다.
  // ⚠️ 목적지를 ref로 옮긴 뒤에 버퍼를 비운다. 그러지 않으면 초대 링크를 열었을 때(참여 성공·
  //    이미 멤버 모두 이 콜백을 탄다) 재조회 후 목록만 떠서(A-9에서 목록이 항상 기본 화면)
  //    링크가 가리킨 방으로 못 간다 — 목적지 소비는 아래 useEffect가 맡는다.
  // ⚠️ 목적지는 현재 invite.groupId가 아니라 **시트가 알려준 실제 가입 그룹**이다. 참여 요청이 떠 있는
  //    동안 두 번째 초대 링크가 도착하면 시트의 groupId(=invite.groupId)만 갈리는데, 시트는 성공을
  //    세대와 무관하게 통지한다(가입은 실제로 일어났으므로). 여기서 invite.groupId를 쓰면 가입한 A 대신
  //    나중에 온 B로 가려다, B가 아직 내 목록에 없어 아무 방도 열지 못한다.
  const onInviteJoined = useCallback(
    (joinedGroupId: string) => {
      pendingRoomIdRef.current = joinedGroupId;
      closeInvite();
      fetchAfterMutation();
    },
    [closeInvite, fetchAfterMutation],
  );

  // 초대 목적지 소비 — 목록을 새로 받은 시점에만 판정한다(참여 직후 목록엔 그 그룹이 들어 있다).
  // A-9 이후 목록이 항상 기본 화면이라 소속 수와 무관하게 그룹방을 push 한다(목록 카드 탭과 같은 분기).
  // 목록에 목적지가 없으면(참여가 실제로 반영되지 않음) 아무 데도 보내지 않고 소비만 한다 —
  // 남겨 두면 이후 아무 재조회에서나 뒤늦게 튀어 나간다.
  useEffect(() => {
    const target = pendingRoomIdRef.current;
    if (target === null || groups === null) return;
    pendingRoomIdRef.current = null;
    if (!groups.some((g) => g.groupId === target)) return;
    // challengeId를 **명시로 비운다** — 스택에 이미 GroupRoom이 있으면 파라미터가 병합돼
    // 직전 딥링크(챌린지 종료 푸시)의 지목이 이 방으로 새어 든다(types.ts GroupRoom 주석).
    navigation.navigate('GroupRoom', {
      groupId: target,
      challengeId: undefined,
      // 환불 안내 표식도 같은 이유로 명시로 비운다(GROMO-1579 — types.ts GroupRoom 주석).
      refundNotice: undefined,
      entrySource: 'invite',
      interactionId: undefined,
      interactionAcceptedAt: undefined,
    });
  }, [groups, navigation]);

  // 검색으로 참여 완료 — 시트를 닫고 재조회.
  const onFindJoined = useCallback(() => {
    setFindOpen(false);
    fetchAfterMutation();
  }, [fetchAfterMutation]);

  // 목록에서 그룹을 골랐다 — A-9 이후 목록이 항상 기본 화면이라 소속 수와 무관하게 그룹방을
  // 스택에 push 한다(목록 화면은 스스로 navigate 하지 않고 이 콜백에 위임한다).
  const onSelectGroup = useCallback(
    (
      groupId: string,
      entrySource: 'group_card' | 'group_find' | 'unknown' = 'unknown',
      interaction?: CardInteractionContext,
    ) => {
      // 위 초대 목적지 소비와 같은 이유로 challengeId를 명시로 비운다(types.ts GroupRoom 주석).
      navigation.navigate('GroupRoom', {
        groupId,
        challengeId: undefined,
        refundNotice: undefined,
        entrySource,
        interactionId: interaction?.interactionId,
        interactionAcceptedAt: interaction?.interactionAcceptedAt,
      });
    },
    [navigation],
  );

  const onStartGroupFocus = useCallback(
    (groupId: string, interaction: CardInteractionContext) =>
      navigation.navigate('FocusCategory', {
        initialGroupId: groupId,
        entrySource: 'group_card',
        interactionId: interaction.interactionId,
        interactionAcceptedAt: interaction.interactionAcceptedAt,
      }),
    [navigation],
  );

  const onOpenGroupSettings = useCallback(
    (groupId: string) => navigation.navigate('GroupSettings', { groupId }),
    [navigation],
  );

  const onInviteToGroup = useCallback(async (groupId: string, groupName: string) => {
    let issuedInvite: { slug: string; url: string };
    try {
      issuedInvite = await issueInviteLink(groupId);
    } catch {
      Alert.alert('초대 링크를 만들지 못했어요', '잠시 후 다시 시도해 주세요.');
      return;
    }
    try {
      const result = await Share.share({
        message: buildInviteShareMessage(groupName, issuedInvite.url),
      });
      if (result.action === Share.sharedAction) {
        logGroupInviteShared({
          share_method: 'share_sheet',
          confirmed: Platform.OS === 'ios',
          slug: issuedInvite.slug,
          group_id: groupId,
        });
      }
    } catch {
      // 공유 시트를 띄우지 못한 경우 화면 상태는 그대로 유지한다.
    }
  }, []);

  // 찾기 시트의 '참여 중' 행 탭 — 참여가 아니라 이동이라 목록 카드 탭과 같은 분기(그룹방 push)를 탄다.
  const onOpenGroup = useCallback(
    (groupId: string) => {
      setFindOpen(false);
      onSelectGroup(groupId, 'group_find');
    },
    [onSelectGroup],
  );

  // 그룹 만들기 진입 — 돌아왔을 때의 포커스 재조회를 전이로 취급한다.
  // 만들지 않고 돌아온 경우에도 손해는 없다(조회에 성공하면 그대로 0건 목록으로 돌아간다).
  const openCreate = useCallback(() => {
    setTransitioning(true);
    navigation.navigate('GroupCreate');
  }, [navigation]);

  const myGroups = useMemo(() => groups ?? [], [groups]);
  const previewSnapshot = useMemo(
    () => (userId ? emptyGuideSnapshot(userId) : undefined),
    [userId],
  );

  // 카드가 하나도 없는 첫 사용자도 설명을 볼 수 있게 완료 key를 먼저 확인한다. 샘플 카드는 이
  // 상태가 true인 동안만 렌더되며, 실제 그룹이 생기거나 안내를 마치는 즉시 폐기된다.
  useEffect(() => {
    if (
      !userId ||
      groups === null ||
      groups.length > 0 ||
      successfulListEpisode !== viewEpisodeRef.current.id ||
      isGroupDeckGuideCompletedInSession()
    ) {
      setEmptyGuidePreview(false);
      return;
    }
    let canceled = false;
    AsyncStorage.getItem(STORAGE_KEYS.guideGroupDeck)
      .then((value) => {
        if (!canceled) setEmptyGuidePreview(value !== '1');
      })
      .catch(() => {
        // GroupListScreen의 세션 1회 fallback 정책이 실제 노출 여부를 최종 결정한다.
        if (!canceled) setEmptyGuidePreview(true);
      });
    return () => {
      canceled = true;
    };
  }, [groups, successfulListEpisode, userId]);

  const openFind = useCallback((entryPoint: 'list' | 'header' | 'end_card') => {
    logGroupFindOpened({ entry_point: entryPoint });
    setFindOpen(true);
  }, []);

  // 찾기 시트는 헤더·덱 마지막 카드 진입점에서 함께 쓴다 — 어느 쪽에서 열어도 같은 시트다.
  // 소속 판정 기준(groups)은 여기서 내려준다 — 시트가 따로 조회하면 부모와 스냅샷이 갈린다.
  const findSheet = findOpen ? (
    <GroupFindSheet
      groups={myGroups}
      onClose={() => setFindOpen(false)}
      onJoined={onFindJoined}
      onOpenGroup={onOpenGroup}
    />
  ) : null;

  const inviteSheet = invite ? (
    // ⚠️ key로 초대별 인스턴스를 분리한다. 초대 A의 퇴장(220ms) 안에 B가 도착하면 세대 검증이
    //    B의 상태는 지켜 주지만, key가 없으면 B가 **퇴장을 마친 같은 SheetShell을 재사용**한다
    //    — translateY는 화면 밖, dim 0, closingRef=true, pointerEvents='none' 상태 그대로라
    //    B가 보이지도 닫히지도 않는다(codex 리뷰).
    <GroupInviteSheet
      key={invite.groupId}
      groupId={invite.groupId}
      slug={invite.slug}
      entry={invite.entry}
      onClose={() => closeInvite(invite)}
      onJoined={onInviteJoined}
    />
  ) : null;

  // 기존 데이터가 있는 재조회 실패 — 화면을 갈아엎지 않고 인라인 배너로 알린다.
  // 무음으로 두면 방금 만든/참여한 그룹이 없는 화면을 보고 같은 동작을 반복하게 된다.
  const staleNotice =
    error && !transitioning && groups !== null ? (
      <View style={s.banner}>
        <Text style={s.bannerText}>목록을 새로고침하지 못했어요</Text>
        <TouchableOpacity onPress={() => fetchGroups()} hitSlop={12} activeOpacity={0.7}>
          <Text style={s.bannerRetry}>다시 시도</Text>
        </TouchableOpacity>
      </View>
    ) : null;

  // ── 최초 로딩 — 중앙 스피너(§5-4). 목록을 한 번이라도 받았으면 절대 갈아끼우지 않는다. ──
  // 전이(생성 화면 왕복·참여 직후)도 여기서 제외한다: 만들지 않고 그냥 돌아와도 보고 있던
  // 그룹방/목록이 통째로 스피너로 바뀌어 화면이 깜빡였다. 그룹방(GroupRoomScreen)의
  // 'loading && !detail' 정책과 같은 기준으로 맞춘다.
  // transitioning의 원래 목적(성공한 mutation을 후속 GET 실패가 삼키는 것 방지)은
  // 아래 **에러 가드**에 그대로 남아 있어 지켜진다.
  if (groups === null && loading) {
    const loadingCardHeight = resolveGroupCardHeight(loadingDeckViewportHeight, insets.bottom);
    return (
      <SafeAreaView style={s.root} edges={['top']} testID="group.screen">
        {/* 중앙 스피너 대신 캐러셀 실루엣(GROMO-1381) — 헤더 + 300pt 카드 + 다음 카드 peek로,
            도착할 가로 덱과 같은 방향·높이를 미리 잡는다. 데이터가 오면 이 분기가 통째로 사라지므로
            펄스(무한 루프)도 함께 언마운트된다.
            묶음 전체를 SkeletonGroup 하나로 감싸 펄스를 이 한 겹에만 건다 — 블록마다 루프를
            돌리면 "화면당 무한 루프 1개" 상한을 위반한다(codex 리뷰). */}
        <SkeletonGroup style={s.skeletonGroup} testID="group.list.skeleton">
          <View style={s.skeletonHeader}>
            <Skeleton w={110} h={HEADER_TEXT_H} radius={8} />
          </View>
          <View
            style={s.skeletonDeck}
            testID="group.deck.skeleton"
            onLayout={(event) => {
              const next = event.nativeEvent.layout.height;
              setLoadingDeckViewportHeight((current) => (current === next ? current : next));
            }}
          >
            <View
              style={[s.skeletonCard, { width: groupDeckCardWidth(windowWidth) }]}
              testID="group.deck.skeleton.cardSurface"
            >
              <Skeleton
                w="100%"
                h={loadingCardHeight}
                radius={22}
                testID="group.deck.skeleton.card"
              />
            </View>
            <View
              style={[s.skeletonCard, { width: groupDeckCardWidth(windowWidth) }]}
              testID="group.deck.skeleton.peekSurface"
            >
              <Skeleton
                w="100%"
                h={loadingCardHeight}
                radius={22}
                testID="group.deck.skeleton.peek"
              />
            </View>
          </View>
        </SkeletonGroup>
        {inviteSheet}
      </SafeAreaView>
    );
  }

  // ── 에러 + 다시 시도 — 목록을 한 번도 못 받았거나, mutation 전이가 실패로 끝난 경우 ──
  if ((groups === null || transitioning) && error) {
    return (
      <SafeAreaView style={s.root} edges={['top']} testID="group.screen">
        <View style={[s.body, { paddingBottom: tabBarSafeBottom(insets.bottom) }]}>
          <Text style={s.title}>그룹을 불러오지 못했어요</Text>
          <Text style={s.desc}>잠시 후 다시 시도해 주세요.</Text>
          <TouchableOpacity style={s.retryBtn} activeOpacity={0.85} onPress={() => fetchGroups()}>
            <Text style={s.retryText}>다시 시도</Text>
          </TouchableOpacity>
        </View>
        {inviteSheet}
      </SafeAreaView>
    );
  }

  // 그룹 0개 첫 진입 — 실제 카드와 같은 컴포넌트에 로컬 snapshot만 주입해 잠시 설명한다.
  // 마지막 '시작'에서 임시 카드를 버리고 최신 main의 원래 0건 목록(그룹 찾기 카드)으로 복귀한다.
  if (emptyGuidePreview && previewSnapshot) {
    return (
      <SafeAreaView style={s.root} edges={['top']} testID="group.screen">
        {staleNotice}
        <GroupListScreen
          groups={[EMPTY_GUIDE_GROUP]}
          groupsRevision={groupsRevision}
          isScreenFocused={isScreenFocused}
          userId={userId}
          onSelect={() => undefined}
          onCreate={openCreate}
          onFind={(entryPoint) => openFind(entryPoint)}
          onRefresh={fetchGroups}
          guideBlocked={findOpen || invite !== null}
          guideScreenFocused={isScreenFocused}
          guideEpisode={viewEpisodeRef.current.id}
          groupEntry={viewEpisodeRef.current.source}
          guideDataReady={successfulListEpisode === viewEpisodeRef.current.id}
          guideDataFailed={error && successfulListEpisode !== viewEpisodeRef.current.id}
          actualGroupCount={0}
          guideSnapshot={previewSnapshot}
          onEnsureBack={() => undefined}
          onGuideFinish={() => setEmptyGuidePreview(false)}
          initialDeckViewportHeight={loadingDeckViewportHeight}
        />
        {findSheet}
        {inviteSheet}
      </SafeAreaView>
    );
  }

  // ── 목록(0건 이상) — 소속 수와 무관하게 항상 목록이 기본 화면이다. ──
  // 0건이면 GroupListScreen이 그룹 카드 대신 그룹 찾기 카드 한 장을 그린다. 그룹 카드 탭은
  // onSelectGroup에서 GroupRoom 라우트로 push 한다. 탭 첫 화면이므로 헤더 백버튼은 두지 않는다.
  return (
    <SafeAreaView style={s.root} edges={['top']} testID="group.screen">
      {staleNotice}
      <GroupListScreen
        groups={myGroups}
        groupsRevision={groupsRevision}
        isScreenFocused={isScreenFocused}
        userId={userId}
        onSelect={(groupId, interaction) => onSelectGroup(groupId, 'group_card', interaction)}
        onCreate={openCreate}
        onFind={(entryPoint) => openFind(entryPoint)}
        onStartFocus={onStartGroupFocus}
        onOpenSettings={onOpenGroupSettings}
        onInvite={onInviteToGroup}
        onRefresh={fetchGroups}
        guideBlocked={findOpen || invite !== null}
        guideScreenFocused={isScreenFocused}
        guideEpisode={viewEpisodeRef.current.id}
        groupEntry={viewEpisodeRef.current.source}
        guideDataReady={successfulListEpisode === viewEpisodeRef.current.id}
        guideDataFailed={error && successfulListEpisode !== viewEpisodeRef.current.id}
        initialDeckViewportHeight={loadingDeckViewportHeight}
      />
      {findSheet}
      {inviteSheet}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  // 탭 화면은 흰 캔버스 — 홈·리그·전체와 같은 배경이라야 탭 전환에서 배경이 튀지 않는다.
  // (그룹의 스택 화면 GroupCreate·GroupNotice는 FriendAdd·알림과 같은 T.bg를 유지한다.)
  root: { flex: 1, backgroundColor: T.paperLight },
  // 로딩 자리표시자 — 여백은 GroupListScreen의 header·listContent와 같은 값이어야 자리가 맞는다.
  skeletonGroup: { flex: 1 },
  skeletonHeader: {
    paddingHorizontal: T.space.xl,
    paddingTop: T.space.sm,
    paddingBottom: T.space.md,
    minHeight: 68,
  },
  skeletonDeck: {
    flex: 1,
    flexDirection: 'row',
    gap: 12,
    paddingLeft: 24,
    paddingVertical: GROUP_CARD_FLIP_SAFE_INSET,
    overflow: 'hidden',
  },
  skeletonCard: {},
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: T.space.xxl,
  },
  title: { ...T.text.title, color: T.ink, marginTop: T.space.xl, textAlign: 'center' },
  desc: {
    ...T.text.body,
    color: T.inkSub,
    marginTop: T.space.sm,
    marginBottom: T.space.xxl,
    textAlign: 'center',
  },
  // 인라인 재시도 = 48 / r16 / px xxl — 그룹방·공지 화면과 같은 값을 쓴다(§G-4).
  // 화면 CTA(52/stretch)와 구분해 "조회 실패 복구"라는 역할을 규격으로 드러낸다.
  retryBtn: {
    minHeight: 48,
    paddingVertical: T.space.md,
    paddingHorizontal: T.space.xxl,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: T.accent,
  },
  retryText: { ...T.text.label, color: T.white },

  // 재조회 실패 인라인 배너 — 문구는 그룹 화면 공통 s.notice 규격(caption/dangerInk),
  // 재시도 링크는 '모두보기'와 같은 accent 링크 규격을 쓴다(§G-4).
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: T.space.xl,
    paddingTop: T.space.sm,
  },
  bannerText: { ...T.text.caption, color: T.dangerInk },
  bannerRetry: { ...T.text.caption, color: T.accent },
});
