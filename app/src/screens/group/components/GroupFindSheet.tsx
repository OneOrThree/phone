import { useCallback, useEffect, useState } from 'react';
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
import { groupErrorCode, joinGroup, searchGroups } from '@/services/groupApi';
import { logGroupJoinAttempted, logGroupSearchPerformed } from '@/services/analyticsEvents';
import type { GroupSearchResponse } from '@/types/dto/group';
import type { V2RootStackParamList } from '@/navigation/types';

// 그룹 찾기 시트 — 명세 docs/app/group-plan.md §6-3.
// 이름으로 공개 그룹을 검색해 바로 참여한다. 비공개방은 서버가 검색에서 제외한다.
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

export interface GroupFindSheetProps {
  // 딤 탭·취소 — 부모가 시트를 내린다.
  onClose: () => void;
  // 참여 성공(ALREADY_MEMBER 포함) — 부모가 시트를 내리고 getMyGroups()를 재조회한다.
  onJoined: () => void;
}

export default function GroupFindSheet({ onClose, onJoined }: GroupFindSheetProps) {
  const navigation = useNavigation<NativeStackNavigationProp<V2RootStackParamList>>();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GroupSearchResponse[]>([]);
  const [searching, setSearching] = useState(false);
  // 참여 중인 그룹 id — 연타로 join이 두 번 나가는 것을 막는다
  const [joiningId, setJoiningId] = useState<string | null>(null);
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

  // 이름 검색 — 디바운스 + 언마운트/재입력 시 이전 응답 무시(FriendAddScreen:66-92 패턴).
  // 빈 문자열이면 호출하지 않고 결과를 비운다.
  useEffect(() => {
    // 검색어가 바뀌면 직전 참여 실패 문구는 맥락을 잃는다 — 함께 지운다.
    setJoinError(null);
    if (!q) {
      setResults([]);
      setSearching(false);
      return;
    }
    let stale = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const rows = await searchGroups(q);
        if (!stale) {
          setResults(rows);
          logGroupSearchPerformed({ query_length: q.length, result_count: rows.length });
        }
      } catch {
        if (!stale) setResults([]);
      } finally {
        if (!stale) setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [q]);

  // 참여 실패 후 목록만 조용히 갱신한다(사용자가 친 검색이 아니므로 계측은 쏘지 않는다).
  const refreshResults = useCallback(async () => {
    if (!q) return;
    try {
      setResults(await searchGroups(q));
    } catch {
      // 갱신 실패 시 기존 목록 유지 — 다음 입력에서 다시 시도된다
    }
  }, [q]);

  // 게스트는 GroupScreen이 앞단에서 막지만, 서버가 403을 주면 시트를 닫고 로그인으로 보낸다(§5-3).
  const goLogin = useCallback(() => {
    onClose();
    Alert.alert('로그인이 필요해요', '로그인하면 그룹에 참여할 수 있어요.', [
      { text: '나중에', style: 'cancel' },
      { text: '로그인하기', onPress: () => navigation.navigate('SettingsAccount') },
    ]);
  }, [navigation, onClose]);

  async function join(group: GroupSearchResponse) {
    if (joiningId) return;
    setJoiningId(group.groupId);
    setJoinError(null);
    try {
      await joinGroup(group.groupId);
      logGroupJoinAttempted({ join_method: 'search' });
      onJoined();
    } catch (e) {
      // status가 아니라 서버 code로 분기한다 — ROOM_FULL·ALREADY_MEMBER가 둘 다 409(§3-2)
      switch (groupErrorCode(e)) {
        case 'ALREADY_MEMBER':
          // 성공 취급 — 이미 멤버이므로 그룹방으로 보낸다(새 가입이 아니라 계측은 미발행)
          onJoined();
          break;
        case 'ROOM_FULL':
          setJoinError('정원이 가득 찼어요. 다른 그룹을 찾아보세요.');
          refreshResults();
          break;
        case 'NOT_FOUND':
          setJoinError('사라진 그룹이에요. 방장이 그룹을 없앴을 수 있어요.');
          setResults((prev) => prev.filter((r) => r.groupId !== group.groupId));
          break;
        // 로그인 유도만 Alert로 남긴다 — 시트를 닫고 다른 화면으로 보내는 흐름이라 인라인이 사라진다.
        case 'GUEST_FORBIDDEN':
          goLogin();
          break;
        default:
          setJoinError('참여하지 못했어요. 잠시 후 다시 시도해주세요.');
      }
    } finally {
      setJoiningId(null);
    }
  }

  function confirmJoin(group: GroupSearchResponse) {
    Keyboard.dismiss();
    Alert.alert(
      '이 그룹에 참여할까요?',
      `${group.name} · ${group.currentMembers}/${group.maxMembers}명`,
      [
        { text: '취소', style: 'cancel' },
        { text: '참여하기', onPress: () => join(group) },
      ],
    );
  }

  return (
    <SheetShell onClose={onClose}>
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
          // 정원이 찬 그룹은 흐리게 + 탭 비활성(§6-3)
          const full = r.currentMembers >= r.maxMembers;
          const joining = joiningId === r.groupId;
          return (
            <TouchableOpacity
              key={r.groupId}
              style={[s.row, full && s.rowFull]}
              activeOpacity={0.85}
              disabled={full || joiningId !== null}
              onPress={() => confirmJoin(r)}
            >
              <Text style={s.rowName} numberOfLines={1}>
                {r.name}
              </Text>
              <Text style={s.rowCount}>
                {r.currentMembers}/{r.maxMembers}
              </Text>
              {joining ? (
                <ActivityIndicator size="small" color={T.accent} />
              ) : full ? (
                <Text style={s.rowFullTag}>마감</Text>
              ) : (
                <Ionicons name="chevron-forward" size={16} color={T.inkMuted} />
              )}
            </TouchableOpacity>
          );
        })}

        {q.length === 0 && <Text style={s.empty}>찾고 싶은 그룹 이름을 입력해보세요</Text>}
        {q.length > 0 && results.length === 0 && (
          <Text style={s.empty}>{searching ? '검색 중…' : '그런 이름의 공개 그룹이 없어요'}</Text>
        )}
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
    height: 46,
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
  rowName: { ...T.text.label, flex: 1, fontWeight: '700', color: T.ink, minWidth: 0 },
  rowCount: { ...T.text.caption, color: T.inkSub },
  rowFullTag: { ...T.text.caption, color: T.inkMuted },

  empty: {
    ...T.text.caption,
    color: T.inkMuted,
    textAlign: 'center',
    paddingVertical: T.space.xxl,
  },
});
