import { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { T } from '../components/theme';
import { apiFetch } from '../utils/api';
import GroupTab from './group/GroupTab';
import RankingTab from './group/RankingTab';
import ChatTab from './group/ChatTab';
import NoticeTab from './group/NoticeTab';
import ChallengeTab from './group/ChallengeTab';
import SettingsScreen from './group/SettingsScreen';

const TAB_COMPONENTS = {
  group: GroupTab,
  ranking: RankingTab,
  challenge: ChallengeTab,
  chat: ChatTab,
  notice: NoticeTab,
};

export default function GroupDetailScreen({ navigation, route }) {
  const { groupId, activeTab = 'group' } = route.params ?? {};
  const [group, setGroup] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const insets = useSafeAreaInsets();

  function fetchGroup() {
    console.log('[GroupDetail] groupId:', groupId, '타입:', typeof groupId);
    setLoading(true);
    setError(null);
    apiFetch(`/api/v1/groups/${groupId}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          console.log('[GroupDetail] API 실패', res.status, body);
          const msg =
            res.status === 404
              ? '존재하지 않거나 삭제된 그룹이에요'
              : res.status === 403
                ? '접근 권한이 없어요'
                : `서버 오류 (${res.status})`;
          setError(msg);
          return;
        }
        const data = await res.json();
        console.log('[GroupDetail] 멤버 수:', data.members?.length);
        setGroup(data);
        navigation.setParams({ chatEnabled: data.chatEnabled ?? true });
      })
      .catch((e) => {
        console.log('[GroupDetail] 네트워크 오류', e);
        setError('네트워크 오류');
      })
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  }

  function handleRefresh() {
    setRefreshing(true);
    fetchGroup();
  }

  useEffect(() => {
    fetchGroup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  const ActiveTab = TAB_COMPONENTS[activeTab] ?? GroupTab;

  return (
    <View style={s.root}>
      {/* 상단 헤더 + 한줄소개 */}
      <View style={s.headerWrap}>
        <View style={[s.header, { paddingTop: insets.top + 8 }]}>
          {showSettings ? (
            <TouchableOpacity
              onPress={() => {
                setShowSettings(false);
                navigation.setParams({ showSettings: false });
              }}
              hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
              style={s.headerSide}
            >
              <Text style={s.backText}>‹ 뒤로</Text>
            </TouchableOpacity>
          ) : (
            <View style={s.headerSide} />
          )}
          <Text style={s.headerTitle} numberOfLines={1}>
            {showSettings ? '그룹 설정' : (group?.name ?? '')}
          </Text>
          {!showSettings && (
            <TouchableOpacity
              onPress={() => {
                setShowSettings(true);
                navigation.setParams({ showSettings: true });
              }}
              hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
              style={[s.headerSide, s.headerSideRight]}
            >
              <Text style={s.gearText}>⚙</Text>
            </TouchableOpacity>
          )}
          {showSettings && <View style={s.headerSide} />}
        </View>
        {/* 그룹 한줄소개 */}
        {!showSettings && !!group?.description && (
          <View style={s.descriptionBar}>
            <Text style={s.descriptionText} numberOfLines={2}>
              {group.description}
            </Text>
          </View>
        )}
      </View>

      {/* 본문 */}
      <View style={s.content}>
        {loading ? (
          <ActivityIndicator size="large" color={T.ink} style={s.loader} />
        ) : error ? (
          <View style={s.errorWrap}>
            <Text style={s.errorIcon}>😕</Text>
            <Text style={s.errorTitle}>그룹을 불러올 수 없어요</Text>
            <Text style={s.errorText}>{error}</Text>
            <TouchableOpacity style={s.retryBtn} onPress={fetchGroup} activeOpacity={0.8}>
              <Text style={s.retryBtnText}>다시 시도</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={s.backToListBtn}
              onPress={() => navigation.navigate('그룹')}
              activeOpacity={0.8}
            >
              <Text style={s.backToListBtnText}>그룹 목록으로</Text>
            </TouchableOpacity>
          </View>
        ) : showSettings ? (
          <SettingsScreen
            groupId={groupId}
            group={group}
            isOwner={!!group?.code}
            onLeaveSuccess={() => navigation.navigate('그룹')}
            onChatEnabledChange={(val) => navigation.setParams({ chatEnabled: val })}
            onGroupUpdated={(patch) => setGroup((prev) => ({ ...prev, ...patch }))}
          />
        ) : (
          <ActiveTab group={group} groupId={groupId} refreshing={refreshing} onRefresh={handleRefresh} />
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.paper },

  headerWrap: {
    borderBottomWidth: 1.5,
    borderBottomColor: T.ink,
    backgroundColor: T.paper,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  headerSide: { width: 56 },
  headerSideRight: { alignItems: 'flex-end' },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 20,
    fontWeight: '900',
    color: T.ink,
  },
  gearText: { fontSize: 22, color: T.inkMed },
  gearTextActive: { color: T.ink },
  backText: { fontSize: 16, fontWeight: '700', color: T.ink },

  descriptionBar: {
    backgroundColor: T.paperDark,
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  descriptionText: {
    fontSize: 13,
    fontWeight: '500',
    color: T.inkMed,
    textAlign: 'center',
  },

  content: { flex: 1 },
  loader: { marginTop: 80 },

  errorWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 32,
  },
  errorIcon: { fontSize: 40 },
  errorTitle: { fontSize: 16, fontWeight: '900', color: T.ink },
  errorText: { fontSize: 13, fontWeight: '600', color: T.inkMed, textAlign: 'center' },
  retryBtn: {
    marginTop: 4,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderWidth: 1.5,
    borderColor: T.ink,
    borderRadius: 8,
  },
  retryBtnText: { fontSize: 14, fontWeight: '700', color: T.ink },
  backToListBtn: { paddingVertical: 8 },
  backToListBtnText: { fontSize: 13, fontWeight: '700', color: T.inkMed },
});
