import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { T } from '@/constants/theme';
import type { V2RootStackParamList } from '@/navigation/types';
import { navigateToDeepLink } from '@/navigation/navigationRef';
import { getInbox, markAllRead, type InboxNotification } from '@/services/notificationInbox';

// 알림 화면 (GROMO-661) — 보관함(notificationInbox)에 저장된 푸시를 최신순 목록으로 보여준다.
// 홈 우측 상단 종에서 진입. 진입 시 전체 읽음 처리되어 홈 종의 빨간 점이 꺼지고,
// 이번 진입 시점에 안 읽었던 알림에는 목록에서 점 표시를 남긴다.
// 데이터 원천은 로컬 보관함 — BE 알림 이력 API가 생기면 notificationInbox만 교체하면 된다.

// 딥링크 목적지별 아이콘 — 서버 푸시 4종의 link(gromo://league·focus·home) 기준, 그 외 기본 종.
function iconForLink(link: string | null): keyof typeof Ionicons.glyphMap {
  const path = link?.replace(/^gromo:\/\//, '').split(/[/?#]/)[0];
  switch (path) {
    case 'league':
      return 'trophy-outline';
    case 'focus':
      return 'book-outline';
    default:
      return 'notifications-outline';
  }
}

// 수신 시각 → 상대 표기. 일주일 넘으면 날짜로.
function timeAgo(receivedAt: number): string {
  const minutes = Math.floor((Date.now() - receivedAt) / 60000);
  if (minutes < 1) return '방금';
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}일 전`;
  const d = new Date(receivedAt);
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

export default function NotificationsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<V2RootStackParamList>>();
  const [items, setItems] = useState<InboxNotification[]>([]);

  // 진입 시 목록 스냅샷을 뜨고 나서 전체 읽음 처리 — 화면에는 진입 시점의 안읽음 점이 남고,
  // 홈 종 뱃지는 구독(subscribeInbox)을 통해 즉시 꺼진다.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        const list = await getInbox();
        if (cancelled) return;
        setItems(list);
        await markAllRead();
      })();
      return () => {
        cancelled = true;
      };
    }, []),
  );

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      {/* ── 헤더 (원형 백버튼 + 좌측 정렬 제목 — 친구 추가 화면과 동일 패턴) ── */}
      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={18} color={T.inkSub} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>알림</Text>
      </View>

      {items.length === 0 ? (
        // ── 빈 상태 ──
        <View style={s.emptyWrap}>
          <View style={s.emptyIcon}>
            <Ionicons name="notifications-off-outline" size={26} color={T.inkMuted} />
          </View>
          <Text style={s.emptyTitle}>아직 도착한 알림이 없어요</Text>
          <Text style={s.emptySub}>새 소식이 오면 여기에 모아둘게요</Text>
        </View>
      ) : (
        <ScrollView
          style={s.scroll}
          contentContainerStyle={s.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {items.map((n) => (
            <TouchableOpacity
              key={n.id}
              style={s.card}
              activeOpacity={0.85}
              disabled={!n.link}
              onPress={() => {
                if (n.link) navigateToDeepLink(n.link);
              }}
            >
              <View style={s.cardIcon}>
                <Ionicons name={iconForLink(n.link)} size={17} color={T.accent} />
              </View>
              <View style={s.cardBody}>
                <View style={s.titleRow}>
                  <Text style={s.title} numberOfLines={1}>
                    {n.title}
                  </Text>
                  {!n.read && <View style={s.unreadDot} />}
                </View>
                {n.body.length > 0 && (
                  <Text style={s.body} numberOfLines={2}>
                    {n.body}
                  </Text>
                )}
                <Text style={s.time}>{timeAgo(n.receivedAt)}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
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

  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingBottom: 40 },

  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 11,
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.paperAlt,
    borderRadius: 14,
    paddingHorizontal: 13,
    paddingVertical: 12,
    marginBottom: 8,
  },
  cardIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: T.accentBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBody: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { ...T.text.label, fontWeight: '700', color: T.ink, flexShrink: 1 },
  unreadDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: T.accentAlt },
  body: { ...T.text.caption, fontWeight: '500', color: T.inkSub, lineHeight: 19, marginTop: 2 },
  time: { ...T.text.caption, color: T.inkMuted, marginTop: 5 },

  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 60 },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: T.chipBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  emptyTitle: { ...T.text.label, fontWeight: '700', color: T.inkSub },
  emptySub: { ...T.text.caption, color: T.inkMuted, marginTop: 4 },
});
