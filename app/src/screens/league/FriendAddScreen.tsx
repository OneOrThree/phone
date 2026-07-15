import { useEffect, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import axios from 'axios';
import { Ionicons } from '@expo/vector-icons';
import { T } from '@/constants/theme';
import { tierByLevel } from '@/constants/tiers';
import type { FriendRequestResponse, FriendSearchResultResponse } from '@/types/api';
import type { V2RootStackParamList } from '@/navigation/types';
import {
  acceptFriendRequest,
  fetchReceivedRequests,
  rejectFriendRequest,
  searchFriends,
  sendFriendRequest,
} from '@/services/friendsApi';
import { MemberAvatar } from './components/MemberAvatar';

// 친구 추가 화면 (root stack) — 시안 "친구 추가 · 검색 + 받은 요청".
// 검색(닉네임 trgm, 350ms 디바운스)·신청·받은 요청·수락/거절 모두 실API(./friendsApi).
// 행 탭 시 프로필 상세(FriendProfile — relation 기반 친구/비친구 분기)로 진입.

// 검색 입력 디바운스(ms) — 타이핑 중 과호출 방지
const SEARCH_DEBOUNCE_MS = 350;

export default function FriendAddScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<V2RootStackParamList>>();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FriendSearchResultResponse[]>([]);
  const [searching, setSearching] = useState(false);
  // 신청 직후 pill 즉시 전환용 — 응답 relation 위에 덮는 로컬 오버라이드
  const [sentIds, setSentIds] = useState<Set<string>>(new Set());
  const [requests, setRequests] = useState<FriendRequestResponse[]>([]);

  const q = query.trim();

  // 받은 요청 — 진입 시 1회 조회 (수락/거절은 목록에서 즉시 제거)
  useEffect(() => {
    (async () => {
      try {
        setRequests(await fetchReceivedRequests());
      } catch {
        // 실패 시 빈 목록 유지 — 재진입 시 재시도
      }
    })();
  }, []);

  // 닉네임 검색 — 디바운스 + 언마운트/재입력 시 이전 응답 무시
  useEffect(() => {
    if (!q) {
      setResults([]);
      setSearching(false);
      return;
    }
    let stale = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const rows = await searchFriends(q);
        if (!stale) setResults(rows);
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

  async function sendRequest(userId: string) {
    try {
      await sendFriendRequest(userId);
      setSentIds((prev) => new Set(prev).add(userId));
    } catch (e) {
      // 409 = 이미 친구/이미 보낸 요청 — 요청됨으로 간주
      if (axios.isAxiosError(e) && e.response?.status === 409) {
        setSentIds((prev) => new Set(prev).add(userId));
      } else {
        Alert.alert('친구 신청 실패', '잠시 후 다시 시도해주세요.');
      }
    }
  }

  async function resolveRequest(requestId: string, accept: boolean) {
    try {
      if (accept) {
        await acceptFriendRequest(requestId);
      } else {
        await rejectFriendRequest(requestId);
      }
      setRequests((prev) => prev.filter((r) => r.requestId !== requestId));
    } catch {
      Alert.alert(accept ? '수락 실패' : '거절 실패', '잠시 후 다시 시도해주세요.');
    }
  }

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      {/* ── 헤더 (시안: 원형 백버튼 + 좌측 정렬 제목) ── */}
      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={18} color={T.inkSub} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>친구 추가</Text>
      </View>

      {/* ── 검색 인풋 ── */}
      <View style={s.searchBox}>
        <Ionicons name="search" size={16} color={T.accent} />
        <TextInput
          style={s.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="닉네임으로 검색"
          placeholderTextColor={T.inkMuted}
          autoCapitalize="none"
          returnKeyType="search"
        />
        {query.length > 0 && (
          <TouchableOpacity style={s.clearBtn} onPress={() => setQuery('')} hitSlop={14}>
            <Ionicons name="close" size={11} color={T.inkMuted} />
          </TouchableOpacity>
        )}
      </View>

      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── 검색 결과 ── */}
        {q.length > 0 && (
          <>
            <Text style={s.resultTitle}>
              검색 결과 <Text style={s.resultCount}>{results.length}</Text>
            </Text>
            {results.map((r) => {
              const relation = sentIds.has(r.userId) ? 'PENDING' : r.relation;
              return (
                <TouchableOpacity
                  key={r.userId}
                  style={s.card}
                  activeOpacity={0.85}
                  onPress={() =>
                    navigation.navigate('FriendProfile', {
                      userId: r.userId,
                      nickname: r.nickname,
                      tierLevel: r.tierLevel ?? 1,
                      isFriend: relation === 'FRIEND',
                    })
                  }
                >
                  <MemberAvatar size={34} />
                  <View style={s.cardName}>
                    <Text style={s.name} numberOfLines={1}>
                      {r.nickname}
                    </Text>
                    <Text style={s.sub}>{tierByLevel(r.tierLevel ?? 1).name}</Text>
                  </View>
                  {relation === 'NONE' ? (
                    <TouchableOpacity
                      style={s.reqBtn}
                      onPress={() => sendRequest(r.userId)}
                      activeOpacity={0.85}
                    >
                      <Text style={s.reqBtnText}>친구 신청</Text>
                    </TouchableOpacity>
                  ) : (
                    <View style={s.reqBtnMuted}>
                      <Text style={s.reqBtnTextMuted}>
                        {relation === 'PENDING' ? '요청됨' : '친구 ✓'}
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
            {results.length === 0 && (
              <Text style={s.empty}>{searching ? '검색 중…' : '검색 결과가 없어요'}</Text>
            )}
            <View style={s.divider} />
          </>
        )}

        {/* ── 받은 요청 ── */}
        <View style={s.reqTitleRow}>
          <Text style={s.reqTitle}>받은 요청</Text>
          {requests.length > 0 && (
            <View style={s.reqCountBadge}>
              <Text style={s.reqCountText} allowFontScaling={false}>
                {requests.length}
              </Text>
            </View>
          )}
        </View>
        {requests.map((r) => (
          <TouchableOpacity
            key={r.requestId}
            style={s.card}
            activeOpacity={0.85}
            onPress={() =>
              navigation.navigate('FriendProfile', {
                userId: r.userId,
                nickname: r.nickname,
                tierLevel: r.tierLevel ?? 1,
                isFriend: false,
              })
            }
          >
            <MemberAvatar size={34} />
            <View style={s.cardName}>
              <Text style={s.name} numberOfLines={1}>
                {r.nickname}
              </Text>
              <Text style={s.sub}>{tierByLevel(r.tierLevel ?? 1).name}</Text>
            </View>
            <View style={s.reqActions}>
              <TouchableOpacity
                style={s.rejectBtn}
                onPress={() => resolveRequest(r.requestId, false)}
                activeOpacity={0.8}
              >
                <Ionicons name="close" size={14} color={T.inkMuted} />
              </TouchableOpacity>
              <TouchableOpacity
                style={s.acceptBtn}
                onPress={() => resolveRequest(r.requestId, true)}
                activeOpacity={0.8}
              >
                <Ionicons name="checkmark" size={15} color={T.white} />
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        ))}
        {requests.length === 0 && <Text style={s.empty}>받은 요청이 없어요</Text>}

        {/* ── 안내 카드 ── */}
        <View style={s.notice}>
          <Ionicons name="star" size={15} color={T.accent} />
          <Text style={s.noticeText}>닉네임을 정확히 입력하면 더 빨리 찾을 수 있어요.</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.bg },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 18,
    paddingTop: 6,
    paddingBottom: 12,
  },
  backBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { ...T.text.heading, fontWeight: '800', color: T.ink },

  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    marginHorizontal: 16,
    marginBottom: 12,
    backgroundColor: T.white,
    borderWidth: 1.5,
    borderColor: T.accent,
    borderRadius: 13,
    paddingHorizontal: 13,
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

  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingBottom: 40 },

  resultTitle: {
    ...T.text.caption,
    fontWeight: '700',
    color: T.inkSub,
    marginTop: 2,
    marginBottom: 10,
    marginHorizontal: 4,
  },
  resultCount: { color: T.accent },

  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.paperAlt,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
  },
  cardName: { flex: 1, gap: 1, minWidth: 0 },
  name: { ...T.text.label, fontWeight: '700', color: T.ink },
  sub: { ...T.text.caption, color: T.inkSub },

  reqBtn: {
    backgroundColor: T.accent,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  reqBtnText: { ...T.text.caption, fontWeight: '700', color: T.white },
  reqBtnMuted: {
    backgroundColor: T.bg,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  reqBtnTextMuted: { ...T.text.caption, fontWeight: '700', color: T.inkSub },

  divider: { height: 1, backgroundColor: T.chipBorder, marginVertical: 14, marginHorizontal: 2 },

  reqTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginBottom: 10,
    marginHorizontal: 4,
  },
  reqTitle: { ...T.text.label, fontWeight: '700', color: T.ink },
  reqCountBadge: {
    backgroundColor: T.accentAlt,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  reqCountText: { ...T.text.caption, fontWeight: '700', color: T.white },
  reqActions: { flexDirection: 'row', gap: 6 },
  rejectBtn: {
    width: 32,
    height: 32,
    borderRadius: 9,
    backgroundColor: T.bg,
    borderWidth: 1,
    borderColor: T.chipBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  acceptBtn: {
    width: 32,
    height: 32,
    borderRadius: 9,
    backgroundColor: T.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },

  empty: { ...T.text.caption, color: T.inkMuted, textAlign: 'center', padding: 14 },

  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    backgroundColor: T.accentBg,
    borderWidth: 1,
    borderColor: T.sand,
    borderRadius: 13,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 6,
  },
  noticeText: { ...T.text.caption, flex: 1, fontWeight: '500', color: T.link, lineHeight: 19 },
});
