import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { T } from '@/v2/constants/theme';
import { tierByLevel } from '@/v2/constants/tiers';
import type { FriendRelation } from '@/types/api';
import { EXAM_BY_USER, RECEIVED_REQUESTS, SEARCH_POOL } from './mock';
import { MemberAvatar } from './components/MemberAvatar';

// 친구 추가 화면 (root stack) — 닉네임 검색 + 검색 결과(친구 신청/요청됨) + 받은 요청(수락/거절).
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
      {/* ── 헤더 ── */}
      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={22} color={T.ink} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>친구 추가</Text>
        <View style={s.backBtn} />
      </View>

      {/* ── 검색 인풋 ── */}
      <View style={s.searchBox}>
        <Ionicons name="search" size={16} color={T.inkMuted} />
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
          <TouchableOpacity onPress={() => setQuery('')} hitSlop={8}>
            <Ionicons name="close-circle" size={17} color={T.inkMuted} />
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
            <Text style={s.sectionTitle}>검색 결과 {results.length}</Text>
            {results.map((r) => {
              const relation = relations[r.userId] ?? 'NONE';
              return (
                <View key={r.userId} style={s.card}>
                  <MemberAvatar size={44} tierLevel={r.tierLevel} />
                  <View style={s.cardName}>
                    <Text style={s.name} numberOfLines={1}>
                      {r.nickname}
                    </Text>
                    <Text style={s.sub}>{tierByLevel(r.tierLevel ?? 1).name}</Text>
                  </View>
                  <TouchableOpacity
                    style={[s.reqBtn, relation !== 'NONE' ? s.reqBtnMuted : null]}
                    disabled={relation !== 'NONE'}
                    onPress={() => sendRequest(r.userId)}
                    activeOpacity={0.85}
                  >
                    {relation === 'FRIEND' && (
                      <Ionicons name="checkmark" size={13} color={T.inkSub} />
                    )}
                    <Text style={[s.reqBtnText, relation !== 'NONE' ? s.reqBtnTextMuted : null]}>
                      {relation === 'NONE'
                        ? '친구 신청'
                        : relation === 'PENDING'
                          ? '요청됨'
                          : '친구'}
                    </Text>
                  </TouchableOpacity>
                </View>
              );
            })}
            {results.length === 0 && <Text style={s.empty}>검색 결과가 없어요</Text>}
            <View style={s.divider} />
          </>
        )}

        {/* ── 받은 요청 ── */}
        <Text style={s.sectionTitle}>받은 요청 {requests.length}</Text>
        {requests.map((r) => (
          <View key={r.requestId} style={s.card}>
            <MemberAvatar size={44} tierLevel={r.tierLevel} />
            <View style={s.cardName}>
              <Text style={s.name} numberOfLines={1}>
                {r.nickname}
              </Text>
              <Text style={s.sub}>
                {tierByLevel(r.tierLevel ?? 1).name} · {EXAM_BY_USER[r.userId] ?? '시험 준비 중'}
              </Text>
            </View>
            <TouchableOpacity
              style={s.rejectBtn}
              onPress={() => resolveRequest(r.requestId)}
              activeOpacity={0.8}
            >
              <Ionicons name="close" size={17} color={T.inkSub} />
            </TouchableOpacity>
            <TouchableOpacity
              style={s.acceptBtn}
              onPress={() => resolveRequest(r.requestId)}
              activeOpacity={0.8}
            >
              <Ionicons name="checkmark" size={17} color={T.white} />
            </TouchableOpacity>
          </View>
        ))}
        {requests.length === 0 && <Text style={s.empty}>받은 요청이 없어요</Text>}

        {/* ── 안내 문구 ── */}
        <View style={s.notice}>
          <Ionicons name="information-circle" size={15} color={T.inkMuted} />
          <Text style={s.noticeText}>
            닉네임으로 검색해 친구를 추가해 보세요. 친구는 나만의 랭킹에서 함께 볼 수 있어요.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.paperLight },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 4,
    paddingBottom: 8,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...T.text.subtitle, color: T.ink },

  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 18,
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.paperAlt,
    borderRadius: 14,
    paddingHorizontal: 13,
    paddingVertical: 11,
  },
  searchInput: { flex: 1, ...T.text.label, fontSize: 16, color: T.ink, padding: 0 },

  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 18, paddingBottom: 40 },
  sectionTitle: { ...T.text.label, color: T.inkSub, marginTop: 18, marginBottom: 9 },

  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.paperAlt,
    borderRadius: 16,
    paddingHorizontal: 13,
    paddingVertical: 10,
    marginBottom: 8,
  },
  cardName: { flex: 1, gap: 1 },
  name: { ...T.text.label, fontSize: 16, color: T.ink },
  sub: { ...T.text.caption, color: T.inkMuted },

  reqBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: T.accent,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  reqBtnMuted: { backgroundColor: '#F1E9DA' },
  reqBtnText: { ...T.text.caption, color: T.white },
  reqBtnTextMuted: { color: T.inkSub },

  rejectBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#F1E9DA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  acceptBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: T.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },

  empty: { ...T.text.caption, color: T.inkMuted, textAlign: 'center', paddingVertical: 14 },
  divider: { height: 1, backgroundColor: '#EDE5D6', marginTop: 10 },

  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: 22,
    paddingHorizontal: 4,
  },
  noticeText: { flex: 1, ...T.text.caption, fontWeight: '500', color: T.inkMuted, lineHeight: 18 },
});
