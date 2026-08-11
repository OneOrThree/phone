import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { T } from '@/constants/theme';
import { SheetShell } from '@/components/SheetShell';
import { getAuthSessionGeneration } from '@/services/api';
import { groupErrorCode, joinGroup, searchGroups } from '@/services/groupApi';
import { promptSessionExpired, USER_NOT_FOUND } from '@/services/sessionErrors';
import { logGroupJoinAttempted, logGroupSearchPerformed } from '@/services/analyticsEvents';
import type { GroupSearchResponse, GroupSummaryResponse } from '@/types/dto/group';
import type { V2RootStackParamList } from '@/navigation/types';
import { acquireJoinLock, releaseJoinLock, useJoinLocked } from '../joinLock';

// 그룹 찾기 시트 — 명세 docs/app/group-plan.md §6-3 + 2차 docs/app/group-plan-2.md §3-3.
// 이름으로 공개 그룹을 검색해 바로 참여한다. 비공개방은 서버가 검색에서 제외한다.
//
// 2차에서 멀티 그룹이 열리면서 검색 결과에 **이미 내가 속한 그룹**이 섞여 나온다 —
// 그 행은 참여 대상이 아니라 이동 대상이라, '참여 중' 뱃지를 달고 탭을 그룹방 이동으로 바꾼다
// (참여 상한은 서버가 GROUP_LIMIT_EXCEEDED로 알려준다).
// ⚠️ 소속 판정은 **부모가 이미 쥔 groups를 그대로 받는다** — 시트가 getMyGroups()를 또 부르던
//    구조는 왕복이 하나 늘 뿐 아니라 판정 기준이 부모와 둘로 갈렸다(뱃지는 붙는데 부모의 분기는
//    다른 스냅샷을 보는 어긋남). 이동 분기 자체도 부모의 onOpenGroup 하나로 일원화했다.
// 선행: 백엔드 P0(is_private + 검색 필터). 그 전에는 비공개방이 검색에 그대로 노출된다(§13-1).
//
// 시트는 라우트가 아니라 GroupScreen 위의 오버레이다 — 닫기·재조회는 전부 부모 몫이라
// 여기서는 onClose()/onJoined()만 호출한다(navigationRef 초대 버퍼도 건드리지 않는다).
//
// 에러 표현 규칙(그룹 시트 3종 공통 — GroupInviteSheet·NoticeComposeSheet와 같은 기준):
//   · 시트 안에서 일어난 액션 실패는 **인라인 문구**로 띄운다. 시트가 이미 맥락을 쥐고 있어
//     Alert를 겹치면 레이어가 두 겹이 되고, 확인을 눌러야 원래 화면으로 돌아온다.
//   · Alert는 **되돌릴 수 없는 액션의 확인**(참여 확인)과 **계정 전환 유도**(로그인)에만 쓴다.

// 검색 입력 디바운스(ms) — 타이핑 중 과호출 방지(FriendAddScreen과 동일 기준)
const SEARCH_DEBOUNCE_MS = 350;

// 목록에 남길 수 있는 그룹인가 — 탭해도 반드시 실패하는 그룹은 애초에 보여주지 않는다.
//  · ENDED: 마지막 멤버가 나가면 서버가 그룹을 close()한다(Group.java). 그런데 검색도 join도
//    상태를 보지 않아서, 그대로 두면 종료된 그룹에 멤버십만 생기는 모순 데이터가 만들어진다.
//  · hasPassword: 비밀번호는 폐기 개념(§0)이라 앱은 항상 빈 바디로 join한다 — 기존 비번 그룹은
//    탭할 때마다 WRONG_PASSWORD로만 끝나고 화면에는 공통 실패 문구밖에 뜨지 않는다.
// 서버가 이 두 가지를 직접 걸러 주면 이 필터는 무해한 이중 방어로 남는다.
function isJoinable(r: GroupSearchResponse): boolean {
  return r.status !== 'ENDED' && !r.hasPassword;
}

