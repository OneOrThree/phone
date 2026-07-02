import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { T } from '@/v2/constants/theme';
import { tierByLevel } from '@/v2/constants/tiers';
import type { FriendRelation } from '@/types/api';
import { RECEIVED_REQUESTS, SEARCH_POOL } from './mock';
import { MemberAvatar } from './components/MemberAvatar';

// 친구 추가 화면 (root stack) — 시안 "친구 추가 · 검색 + 받은 요청".
// 검색 결과(친구 신청/요청됨 pill) + 받은 요청(거절/수락 사각 버튼) + 안내 카드.
// 버튼은 로컬 상태 토글 — TODO: /friends/search·/friends/requests(accept·reject) API 연동.

export default function FriendAddScreen() {
  const navigation = useNavigation();
  const [query, setQuery] = useState('');
  // 검색 결과별 관계 상태 — 신청 시 NONE → PENDING 로컬 토글
  const [relations, setRelations] = useState<Record<string, FriendRelation>>(() =>
    Object.fromEntries(SEARCH_POOL.map((r) => [r.userId, r.relation])),
  );
  const [requests, setRequests] = useState(RECEIVED_REQUESTS);

  const q = query.trim();
  const results = q ? SEARCH_POOL.filter((r) => r.nickname.includes(q)) : [];

  function sendRequest(userId: string) {
    // TODO: POST /friends/requests 연동
    setRelations((prev) => ({ ...prev, [userId]: 'PENDING' }));
  }

  function resolveRequest(requestId: string) {
    // TODO: POST /friends/requests/{id}/accept·reject 연동 — 지금은 목록에서 제거만
    setRequests((prev) => prev.filter((r) => r.requestId !== requestId));
  }

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      {/* ── 헤더 (시안: 원형 백버튼 + 좌측 정렬 제목) ── */}
      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={18} color="#5C5246" />
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
          <TouchableOpacity style={s.clearBtn} onPress={() => setQuery('')} hitSlop={8}>
            <Ionicons name="close" size={11} color="#9A8C7C" />
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
              const relation = relations[r.userId] ?? 'NONE';
              return (
                <View key={r.userId} style={s.card}>
                  <MemberAvatar size={34} tierLevel={r.tierLevel} />
                  <View style={s.cardName}>
                    <Text style={s.name} numberOfLines={1}>
                      {r.nickname}
                    </Text>
                    <Text style={s.sub}>
                      {tierByLevel(r.tierLevel ?? 1).name} · {r.exam}
                    </Text>
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
                </View>
              );
            })}
            {results.length === 0 && <Text style={s.empty}>검색 결과가 없어요</Text>}
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
          <View key={r.requestId} style={s.card}>
            <MemberAvatar size={34} tierLevel={r.tierLevel} />
            <View style={s.cardName}>
              <Text style={s.name} numberOfLines={1}>
                {r.nickname}
              </Text>
              <Text style={s.sub}>
                {tierByLevel(r.tierLevel ?? 1).name} · {r.exam}
              </Text>
            </View>
            <View style={s.reqActions}>
              <TouchableOpacity
                style={s.rejectBtn}
                onPress={() => resolveRequest(r.requestId)}
                activeOpacity={0.8}
              >
                <Ionicons name="close" size={14} color="#9A8C7C" />
              </TouchableOpacity>
              <TouchableOpacity
                style={s.acceptBtn}
                onPress={() => resolveRequest(r.requestId)}
                activeOpacity={0.8}
              >
                <Ionicons name="checkmark" size={15} color={T.white} />
              </TouchableOpacity>
            </View>
          </View>
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
  root: { flex: 1, backgroundColor: '#F1EADD' },

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
  headerTitle: { fontSize: 20, fontWeight: '800', color: T.ink },

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
  searchInput: { flex: 1, fontSize: 15, fontWeight: '600', color: T.ink, padding: 0 },
  clearBtn: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#EFE7D8',
    alignItems: 'center',
    justifyContent: 'center',
  },

  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingBottom: 40 },

  resultTitle: {
    fontSize: 13,
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
  name: { fontSize: 14, fontWeight: '700', color: T.ink },
  sub: { fontSize: 11, fontWeight: '600', color: T.inkSub },

  reqBtn: {
    backgroundColor: T.accent,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  reqBtnText: { fontSize: 12, fontWeight: '700', color: T.white },
  reqBtnMuted: {
    backgroundColor: '#F1EADD',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  reqBtnTextMuted: { fontSize: 12, fontWeight: '700', color: T.inkSub },

  divider: { height: 1, backgroundColor: '#E2D7C4', marginVertical: 14, marginHorizontal: 2 },

  reqTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginBottom: 10,
    marginHorizontal: 4,
  },
  reqTitle: { fontSize: 14, fontWeight: '700', color: T.ink },
  reqCountBadge: {
    backgroundColor: T.accentAlt,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  reqCountText: { fontSize: 10, fontWeight: '700', color: T.white },
  reqActions: { flexDirection: 'row', gap: 6 },
  rejectBtn: {
    width: 32,
    height: 32,
    borderRadius: 9,
    backgroundColor: '#F1EADD',
    borderWidth: 1,
    borderColor: '#E2D7C4',
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

  empty: { fontSize: 12, fontWeight: '600', color: T.inkMuted, textAlign: 'center', padding: 14 },

  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    backgroundColor: '#FBF3E8',
    borderWidth: 1,
    borderColor: '#EBDCC2',
    borderRadius: 13,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 6,
  },
  noticeText: { flex: 1, fontSize: 12, fontWeight: '500', color: T.link, lineHeight: 18 },
});
