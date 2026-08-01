import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Platform,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { T } from '@/constants/theme';
import { SheetShell } from '@/components/SheetShell';
import { useUser } from '@/store/UserContext';
import {
  deleteChallenge,
  getAnnouncements,
  getChallenges,
  getGroupDetail,
  groupErrorCode,
  withdrawGroup,
} from '@/services/groupApi';
import { logGroupInviteShared } from '@/services/analyticsEvents';
import { buildInviteLink } from '@/utils/inviteLink';
import { todayStr } from '@/utils/localDate';
import type {
  GroupAnnouncementResponse,
  GroupChallengeResponse,
  GroupDetailMemberResponse,
  GroupDetailResponse,
  GroupSummaryResponse,
} from '@/types/dto/group';
import type { V2RootStackParamList } from '@/navigation/types';
import { fmtNoticeDate } from './noticeDate';
import BetSheet from './components/BetSheet';
import ChallengeCard, { type BetSheetMode } from './components/ChallengeCard';
import ChallengeComposeSheet from './components/ChallengeComposeSheet';
import MemberTile from './components/MemberTile';

// 그룹방 — 명세 docs/app/group-plan.md §6-4.
//
// 형태: 탭 셸 없는 단일 ScrollView. **탭 안 내장 렌더와 라우트 진입을 겸한다** —
//      그룹이 1개면 지금까지처럼 GroupScreen 안에서, 2개 이상이면 목록에서 push 된다(2차 §0-1·§0-2).
// 레이아웃: 헤더(이름 · 비공개 자물쇠 · n/m · ⋯) → 초대 링크 카드 → 공지(최근 3건 + 모두보기)
//          → 챌린지(2차 §3-2) → 멤버 3열 그리드(MemberTile + '＋ 초대' 타일)
//
// ❌ detail.code · codeExpiresAt은 읽지 않는다 — 코드 개념 폐기(§3-1-5).

// 플로팅 탭바가 가리는 하단 여백(§5-1 — 탭 화면 공통 기준).
// ⚠️ 내장 렌더에서만 더한다 — 라우트로 push된 그룹방엔 탭바가 없어 74pt가 그냥 빈 바닥으로 남는다.
const TAB_BAR_SPACE = 74;
// 멤버 그리드 열 수
const COLS = 3;
// 공지 섹션에 노출하는 최근 공지 수(나머지는 '모두보기')
const NOTICE_PREVIEW = 3;

// 멤버 그리드 한 칸 — 멤버 타일 또는 마지막의 '＋ 초대' 타일.
type GridCell = { kind: 'member'; member: GroupDetailMemberResponse } | { kind: 'invite' };

// 리스트를 n개씩 잘라 행 배열로 만든다(3열 그리드 — flexWrap 대신 행 단위로 그려
// 마지막 행에도 같은 폭이 유지되게 한다).
function chunk<Item>(items: Item[], size: number): Item[][] {
  const rows: Item[][] = [];
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
  return rows;
}

export interface GroupRoomScreenProps {
  groupId: string;
  // 탭 진입점이 가진 요약(getMyGroups[0]) — 상세 응답 도착 전 헤더를 먼저 그리는 용도(선택).
  summary?: GroupSummaryResponse;
  // 그룹 나가기 성공 시 호출 — 부모(GroupScreen)가 재조회해 빈 상태로 되돌린다.
  onLeft: () => void;
  // 초대 시트가 이 화면 위에 떠 있는가 — 떠 있으면 이 화면이 소유한 시트('⋯' 메뉴·챌린지
  // 만들기)를 모두 내린다(아래 이펙트 주석 참고).
  inviteOpen?: boolean;
  // 내장 렌더(탭 안)일 때만 전달 — ⋯ 메뉴 '그룹 전환·추가' 진입점(2차 §0-3).
  // 라우트 진입은 이미 목록에서 들어온 화면이라 미전달 → 항목이 숨는다.
  // 이 prop의 유무가 곧 '내장 렌더인가'라서 하단 탭바 여백 판정에도 함께 쓴다.
  onShowGroups?: () => void;
  // 라우트로 push된 경우에만 전달 — 헤더 좌측에 원형 백버튼을 세운다.
  // 루트 스택이 headerShown:false라 네이티브 헤더가 없고, 탭바도 없어
  // 미전달이면 목록으로 돌아갈 명시 경로가 0개가 된다(앱 관행: 스택 화면은 백버튼 자가 렌더).
  onBack?: () => void;
}