export interface GroupFindSheetProps {
  // 내가 참여 중인 그룹 — '참여 중' 뱃지와 탭 동작(참여 → 이동)을 가르는 유일한 기준.
  // 부모(GroupScreen)의 상태를 그대로 받는다: 시트가 따로 조회하지 않는다.
  groups: GroupSummaryResponse[];
  // 딤 탭·취소 — 부모가 시트를 내린다.
  onClose: () => void;
  // 참여 성공(ALREADY_MEMBER 포함) — 부모가 시트를 내리고 getMyGroups()를 재조회한다.
  onJoined: () => void;
  // '참여 중' 행 탭 — 참여가 아니라 이동이다. 부모가 시트를 내리고 1건/N건 분기를 판정한다
  // (목록 카드 탭과 같은 콜백을 태워, 같은 규칙이 두 군데로 갈리지 않게 한다).
  onOpenGroup: (groupId: string) => void;
}

export default function GroupFindSheet({
  groups,
  onClose,
  onJoined,
  onOpenGroup,
}: GroupFindSheetProps) {
  const navigation = useNavigation<NativeStackNavigationProp<V2RootStackParamList>>();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GroupSearchResponse[]>([]);
  // 열리자마자 공개방 기본 목록을 부르므로(A-10) 첫 렌더는 로딩으로 시작한다 —
  // false로 두면 마운트 직후 한 프레임 동안 '결과 없음' 문구가 스쳐 지나간다.
  const [searching, setSearching] = useState(true);
  // 조회 실패 — '결과 없음'과 반드시 구분한다. 실패를 빈 목록으로 뭉개면 실제로 있는 그룹을
  // 찾는 사용자가 '그런 이름의 공개 그룹이 없어요'를 보고 이름이 틀렸다고 오인한다.
  const [searchError, setSearchError] = useState(false);
  // 참여 중인 그룹 id — 어느 행에 스피너를 그릴지만 정한다. 연타·중복 실행을 막는 것은
  // 전역 잠금(joinLock.ts)이고, 이 값은 리렌더 뒤에야 보여 같은 틱의 두 번째 탭을 못 막는다.
  const [joiningId, setJoiningId] = useState<string | null>(null);
  // 앱 어딘가에서 참여가 진행 중인가 — 이 시트의 요청이든 초대 시트의 요청이든 행을 잠근다.
  const joinLocked = useJoinLocked();
  // 참여 실패 문구 — 시트 안에서 인라인으로 띄운다(Alert 아님, 파일 상단 규칙).
  const [joinError, setJoinError] = useState<string | null>(null);
  // 키보드가 바텀시트를 덮는 문제 보정 — 패널은 하단 고정이라 자체적으로 올라가지 않는다.
  // 자식 끝에 키보드 높이만큼 여백을 깔면 패널 내용이 키보드 위로 올라온다.
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  const q = query.trim();

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvent, (e) => setKeyboardHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  // 검색 시퀀스 — **주 검색과 조용한 갱신이 같은 카운터를 쓴다**.
  // 갱신에 토큰이 없으면(검색어 A 참여 실패 → refresh(A) 중 사용자가 B 입력) 늦게 온 A 응답이
  // B 결과를 덮어 입력창과 목록이 어긋난다. 검색어가 바뀌는 즉시 시퀀스를 올려 전부 무효화한다.
  const searchSeqRef = useRef(0);
  // 진행 중인 디바운스 타이머 — 퇴장 시작 시 세대와 함께 걷는다(아래 onClosing).
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 언마운트(시트 닫힘·링크 수신) 시에도 시퀀스를 올려 진행 중 요청의 setState를 막는다.
  useEffect(
    () => () => {
      searchSeqRef.current++;
    },
    [],
  );

  // 실제 검색 호출. measure=true는 사용자가 친 검색(계측·로딩 표시 대상),
  // false는 참여 실패 후의 조용한 갱신이다.
  const runSearch = useCallback(async (target: string, seq: number, measure: boolean) => {
    try {
      const rows = (await searchGroups(target)).filter(isJoinable);
      if (seq !== searchSeqRef.current) return;
      setResults(rows);
      setSearchError(false);
      // 계측 result_count는 **화면에 실제로 뜬 개수**다 — 걸러낸 그룹까지 세면 검색 품질 지표가 부푼다.
      // 빈 쿼리(공개방 기본 목록)는 사용자가 친 검색이 아니라 계측하지 않는다 — target이 있을 때만 쏜다.
      if (measure && target)
        logGroupSearchPerformed({ query_length: target.length, result_count: rows.length });
    } catch {
      if (seq !== searchSeqRef.current) return;
      // 주 검색 실패는 목록을 비우고 실패 상태를 세운다. 조용한 갱신 실패는 기존 목록을
      // 그대로 두고 조용히 넘어간다(사용자가 시작한 조회가 아니라 알릴 것이 없다).
      if (measure) {
        setResults([]);
        setSearchError(true);
      }
    } finally {
      if (measure && seq === searchSeqRef.current) setSearching(false);
    }
  }, []);

  // 목록 조회 — 디바운스 + 재입력/언마운트 시 이전 응답 무시(FriendAddScreen:66-92 패턴).
  // 검색어가 있으면 이름 검색(trgm), 비어 있으면 공개방 기본 목록을 부른다 —
  // 서버가 빈 쿼리를 '공개방 최신 생성순 상위 10개'로 응답하므로 같은 경로로 처리한다(A-10).
  // 마운트(=시트 열림) 시 q=''로 이 이펙트가 돌아 기본 목록을 채우고, 입력을 지우면 다시 기본 목록으로 돌아온다.
  useEffect(() => {
    // 검색어가 바뀌면 직전 참여 실패 문구는 맥락을 잃는다 — 함께 지운다.
    setJoinError(null);
    setSearchError(false);
    // 이전 검색어의 결과도 즉시 비운다 — 입력창은 B인데 목록에 A의 행이 활성 상태로 남으면,
    // 디바운스+요청이 끝나기 전에 그 행을 누른 사용자가 B를 검색한 화면에서 A 그룹에 참여한다.
    // (빈 쿼리로 돌아올 때도 이전 검색 결과를 비우고 기본 목록으로 새로 채운다.)
    setResults([]);
    // 디바운스 타이머가 뜨기 전에 올린다 — 아직 응답이 안 온 이전 요청(주 검색·조용한 갱신)이 여기서 죽는다.
    const seq = ++searchSeqRef.current;
    setSearching(true);
    // ⚠️ 타이머를 ref에도 둔다 — 퇴장이 시작되면(onClosing) 여기서 걷어야 한다. 종전에는 닫기가
    //    곧 언마운트라 아래 cleanup이 막았지만, 이제 220ms 동안 살아 있어 그 사이 디바운스가
    //    만료되면 **닫힌 검색이 실제로 서버를 호출한다**(응답만 버려질 뿐이다 — codex 리뷰).
    debounceRef.current = setTimeout(() => runSearch(q, seq, true), SEARCH_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = null;
    };
  }, [q, runSearch]);

  // 참여 실패 후 목록만 조용히 갱신한다(사용자가 친 검색이 아니므로 계측은 쏘지 않는다).
  // 시퀀스는 올리지 않고 **현재 검색어의 세대 번호를 그대로 쓴다** — 같은 검색어의 결과라
  // 주 검색과 서로 덮어도 어긋나지 않고, 검색어가 바뀌면 그 즉시 함께 무효화된다.
  const refreshResults = useCallback(() => {
    // 빈 쿼리(공개방 기본 목록) 상태에서도 갱신한다 — 서버가 빈 쿼리를 기본 목록으로 응답한다.
    runSearch(q, searchSeqRef.current, false);
  }, [q, runSearch]);

  // 조회 실패 후의 수동 재시도 — 검색어를 바꿔야만 다시 시도할 수 있으면 복구 경로가 없다.
  // 빈 쿼리(공개방 기본 목록) 조회 실패에도 그대로 동작한다.
  // 새 세대로 올려 진행 중인 이전 요청을 무효화한다(디바운스 없이 즉시 발화).
  const retrySearch = useCallback(() => {
    const seq = ++searchSeqRef.current;
    setSearchError(false);
    setSearching(true);
    runSearch(q, seq, true);
  }, [q, runSearch]);

  // 게스트는 GroupScreen이 앞단에서 막지만, 서버가 403을 주면 시트를 닫고 로그인으로 보낸다(§5-3).
  const goLogin = useCallback(() => {
    onClose();
    Alert.alert('로그인이 필요해요', '로그인하면 그룹에 참여할 수 있어요.', [
      { text: '나중에', style: 'cancel' },
      { text: '로그인하기', onPress: () => navigation.navigate('SettingsAccount') },
    ]);
  }, [navigation, onClose]);

  async function join(group: GroupSearchResponse) {
    // 참여는 앱 전체에서 한 번에 하나만 나간다(joinLock.ts) — 초대 시트의 참여와 같은 잠금을 쓴다.
    // 잠금을 못 잡는 경우: 이 시트가 내려간 뒤에도 살아 있는 앞 요청, 또는 초대 시트가 쥔 잠금.
    // 확인 Alert를 거쳐 들어오므로 사용자는 무언가 눌렀다고 믿는다 — 조용히 삼키지 않고 알린다.
    const token = acquireJoinLock();
    if (!token) {
      setJoinError('참여를 처리하는 중이에요. 잠시 후 다시 시도해주세요.');
      return;
    }
    // 참여 요청도 **검색 세대를 캡처한다**. 응답을 기다리는 동안 사용자가 검색어를 바꿀 수 있는데,
    // 그때 늦게 도착한 A의 실패를 그대로 반영하면 A용 오류 문구가 B 화면에 뜨고, refreshResults가
    // B의 세대 번호로 A를 다시 조회해 유효한 요청처럼 B 결과를 덮는다.
    const seq = searchSeqRef.current;
    // 검색 세대와 별개로 **인증 세대**도 캡처한다 — 유저 부재 분기의 로그아웃은 이 요청이 속한
    // 세션에만 적용돼야 한다(sessionErrors.ts 주석). 검색 세대는 '어느 검색어의 행인가'만 말한다.
    const requestSessionGeneration = getAuthSessionGeneration();
    setJoiningId(group.groupId);
    setJoinError(null);
    try {
      // 계측은 **요청 직전**에 쏜다 — 이름 그대로 '시도'이고, 서버가 소유한 group_joined의
      // 분모다. 성공 뒤로 미루면 ROOM_FULL·404·네트워크 실패가 통째로 빠져 전환율이 항상
      // 100%로 보인다(GroupInviteSheet.join()과 같은 기준).
      logGroupJoinAttempted({ join_method: 'search' });
      // 서버가 소유한 group_joined([S])도 유입 경로를 알아야 초대 퍼널과 검색 유입을 가를 수 있다
      // (초대 링크 스펙 §4-3 8). 이 경로엔 초대 slug가 없다.
      await joinGroup(group.groupId, { joinMethod: 'search' });
      onJoined();
    } catch (e) {
      // status가 아니라 서버 code로 분기한다 — ROOM_FULL·ALREADY_MEMBER가 둘 다 409(§3-2)
      const code = groupErrorCode(e);
      // 아래 둘은 화면 상태가 아니라 **실제 소속·계정 상태**의 결과라 검색 세대와 무관하게 처리한다.
      if (code === 'ALREADY_MEMBER') {
        // 성공 취급 — 이미 멤버이므로 그룹방으로 보낸다.
        // (시도 계측은 요청 직전에 이미 나갔다 — 여기서 되돌릴 수단은 없고, 되돌릴 이유도 없다.
        //  실제 가입 여부는 서버가 소유한 group_joined가 말한다.)
        onJoined();
        return;
      }
      // 로그인 유도만 Alert로 남긴다 — 시트를 닫고 다른 화면으로 보내는 흐름이라 인라인이 사라진다.
      if (code === 'GUEST_FORBIDDEN') {
        goLogin();
        return;
      }
      // 유저 부재(내 계정이 없어졌다, GROMO-1247) — 그룹 쪽 사정이 아니므로 목록도 문구도
      // 건드리지 않고 세션 정리로 보낸다. 위 둘과 같은 이유로 **검색** 세대와는 무관하게 처리하되,
      // 로그아웃 판정은 **인증** 세대가 맡는다(늦게 온 응답이 새 세션을 끊지 않게).
      if (code === USER_NOT_FOUND) {
        promptSessionExpired(requestSessionGeneration);
        return;
      }
      // 나머지는 '그 검색어의 그 행'에서만 의미가 있는 실패다 — 세대가 바뀌었으면 조용히 버린다.
      if (seq !== searchSeqRef.current) return;
      switch (code) {
        case 'ROOM_FULL':
          setJoinError('정원이 가득 찼어요. 다른 그룹을 찾아보세요.');
          refreshResults();
          break;
        // 참여 상한 초과(2차) — 그룹 쪽 사정이 아니라 내 사정이라 목록은 그대로 둔다
        // (재조회해도 같은 결과가 오고, 다른 그룹을 눌러도 똑같이 막힌다).
        case 'GROUP_LIMIT_EXCEEDED':
          setJoinError('참여할 수 있는 그룹 수를 초과했어요');
          break;
        case 'NOT_FOUND':
          setJoinError('사라진 그룹이에요. 방장이 그룹을 없앴을 수 있어요.');
          setResults((prev) => prev.filter((r) => r.groupId !== group.groupId));
          break;
        default:
          setJoinError('참여하지 못했어요. 잠시 후 다시 시도해주세요.');
      }
    } finally {
      releaseJoinLock(token);
      setJoiningId(null);
    }
  }

  function confirmJoin(group: GroupSearchResponse) {
    Keyboard.dismiss();
    // 확인 Alert 형식은 앱 관행대로 (동작명, 질문) — 인용부호는 쓰지 않는다.
    // 정원은 이미 행에 n/m으로 붙어 있어 문구에서 반복하지 않는다.
    Alert.alert('그룹 참여', `${group.name}에 참여할까요?`, [
      { text: '취소', style: 'cancel' },
      { text: '참여하기', onPress: () => join(group) },
    ]);
  }

  // 목록이 비었을 때의 안내 — 로딩 / 조회 실패 / 결과 없음을 상태별로 말한다.
  // 검색어가 있으면 이름 검색 기준, 비어 있으면 공개방 기본 목록(A-10) 기준으로 문구만 달라진다.
  let emptyNotice: ReactNode = null;
  if (results.length === 0) {
    if (searching) {
      emptyNotice = <Text style={s.emptyText}>{q ? '검색 중…' : '불러오는 중…'}</Text>;
    } else if (searchError) {
      emptyNotice = (
        <>
          <Text style={s.emptyText}>{q ? '검색하지 못했어요' : '불러오지 못했어요'}</Text>
          <TouchableOpacity onPress={retrySearch} hitSlop={12} activeOpacity={0.7}>
            <Text style={s.emptyRetry}>다시 시도</Text>
          </TouchableOpacity>
        </>
      );
    } else {
      emptyNotice = (
        <Text style={s.emptyText}>
          {q ? '그런 이름의 공개 그룹이 없어요' : '아직 공개된 그룹이 없어요'}
        </Text>
      );
    }
  }

  return (
    <SheetShell
      onClose={onClose}
      // ⚠️ 퇴장이 시작되면 **검색 세대를 즉시 올린다.** onClose는 220ms 뒤라 그동안 컴포넌트가
      //    살아 있어, 그 사이 도착한 응답이 결과를 반영하고 계측(logGroupSearchPerformed)까지
      //    쏜다 — 사용자가 이미 닫은 검색의 결과 수가 노출 지표로 집계된다(codex 리뷰).
      //    종전에는 딤 탭이 곧 언마운트라 아래 cleanup이 그 자리에서 막았다.
      onClosing={() => {
        searchSeqRef.current++;
        // 아직 안 뜬 디바운스도 걷는다 — 세대만 올리면 요청은 나가고 응답만 버려진다.
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }}
      asModal
    >
      <Text style={s.title}>그룹 찾기</Text>
      <Text style={s.sub}>이름으로 공개 그룹을 찾아 바로 참여할 수 있어요.</Text>

      {/* ── 검색 인풋(FriendAddScreen:132-149 관행) ── */}
      <View style={s.searchBox}>
        <Ionicons name="search" size={16} color={T.accent} />
        <TextInput
          style={s.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="그룹 이름으로 검색"
          placeholderTextColor={T.inkMuted}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
        {query.length > 0 && (
          <TouchableOpacity style={s.clearBtn} onPress={() => setQuery('')} hitSlop={14}>
            <Ionicons name="close" size={11} color={T.inkMuted} />
          </TouchableOpacity>
        )}
      </View>

      {joinError !== null && <Text style={s.notice}>{joinError}</Text>}

      <ScrollView
        style={s.listScroll}
        contentContainerStyle={s.list}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {results.map((r) => {
          // 이미 속한 그룹은 정원과 무관하게 들어갈 수 있다 — full 판정보다 먼저 본다.
          const mine = groups.some((g) => g.groupId === r.groupId);
          // 정원이 찬 그룹은 흐리게 + 탭 비활성(§6-3)
          const full = !mine && r.currentMembers >= r.maxMembers;
          const joining = joiningId === r.groupId;
          // 소개(F6) — 비었으면(null·미포함·공백뿐) 줄을 그리지 않아 행 높이가 흔들리지 않는다.
          const desc = r.description?.trim();
          return (
            <TouchableOpacity
              key={r.groupId}
              style={[s.row, full && s.rowFull]}
              activeOpacity={0.85}
              disabled={full || joinLocked}
              onPress={() => (mine ? onOpenGroup(r.groupId) : confirmJoin(r))}
            >
              <View style={s.rowBody}>
                <View style={s.rowTitleRow}>
                  <Text style={s.rowName} numberOfLines={1}>
                    {r.name}
                  </Text>
                  {mine && <Text style={s.rowJoinedTag}>참여 중</Text>}
                </View>
                {desc ? (
                  <Text
                    style={s.rowDesc}
                    numberOfLines={2}
                    testID={`group.find.card.${r.groupId}.desc`}
                  >
                    {desc}
                  </Text>
                ) : null}
              </View>
              <Text style={s.rowCount}>
                {r.currentMembers}/{r.maxMembers}
              </Text>
              {joining ? (
                <ActivityIndicator size="small" color={T.accent} />
              ) : full ? (
                <Text style={s.rowFullTag}>정원 가득</Text>
              ) : (
                <Ionicons name="chevron-forward" size={16} color={T.inkMuted} />
              )}
            </TouchableOpacity>
          );
        })}

        {emptyNotice !== null && <View style={s.emptyBox}>{emptyNotice}</View>}
      </ScrollView>

      {/* 키보드 높이만큼 밀어 올린다(패널 자체 paddingBottom과 겹치지 않게 insets 분은 제외하지 않는다) */}
      {keyboardHeight > 0 && <View style={{ height: keyboardHeight }} />}
    </SheetShell>
  );
}

const s = StyleSheet.create({
  title: { ...T.text.body, fontWeight: '800', color: T.ink },
  sub: {
    ...T.text.label,
    fontWeight: '500',
    color: T.inkMuted,
    marginTop: 2,
    marginBottom: T.space.md,
  },

  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space.sm,
    backgroundColor: T.paperAlt,
    borderWidth: 1.5,
    borderColor: T.accent,
    borderRadius: 13,
    paddingHorizontal: T.space.md,
    minHeight: 46,
    paddingVertical: T.space.md,
  },
  searchInput: { ...T.text.label, flex: 1, color: T.ink, padding: 0 },
  clearBtn: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: T.track,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // 참여 실패 인라인 문구 — GroupInviteSheet의 s.notice와 같은 규격
  notice: { ...T.text.caption, color: T.dangerInk, marginTop: T.space.md },

  listScroll: { maxHeight: 320, marginTop: T.space.md },
  list: { gap: T.space.sm, paddingBottom: T.space.xs },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space.md,
    backgroundColor: T.paperAlt,
    borderWidth: 1,
    borderColor: T.border,
    borderRadius: 14,
    paddingHorizontal: T.space.lg,
    paddingVertical: T.space.md,
  },
  rowFull: { opacity: 0.45 },
  // 행 좌측 본문 — 이름 줄 위, 소개 줄(있을 때) 아래를 세로로 쌓는다.
  rowBody: { flex: 1, gap: 2, minWidth: 0 },
  rowTitleRow: { flexDirection: 'row', alignItems: 'center', gap: T.space.md },
  rowName: { ...T.text.label, flexShrink: 1, fontWeight: '700', color: T.ink, minWidth: 0 },
  // 소개 — 이름(label/ink)보다 한 단계 약한 caption/inkSub. 1~2줄 말줄임.
  rowDesc: { ...T.text.caption, color: T.inkSub },
  rowCount: { ...T.text.caption, color: T.inkSub, fontVariant: ['tabular-nums'] },
  rowFullTag: { ...T.text.caption, color: T.inkMuted },
  // '참여 중' 뱃지 — 정원 표시(무채색)와 달리 상태 강조라 accent 칩 규격을 쓴다.
  rowJoinedTag: {
    ...T.text.caption,
    color: T.accentDeep,
    fontWeight: '700',
    backgroundColor: T.accentBg,
    borderRadius: 8,
    paddingHorizontal: T.space.sm,
    paddingVertical: 2,
  },

  emptyBox: {
    alignItems: 'center',
    gap: T.space.sm,
    paddingVertical: T.space.xxl,
  },
  emptyText: { ...T.text.caption, color: T.inkMuted, textAlign: 'center' },
  // 재시도 링크는 그룹 화면 공통 accent 링크 규격(§G-4 — GroupScreen 배너와 같은 값)
  emptyRetry: { ...T.text.caption, color: T.accent },
});
