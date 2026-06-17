import { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { T } from '../components/theme';
import { apiFetch } from '../utils/api';

const GROUP_TABS = [
  { key: 'chat', label: '채팅', icon: '💬' },
  { key: 'notice', label: '공지', icon: '📢' },
  { key: 'challenge', label: '챌린지', icon: '🎯' },
  { key: 'ranking', label: '랭킹', icon: '🏆' },
];

const BAR_H = 62;

export default function GroupDetailScreen({ navigation, route }) {
  const { groupId } = route.params;
  const [activeTab, setActiveTab] = useState('chat');
  const [group, setGroup] = useState(null);
  const [loading, setLoading] = useState(true);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    apiFetch(`/api/v1/groups/${groupId}`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then(setGroup)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [groupId]);

  return (
    <View style={s.root}>
      {/* 상단 헤더 */}
      <View style={[s.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          onPress={() => navigation.navigate('그룹')}
          hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
          style={s.headerSide}
        >
          <Text style={s.backText}>‹ 뒤로</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle} numberOfLines={1}>
          {group?.name ?? ''}
        </Text>
        <TouchableOpacity
          onPress={() => {}}
          hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
          style={[s.headerSide, s.headerSideRight]}
        >
          <Text style={s.gearText}>⚙</Text>
        </TouchableOpacity>
      </View>

      {/* 본문 */}
      <View style={s.content}>
        {loading ? (
          <ActivityIndicator size="large" color={T.ink} style={s.loader} />
        ) : (
          <PlaceholderContent tab={activeTab} />
        )}
      </View>

      {/* 하단 커스텀 탭바 */}
      <View style={[s.tabBar, { height: BAR_H + insets.bottom }]}>
        {GROUP_TABS.map(({ key, label, icon }) => {
          const active = activeTab === key;
          return (
            <TouchableOpacity
              key={key}
              style={s.tabItem}
              onPress={() => setActiveTab(key)}
              activeOpacity={0.7}
            >
              <Text style={active ? s.tabIconActive : s.tabIcon}>{icon}</Text>
              <Text style={active ? s.tabLabelActive : s.tabLabel}>{label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

function PlaceholderContent({ tab }) {
  const LABEL = { chat: '채팅', notice: '공지', challenge: '챌린지', ranking: '랭킹' };
  return (
    <View style={s.placeholderWrap}>
      <Text style={s.placeholderIcon}>🚧</Text>
      <Text style={s.placeholderText}>{LABEL[tab]} 준비 중이에요</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.paper },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: 1.5,
    borderBottomColor: T.ink,
    backgroundColor: T.paper,
  },
  headerSide: { width: 56 },
  headerSideRight: { alignItems: 'flex-end' },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '900',
    color: T.ink,
  },
  backText: { fontSize: 16, fontWeight: '700', color: T.inkMed },
  gearText: { fontSize: 22, color: T.ink },

  content: { flex: 1 },
  loader: { marginTop: 80 },

  placeholderWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  placeholderIcon: { fontSize: 32, marginBottom: 12 },
  placeholderText: { fontSize: 15, fontWeight: '700', color: T.inkLight },

  tabBar: {
    flexDirection: 'row',
    backgroundColor: T.paper,
    borderTopWidth: 1.5,
    borderTopColor: T.ink,
    alignItems: 'flex-start',
  },
  tabItem: {
    flex: 1,
    height: BAR_H,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  tabIcon: { fontSize: 18, color: T.inkLight },
  tabIconActive: { fontSize: 20, color: T.ink },
  tabLabel: { fontSize: 10, fontWeight: '600', color: T.inkLight },
  tabLabelActive: { fontSize: 10, fontWeight: '800', color: T.ink },
});