export default function GroupRoomScreen({
  groupId,
  summary,
  onLeft,
  inviteOpen,
  onShowGroups,
  onBack,
}: GroupRoomScreenProps) {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<V2RootStackParamList>>();
  const { userId } = useUser();

  const [detail, setDetail] = useState<GroupDetailResponse | null>(null);
  // null = 아직 한 번도 못 받음. '공지 없음(빈 배열)'과 '공지 조회 실패'를 구분한다 —
  // 실패를 []로 뭉개면 이미 있는 공지가 사라진 자리에 '아직 공지가 없어요'가 떠서 같은 공지를 또 쓴다.
  const [notices, setNotices] = useState<GroupAnnouncementResponse[] | null>(null);
  // 공지와 같은 규격 — null = 아직 한 번도 못 받음. '챌린지 없음'과 '조회 실패'를 구분한다.
  const [challenges, setChallenges] = useState<GroupChallengeResponse[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [noticeError, setNoticeError] = useState(false);
  const [challengeError, setChallengeError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  // 내기 시트(3차) — 어떤 챌린지를 어떤 모드로 열었나. 내기 데이터는 challenges 응답에 이미
  // 실려 있으므로(계약 §2-3) 시트를 열려고 추가 조회를 하지 않는다.
  const [betSheet, setBetSheet] = useState<{
    challenge: GroupChallengeResponse;
    mode: BetSheetMode;
  } | null>(null);
  const [leaving, setLeaving] = useState(false);

  // 요청 시퀀스 — 당겨서 새로고침 중 '다시 시도'를 누르거나 연타하면 reload()·onRefresh()가
  // 같은 load()를 각자 부른다. 늦게 도착한 이전 응답이 최신 응답을 덮지 않게 최신 것만 반영한다
  // (useFriends.ts의 requestSeqRef와 같은 패턴). 포커스 cleanup·언마운트에서도 올려 무효화한다.
  const requestSeqRef = useRef(0);
  // 화면이 포커스돼 있는가 — 포그라운드 복귀 시 재조회 여부 판정에 쓴다(탭 화면은 언마운트되지 않는다).
  const focusedRef = useRef(false);
  // 마지막으로 성공한 조회의 기준 날짜. 자정을 넘겨 복귀하면 '오늘 집중분'이 전날 값이라 강제 재조회한다.
  const loadedDateRef = useRef<string | null>(null);

  // 상세 + 공지 + 챌린지 병렬 조회. 세 요청의 실패를 **각각** 다룬다(allSettled) —
  // 상세 실패는 기존 방 데이터를 보존한 채 배너로, 공지·챌린지 실패는 각 섹션에서만 알린다.
  // date는 멤버 '오늘 집중분'과 챌린지 진행률의 기준일이라 여기서 직접 만들어 보관까지 한다(§3-1-1).
  // ⚠️ getChallenges는 date를 **넘길 때만** memberProgress가 실려 온다(2차 배관 결정 1) —
  //    진행 리스트가 이 섹션의 본체라 반드시 넘긴다.
  // 반환값: 이 호출이 아직 최신인가(늦게 끝난 요청이 로딩 플래그를 되돌리지 않게).
  const load = useCallback(async (): Promise<boolean> => {
    const seq = ++requestSeqRef.current;
    const date = todayStr();
    setError(false);
    const [detailResult, noticeResult, challengeResult] = await Promise.allSettled([
      getGroupDetail(groupId, date),
      getAnnouncements(groupId),
      getChallenges(groupId, date),
    ]);
    if (seq !== requestSeqRef.current) return false;

    if (detailResult.status === 'fulfilled') {
      setDetail(detailResult.value);
      loadedDateRef.current = date;
    } else {
      // 이미 그룹이 사라졌거나 내가 멤버가 아니면 방을 잡고 있을 이유가 없다 —
      // 부모가 빈 상태로 되돌린다(§3-2).
      const code = groupErrorCode(detailResult.reason);
      if (code === 'MEMBER_ONLY' || code === 'NOT_FOUND') {
        // 부모가 이 화면을 내린다 — 로딩 플래그를 되돌릴 대상이 없으므로 최신 아님으로 반환한다.
        onLeft();
        return false;
      }
      setError(true);
    }

    if (noticeResult.status === 'fulfilled') {
      setNotices(noticeResult.value);
      setNoticeError(false);
    } else {
      setNoticeError(true); // 기존 공지는 그대로 둔다
    }

    if (challengeResult.status === 'fulfilled') {
      setChallenges(challengeResult.value);
      setChallengeError(false);
    } else {
      setChallengeError(true); // 기존 챌린지는 그대로 둔다
    }
    return true;
  }, [groupId, onLeft]);

  // 최초 진입·재시도 — 스피너를 세우고 조회한다(당겨서 새로고침은 RefreshControl이 표시).
  const reload = useCallback(() => {
    setLoading(true);
    load().then((fresh) => {
      if (fresh) setLoading(false);
    });
  }, [load]);

  // 포커스마다 재조회 — 공지를 쓰고(GroupNotice는 루트 스택 push라 이 화면이 언마운트되지 않는다)
  // 돌아왔을 때 공지 카드·멤버별 오늘 집중분이 옛 데이터로 남는 문제를 닫는다.
  // 마운트 1회 useEffect였을 땐 당겨서 새로고침 말고는 반영 경로가 없었다.
  // cleanup에서 시퀀스를 올려 진행 중이던 요청을 무효화한다(화면을 떠난 뒤 setState·onLeft 방지).
  useFocusEffect(
    useCallback(() => {
      focusedRef.current = true;
      reload();
      return () => {
        focusedRef.current = false;
        requestSeqRef.current++;
      };
    }, [reload]),
  );

  // 포그라운드 복귀 — 포커스는 유지된 채라 useFocusEffect가 다시 돌지 않는다.
  // 화면이 떠 있으면 재조회하고, 자정을 넘겼으면 포커스 여부와 무관하게 새 date로 다시 부른다.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      if (focusedRef.current || loadedDateRef.current !== todayStr()) reload();
    });
    return () => sub.remove();
  }, [reload]);

  // 초대 링크가 도착하면 이 화면이 소유한 시트를 전부 내린다 — 초대 시트와 이 시트들은 모두
  // SheetShell asModal(RN 네이티브 Modal)이라 동시에 뜨면 딤이 2겹으로 포개지고, 플랫폼별 모달
  // 표시 순서에 따라 초대 프리뷰가 가려질 수도 있다. GroupScreen이 링크 수신 시 찾기 시트를
  // 내리는 것과 같은 배타 처리이고, 링크로 들어온 초대가 우선이라 이쪽을 접는다.
  // 챌린지 만들기 시트도 같이 내린다 — 폼은 세그먼트·칩 2필드(기본값 있음)라 다시 여는 비용이
  // 거의 없고, 자유 입력이 없어 되돌릴 수 없는 손실이 생기지 않는다.
  useEffect(() => {
    if (!inviteOpen) return;
    setMenuOpen(false);
    setComposeOpen(false);
  }, [inviteOpen]);

  // 당겨서 새로고침 — 스피너는 **무조건** 내린다. '최신 응답일 때만' 내리면
  // 진행 중 다른 조회(포그라운드 복귀·삭제 후 재조회 등)가 끼어들어 seq가 밀리는 순간
  // 내릴 주체가 사라져 스피너가 영구히 돈다. 늦게 끝난 요청이 내려도 사용자 피해는 없다.
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load().finally(() => setRefreshing(false));
  }, [load]);

  // 내 권한 판정 — 상세 응답에 내 role이 없어 멤버 목록에서 직접 계산한다(§6-4).
  const me = userId ? detail?.members.find((m) => m.userId === userId) : undefined;
  const isOwner = me?.role === 'OWNER';
  const canWriteNotice = isOwner || (!!userId && !!detail?.noticeGrantedUserIds.includes(userId));

  const name = detail?.name ?? summary?.name ?? '내 그룹';
  const memberCount = detail?.members.length ?? summary?.currentMembers ?? 0;
  const maxMembers = detail?.maxMembers ?? summary?.maxMembers ?? 0;
  const isPrivate = detail?.isPrivate ?? summary?.isPrivate ?? false;
  const isFull = maxMembers > 0 && memberCount >= maxMembers;

  // 초대 — 외부로 나가는 링크는 항상 https 웹 링크다(§5-5).
  const onInvite = useCallback(async () => {
    try {
      const result = await Share.share({
        message: `gromo 그룹 "${name}"에 초대합니다\n${buildInviteLink(groupId)}`,
      });
      // 취소(dismissedAction)까지 공유로 집계하지 않는다 — 단 그 구분은 iOS에서만 가능하다.
      // 안드로이드는 시트를 그냥 닫아도 sharedAction으로 끝나 완료를 확인할 수 없어
      // confirmed:false(공유 시도)로 남긴다(analyticsEvents.logGroupInviteShared 주석).
      if (result.action === Share.sharedAction) {
        logGroupInviteShared({ share_method: 'share_sheet', confirmed: Platform.OS === 'ios' });
      }
    } catch {
      // 공유 시트를 못 띄운 경우 — 사용자에게 알릴 것이 없어 조용히 무시한다.
    }
  }, [groupId, name]);

  const openNotice = useCallback(() => {
    navigation.navigate('GroupNotice', { groupId, canWrite: canWriteNotice });
  }, [navigation, groupId, canWriteNotice]);

  // 챌린지 삭제 — 확인 Alert는 카드가 이미 거쳤다(ChallengeCard). 여기선 호출과 재조회만 한다.
  // 서버가 soft delete로 바꿔 이미 지워진 챌린지를 또 지우면 NOT_FOUND가 오는데,
  // 목록에서 사라지는 결과는 같으므로 성공과 똑같이 재조회로 끝낸다.
  const onDeleteChallenge = useCallback(
    async (challengeId: string) => {
      try {
        await deleteChallenge(groupId, challengeId);
      } catch (e) {
        if (groupErrorCode(e) !== 'NOT_FOUND') {
          Alert.alert('챌린지를 삭제하지 못했어요', '잠시 후 다시 시도해주세요.');
          return;
        }
      }
      load();
    },
    [groupId, load],
  );

  const doLeave = useCallback(async () => {
    if (leaving) return;
    setLeaving(true);
    try {
      await withdrawGroup(groupId);
      onLeft();
    } catch (e) {
      switch (groupErrorCode(e)) {
        case 'HOST_WITHDRAW':
          // 방장 위임 UI가 없으므로 안내로 끝낸다(알려진 제약 §14).
          Alert.alert(
            '방장은 나갈 수 없어요',
            '그룹을 이어갈 사람에게 방장을 넘겨야 해요.\n방장 넘기기는 준비 중이에요.',
          );
          break;
        case 'NOT_FOUND':
        case 'MEMBER_ONLY':
          // 이미 빠져 있는 상태 — 성공과 같게 취급한다.
          onLeft();
          break;
        default:
          Alert.alert('그룹 나가기 실패', '잠시 후 다시 시도해주세요.');
      }
    } finally {
      setLeaving(false);
    }
  }, [groupId, leaving, onLeft]);

  const confirmLeave = useCallback(() => {
    setMenuOpen(false);
    // 확인 Alert 형식은 앱 관행대로 (동작명, 질문) — 대상에 인용부호를 쓰지 않는다.
    Alert.alert('그룹 나가기', `${name}에서 나갈까요?`, [
      { text: '취소', style: 'cancel' },
      { text: '나가기', style: 'destructive', onPress: () => doLeave() },
    ]);
  }, [name, doLeave]);

  // 라우트 진입의 백버튼 — 헤더뿐 아니라 상세 도착 **전**(로딩·에러) 분기에도 세운다.
  // 이 화면엔 네이티브 헤더도 탭바도 없어, 첫 조회가 도는 동안·실패했을 때 백버튼이 없으면
  // 목록으로 돌아갈 명시 경로가 0개가 된다(iOS는 시스템 뒤로가기도 없다).
  const backButton = onBack ? (
    <TouchableOpacity
      style={s.backBtn}
      onPress={onBack}
      activeOpacity={0.7}
      accessibilityLabel="뒤로"
    >
      <Ionicons name="chevron-back" size={18} color={T.inkSub} />
    </TouchableOpacity>
  ) : null;

  // ── 최초 로딩 — 중앙 스피너(§5-4) ──
  if (loading && !detail) {
    return (
      <View style={s.fill}>
        {!!backButton && <View style={s.backRow}>{backButton}</View>}
        <View style={s.center}>
          <ActivityIndicator color={T.accent} />
        </View>
      </View>
    );
  }

  // ── 에러 + 다시 시도 ──
  if (error && !detail) {
    return (
      <View style={s.fill}>
        {!!backButton && <View style={s.backRow}>{backButton}</View>}
        <View style={s.center}>
          <Text style={s.errorTitle}>그룹을 불러오지 못했어요</Text>
          <Text style={s.errorDesc}>잠시 후 다시 시도해주세요.</Text>
          <TouchableOpacity style={s.retryBtn} activeOpacity={0.85} onPress={reload}>
            <Text style={s.retryText}>다시 시도</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // 멤버 순서는 서버가 준 그대로 둔다(앱에서 재정렬하지 않음).
  // '＋ 초대' 타일까지 한 흐름으로 배치하려고 셀 배열로 만든 뒤 3개씩 잘라 행으로 그린다.
  const members = detail?.members ?? [];
  const noticeList = notices ?? [];
  const challengeList = challenges ?? [];
  // 만들기 시트가 '이미 있는 종류'를 못 고르게 하는 근거 — 서버는 같은 카테고리의 ACTIVE 챌린지가
  // 있으면 409로 튕긴다. 종료된 챌린지는 다시 만들 수 있으므로 ACTIVE만 센다.
  const existingCategories = challengeList
    .filter((c) => c.status === 'ACTIVE')
    .map((c) => c.missionCategory);
  // 섹션 실패 표시는 '한 번도 못 받음'뿐 아니라 '빈 목록 + 갱신 실패'에도 세운다 —
  // 빈 상태 문구가 뜨면 서버 상태를 못 받았다는 사실이 화면에서 완전히 사라진다.
  const noticeFailed = noticeError && noticeList.length === 0;
  const challengeFailed = challengeError && challengeList.length === 0;
  // 탭바 여백은 내장 렌더에서만 — onShowGroups를 받는가가 곧 '탭 안에 있는가'다(§0-3 계약).
  const bottomSpace = insets.bottom + (onShowGroups ? TAB_BAR_SPACE : 0) + T.space.md;
  const cells: GridCell[] = [
    ...members.map((m): GridCell => ({ kind: 'member', member: m })),
    { kind: 'invite' },
  ];
  const memberRows = chunk(cells, COLS);

  return (
    <>
      <ScrollView
        style={s.scroll}
        testID="group.room.scroll"
        contentContainerStyle={[s.content, { paddingBottom: bottomSpace }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={T.accent} />
        }
      >
        {/* ── 재조회 실패 배너 — 기존 데이터를 지우지 않고 '지금 보는 값이 옛것'임을 알린다 ── */}
        {error && !!detail && (
          <View style={s.banner}>
            <Text style={s.bannerText}>최신 정보를 불러오지 못했어요</Text>
            <TouchableOpacity onPress={reload} hitSlop={12} activeOpacity={0.7}>
              <Text style={s.bannerRetry}>다시 시도</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── 헤더 ── */}
        <View style={s.header}>
          {/* 라우트 진입에서만 — 규격은 그룹 만들기·공지 화면의 원형 백버튼과 같다(§5-1) */}
          {backButton}
          <View style={s.headerLeft}>
            <Text style={s.title} numberOfLines={1}>
              {name}
            </Text>
            {isPrivate && <Ionicons name="lock-closed" size={15} color={T.inkSub} />}
            <Text style={s.count}>
              {memberCount}/{maxMembers}
            </Text>
          </View>
          <TouchableOpacity
            style={s.moreBtn}
            activeOpacity={0.7}
            onPress={() => setMenuOpen(true)}
            accessibilityLabel="그룹 메뉴"
          >
            <Ionicons name="ellipsis-horizontal" size={18} color={T.ink} />
          </TouchableOpacity>
        </View>

        {/* ── 초대 링크 카드 — 비공개방에선 유일한 입구라 상단에 고정한다(§6-4) ── */}
        <TouchableOpacity
          style={[s.inviteCard, isFull && s.inviteCardOff]}
          activeOpacity={0.85}
          disabled={isFull}
          onPress={() => onInvite()}
        >
          <View style={s.inviteIcon}>
            <Ionicons name="link" size={16} color={isFull ? T.inkMuted : T.accent} />
          </View>
          <View style={s.inviteTexts}>
            <Text style={[s.inviteTitle, isFull && s.inviteTitleOff]}>초대 링크로 친구 부르기</Text>
            <Text style={s.inviteCaption}>
              {isFull
                ? '정원이 가득 찼어요'
                : isPrivate
                  ? '비공개 그룹이라 링크로만 들어올 수 있어요'
                  : '링크를 받은 친구는 바로 참여할 수 있어요'}
            </Text>
          </View>
          {!isFull && <Ionicons name="share-outline" size={18} color={T.inkSub} />}
        </TouchableOpacity>

        {/* ── 공지 ── */}
        <View style={s.sectionHead}>
          <Text style={s.sectionTitle}>공지</Text>
          {noticeList.length > 0 && (
            <TouchableOpacity
              style={s.moreRow}
              activeOpacity={0.7}
              onPress={openNotice}
              hitSlop={12}
            >
              <Text style={s.moreLink}>모두보기</Text>
              <Ionicons name="chevron-forward" size={11} color={T.accent} />
            </TouchableOpacity>
          )}
        </View>

        {/* 공지를 못 받은 채 목록이 비어 있음 — '없음'과 구분해서 알린다(문구·아이콘 모두 danger).
            이 상태에선 작성 진입을 막는다(서버엔 이미 공지가 있는데 없다고 보고 또 쓰는 것을 예방). */}
        {noticeFailed ? (
          <View style={s.emptyNotice}>
            <View style={s.emptyErrorRow}>
              <Ionicons name="alert-circle-outline" size={15} color={T.dangerInk} />
              <Text style={s.emptyErrorText}>공지를 불러오지 못했어요</Text>
            </View>
            <TouchableOpacity style={s.writeBtn} activeOpacity={0.85} onPress={reload}>
              <Text style={s.writeText}>다시 시도</Text>
            </TouchableOpacity>
          </View>
        ) : noticeList.length === 0 ? (
          <View style={s.emptyNotice}>
            <Text style={s.emptyNoticeText}>아직 공지가 없어요</Text>
            {canWriteNotice && (
              <TouchableOpacity style={s.writeBtn} activeOpacity={0.85} onPress={openNotice}>
                <Text style={s.writeText}>공지 쓰기</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <View style={s.noticeList}>
            {/* 목록은 있는데 갱신만 실패 — 기존 공지를 그대로 두고 한 줄로 알린다. */}
            {noticeError && <Text style={s.bannerText}>공지를 새로고침하지 못했어요</Text>}
            {noticeList.slice(0, NOTICE_PREVIEW).map((n) => (
              <TouchableOpacity
                key={n.id}
                style={s.noticeCard}
                activeOpacity={0.85}
                onPress={openNotice}
              >
                <Text style={s.noticeTitle} numberOfLines={1}>
                  {n.title}
                </Text>
                <Text style={s.noticeDate}>{fmtNoticeDate(n.createdAt)}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* ── 챌린지(2차 §3-2) — 공지 아래·멤버 그리드 위 ── */}
        <View style={s.sectionHead}>
          <Text style={s.sectionTitle}>챌린지</Text>
          {/* 조회 실패 중에는 이 진입점도 함께 막는다 — 아래 빈 상태의 '만들기'만 막으면
              existingCategories가 빈 배열인 채로 시트가 열려, 서버에 이미 있는 종류를 고를 수
              있게 되고 생성은 ACTIVE_CHALLENGE_EXISTS로 확정 실패한다. */}
          {isOwner && !challengeFailed && (
            <TouchableOpacity
              style={s.addBtn}
              activeOpacity={0.7}
              onPress={() => setComposeOpen(true)}
              hitSlop={12}
              accessibilityLabel="챌린지 만들기"
              testID="group.challenge.add"
            >
              <Ionicons name="add" size={16} color={T.accent} />
            </TouchableOpacity>
          )}
        </View>

        {/* 공지와 같은 규격 — 목록이 빈 채 실패면 '없음'으로 위장하지 않고 재시도를 세운다.
            이 상태에선 만들기 진입도 막는다(서버에 이미 있는 챌린지를 중복 생성하면 409로 튕긴다). */}
        {challengeFailed ? (
          <View style={s.emptyNotice}>
            <View style={s.emptyErrorRow}>
              <Ionicons name="alert-circle-outline" size={15} color={T.dangerInk} />
              <Text style={s.emptyErrorText}>챌린지를 불러오지 못했어요</Text>
            </View>
            <TouchableOpacity style={s.writeBtn} activeOpacity={0.85} onPress={reload}>
              <Text style={s.writeText}>다시 시도</Text>
            </TouchableOpacity>
          </View>
        ) : challengeList.length === 0 ? (
          <View style={s.emptyNotice}>
            <Text style={s.emptyNoticeText}>아직 챌린지가 없어요</Text>
            {isOwner && (
              <TouchableOpacity
                style={s.writeBtn}
                activeOpacity={0.85}
                onPress={() => setComposeOpen(true)}
              >
                <Text style={s.writeText}>챌린지 만들기</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <View style={s.noticeList}>
            {/* 목록은 있는데 갱신만 실패 — 기존 카드를 그대로 두고 한 줄로 알린다. */}
            {challengeError && <Text style={s.bannerText}>챌린지를 새로고침하지 못했어요</Text>}
            {challengeList.map((c) => (
              <ChallengeCard
                key={c.id}
                challenge={c}
                isOwner={!!isOwner}
                myUserId={userId}
                onDelete={onDeleteChallenge}
                onOpenBet={(mode) => setBetSheet({ challenge: c, mode })}
              />
            ))}
          </View>
        )}

        {/* ── 멤버 ── */}
        <View style={s.sectionHead}>
          <Text style={s.sectionTitle}>멤버</Text>
        </View>
        <View style={s.grid}>
          {memberRows.map((row, rowIdx) => (
            <View key={`row-${rowIdx}`} style={s.gridRow}>
              {row.map((cell) =>
                cell.kind === 'invite' ? (
                  <TouchableOpacity
                    key="invite"
                    style={[s.inviteTile, isFull && s.inviteTileOff]}
                    activeOpacity={0.85}
                    disabled={isFull}
                    onPress={() => onInvite()}
                  >
                    <Ionicons name="add" size={22} color={isFull ? T.inkMuted : T.accent} />
                    <Text style={[s.inviteTileText, isFull && s.inviteTileTextOff]}>
                      {isFull ? '정원 가득' : '초대'}
                    </Text>
                  </TouchableOpacity>
                ) : (
                  <MemberTile
                    key={cell.member.userId}
                    nickname={cell.member.nickname}
                    focusTimeMinutes={cell.member.focusTimeMinutes}
                    isOwner={cell.member.role === 'OWNER'}
                  />
                ),
              )}
              {/* 마지막 행 빈 칸 — 남는 칸을 채워 타일 폭을 고정한다 */}
              {Array.from({ length: COLS - row.length }).map((_, i) => (
                <View key={`pad-${i}`} style={s.gridPad} />
              ))}
            </View>
          ))}
        </View>
      </ScrollView>

      {/* ── '⋯' 액션시트 ── */}
      {/* '닫기' 행은 두지 않는다 — 앱의 SheetShell 시트 4종 모두 딤 탭으로만 닫고,
          아이콘 없는 행이라 위 행과 글자 시작선도 어긋났다. */}
      {/* inviteOpen까지 함께 보는 이유: 위 이펙트는 렌더 뒤에 돌아 한 프레임 동안 두 Modal이 겹친다. */}
      {menuOpen && !inviteOpen && (
        <SheetShell onClose={() => setMenuOpen(false)} asModal>
          <Text style={s.menuTitle}>{name}</Text>
          {/* 내장 렌더에서만 — 라우트 진입은 이미 목록에서 들어온 화면이다(§0-3).
              라벨은 '목록 보기'가 아니라 실제 기능(전환·만들기·찾기의 허브)에 맞춘다 —
              그룹이 1개인 사용자에게 두 번째 그룹으로 가는 유일한 입구가 여기다. */}
          {!!onShowGroups && (
            <TouchableOpacity
              style={s.menuItem}
              activeOpacity={0.7}
              onPress={() => {
                setMenuOpen(false);
                onShowGroups();
              }}
            >
              <Ionicons name="swap-horizontal" size={18} color={T.ink} />
              <Text style={s.menuText}>그룹 전환·추가</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={s.menuItem} activeOpacity={0.7} onPress={confirmLeave}>
            <Ionicons name="exit-outline" size={18} color={T.accentAlt} />
            <Text style={s.menuDanger}>그룹 나가기</Text>
          </TouchableOpacity>
        </SheetShell>
      )}

      {/* ── 챌린지 만들기 시트(방장만) ── */}
      {/* '⋯' 메뉴와 같은 이유로 inviteOpen까지 본다 — 위 이펙트는 렌더 뒤에 돌아 한 프레임 동안
          두 Modal이 겹친다. */}
      {composeOpen && !inviteOpen && (
        <ChallengeComposeSheet
          groupId={groupId}
          existingCategories={existingCategories}
          onClose={() => setComposeOpen(false)}
          onCreated={() => {
            setComposeOpen(false);
            load();
          }}
        />
      )}

      {/* ── 내기 시트(개설·참가, 3차 §1) ── */}
      {betSheet !== null && (
        <BetSheet
          groupId={groupId}
          challenge={betSheet.challenge}
          mode={betSheet.mode}
          onClose={() => setBetSheet(null)}
          onDone={() => {
            setBetSheet(null);
            load();
          }}
        />
      )}
    </>
  );
}

const s = StyleSheet.create({
  scroll: { flex: 1 },
  content: { padding: T.space.lg, gap: T.space.md },
  // 로딩·에러 분기의 바깥 컨테이너 — 백버튼 줄과 중앙 블록을 위아래로 쌓는다.
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: T.space.xxl },
  // 백버튼만 있는 줄 — 좌우 20은 헤더(content lg + header xs)와 같은 시작선이다.
  backRow: { flexDirection: 'row', paddingHorizontal: T.space.xl, paddingTop: T.space.lg },
  // 화면 전체를 차지하는 에러/빈 상태 헤드라인은 T.text.title(26/800) — 그룹 탭·리그와 같은 위계.
  // 카드 안 빈 상태(emptyNoticeText)는 caption을 유지한다.
  errorTitle: { ...T.text.title, color: T.ink, textAlign: 'center' },
  errorDesc: { ...T.text.body, color: T.inkSub, marginTop: T.space.xs, textAlign: 'center' },
  // 인라인 재시도 = 48 / r16 / px xxl — 그룹 탭·공지 화면과 같은 값(§G-4)
  retryBtn: {
    marginTop: T.space.lg,
    height: 48,
    paddingHorizontal: T.space.xxl,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: T.accent,
  },
  retryText: { ...T.text.label, color: T.white },

  // 재조회 실패 인라인 배너 — 문구는 그룹 화면 공통 s.notice 규격(caption/dangerInk),
  // 재시도 링크는 '모두보기'와 같은 accent 링크 규격(§G-4).
  banner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  bannerText: { ...T.text.caption, color: T.dangerInk },
  bannerRetry: { ...T.text.caption, color: T.accent },

  // 헤더 블록만 좌우 20(T.space.xl) — 홈·리그·전체 탭의 화면 제목과 시작선을 맞춘다.
  // content는 16(T.space.lg)이라 차이 4pt를 여기서 더한다(리그도 헤더 xl / 리스트 lg).
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: T.space.xs,
  },
  // 라우트 진입의 백버튼 — 그룹 만들기·공지 화면과 같은 32/r16/white/border 규격.
  backBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: T.space.sm,
  },
  headerLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: T.space.xs },
  title: { ...T.text.title, color: T.ink, flexShrink: 1 },
  count: { ...T.text.caption, color: T.inkSub, fontVariant: ['tabular-nums'] },
  moreBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.border,
  },

  // 카드 표면은 T.paperAlt — 화면 배경이 흰 캔버스(T.paperLight)로 바뀌어 T.white 카드는 묻힌다.
  inviteCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space.md,
    backgroundColor: T.paperAlt,
    borderWidth: 1,
    borderColor: T.border,
    borderRadius: 16,
    padding: T.space.lg,
  },
  inviteCardOff: { backgroundColor: T.paperAlt, borderColor: T.paperAlt },
  inviteIcon: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: T.accentBg,
  },
  inviteTexts: { flex: 1, gap: 2 },
  inviteTitle: { ...T.text.label, color: T.ink },
  inviteTitleOff: { color: T.inkMuted },
  inviteCaption: { ...T.text.caption, fontWeight: '500', color: T.inkMuted },

  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: T.space.xs,
  },
  sectionTitle: { ...T.text.label, color: T.ink },
  // '모두보기' — 홈의 '자세히' 링크와 같은 규격(label + chevron 11). 터치 타깃은 hitSlop 12로 보강.
  moreRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  moreLink: { ...T.text.label, color: T.accent },
  // 섹션 헤더의 '+' — 헤더 ⋯ 버튼(34)보다 한 단 작은 원형. 터치 타깃은 hitSlop 12로 보강.
  addBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: T.accentBg,
  },

  noticeList: { gap: T.space.sm },
  noticeCard: {
    backgroundColor: T.paperAlt,
    borderWidth: 1,
    borderColor: T.border,
    borderRadius: 14,
    paddingVertical: T.space.md,
    paddingHorizontal: T.space.lg,
    gap: 2,
  },
  noticeTitle: { ...T.text.label, color: T.ink },
  noticeDate: { ...T.text.caption, fontWeight: '500', color: T.inkMuted },
  emptyNotice: {
    alignItems: 'center',
    gap: T.space.md,
    backgroundColor: T.paperAlt,
    borderWidth: 1,
    borderColor: T.border,
    borderRadius: 14,
    paddingVertical: T.space.xl,
    paddingHorizontal: T.space.lg,
  },
  emptyNoticeText: { ...T.text.caption, fontWeight: '500', color: T.inkMuted },
  // 조회 실패는 빈 상태와 같은 컨테이너를 쓰되 색·아이콘으로 갈라 놓는다 —
  // 읽어야만 구분되면 '아직 없음'과 '못 받음'이 같은 화면으로 보인다. 에러 색은 앱 관행대로 dangerInk.
  emptyErrorRow: { flexDirection: 'row', alignItems: 'center', gap: T.space.xs },
  emptyErrorText: { ...T.text.caption, color: T.dangerInk },
  writeBtn: {
    height: 40,
    paddingHorizontal: T.space.xl,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: T.accent,
  },
  writeText: { ...T.text.label, color: T.white },

  grid: { gap: T.space.md },
  gridRow: { flexDirection: 'row', gap: T.space.md },
  gridPad: { flex: 1 },
  inviteTile: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: T.space.xs,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: T.borderDark,
    borderRadius: 14,
    paddingVertical: T.space.md,
    paddingHorizontal: T.space.sm,
  },
  inviteTileOff: { borderColor: T.border, backgroundColor: T.paperAlt },
  inviteTileText: { ...T.text.caption, color: T.accent },
  inviteTileTextOff: { color: T.inkMuted },

  menuTitle: { ...T.text.label, color: T.inkMuted, marginBottom: T.space.sm },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space.sm,
    height: 52,
  },
  menuDanger: { ...T.text.subtitle, color: T.accentAlt },
  menuText: { ...T.text.subtitle, color: T.ink },
});
