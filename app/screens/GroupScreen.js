import { useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView,
  TextInput, StyleSheet, Modal, KeyboardAvoidingView, Platform,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { T, inkBox } from '../components/theme';
import { Character2D } from '../components/character/Character2D';

const VARIANTS = ['default', 'focus', 'reading', 'yoga', 'exercise', 'study'];

const MOCK_GROUPS = [
  {
    id: '1',
    name: '새벽 집중반',
    code: 'DAWN01',
    members: [
      { id: 'm1', name: '수빈', variant: 'focus', todaySeconds: 5400, totalSeconds: 86400 },
      { id: 'm2', name: '지민', variant: 'reading', todaySeconds: 3600, totalSeconds: 54000 },
      { id: 'm3', name: '하은', variant: 'study', todaySeconds: 7200, totalSeconds: 120000 },
    ],
  },
  {
    id: '2',
    name: '운동하며 공부',
    code: 'FIT002',
    members: [
      { id: 'm4', name: '준호', variant: 'exercise', todaySeconds: 1800, totalSeconds: 36000 },
      { id: 'm5', name: '유나', variant: 'yoga', todaySeconds: 4500, totalSeconds: 72000 },
    ],
  },
];

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}시간 ${m}분`;
  if (m > 0) return `${m}분`;
  return `${seconds}초`;
}

const RANK_COLORS = [T.yellow, T.inkLight, T.coral];

function MemberCard({ member, rank }) {
  const rankColor = RANK_COLORS[rank - 1] ?? T.paperDark;
  return (
    <View style={[s.memberCard, inkBox(T.paperDark)]}>
      <View style={[s.rankBadge, { backgroundColor: rankColor }]}>
        <Text style={s.rankText}>{rank}</Text>
      </View>
      <View style={s.memberCharWrap}>
        <Character2D size={64} variant={member.variant} />
      </View>
      <View style={s.memberInfo}>
        <Text style={s.memberName}>{member.name}</Text>
        <View style={s.memberStats}>
          <View style={s.memberStat}>
            <Text style={s.memberStatLabel}>오늘</Text>
            <Text style={[s.memberStatValue, { color: T.coral }]}>{formatTime(member.todaySeconds)}</Text>
          </View>
          <View style={s.memberStat}>
            <Text style={s.memberStatLabel}>누적</Text>
            <Text style={[s.memberStatValue, { color: T.sky }]}>{formatTime(member.totalSeconds)}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

function GroupDetailView({ group, onBack }) {
  const sorted = [...group.members].sort((a, b) => b.totalSeconds - a.totalSeconds);
  return (
    <View style={s.container}>
      <TouchableOpacity onPress={onBack} style={s.backBtn}>
        <Text style={s.backText}>← 목록으로</Text>
      </TouchableOpacity>
      <Text style={s.title}>{group.name}</Text>
      <Text style={s.sub}>코드: {group.code} · 멤버 {group.members.length}명</Text>
      <ScrollView showsVerticalScrollIndicator={false} style={s.memberList}>
        {sorted.map((m, i) => <MemberCard key={m.id} member={m} rank={i + 1} />)}
      </ScrollView>
    </View>
  );
}

export default function GroupScreen() {
  const [myGroups, setMyGroups] = useState([MOCK_GROUPS[0]]);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);

  if (selectedGroup) {
    return <GroupDetailView group={selectedGroup} onBack={() => setSelectedGroup(null)} />;
  }

  function handleCreate() {
    if (!newGroupName.trim()) return;
    const newGroup = {
      id: Date.now().toString(),
      name: newGroupName.trim(),
      code: Math.random().toString(36).slice(2, 8).toUpperCase(),
      members: [
        { id: 'me', name: '나', variant: 'default', todaySeconds: 0, totalSeconds: 0 },
      ],
    };
    setMyGroups(prev => [...prev, newGroup]);
    setNewGroupName('');
    setShowCreate(false);
  }

  function handleSearch() {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return;
    const results = MOCK_GROUPS.filter(
      g => g.name.toLowerCase().includes(q) || g.code.toLowerCase().includes(q)
    );
    setSearchResults(results);
  }

  function handleJoin(group) {
    if (myGroups.find(g => g.id === group.id)) return;
    setMyGroups(prev => [...prev, group]);
    setShowSearch(false);
    setSearchQuery('');
    setSearchResults([]);
  }

  const isJoined = (group) => !!myGroups.find(g => g.id === group.id);

  return (
    <View style={s.container}>
      <StatusBar style="dark" />
      <Text style={s.title}>그룹 👥</Text>
      <Text style={s.sub}>같이 집중해요</Text>

      <View style={s.btnRow}>
        <TouchableOpacity style={[s.actionBtn, inkBox(T.sky)]} onPress={() => setShowCreate(true)} activeOpacity={0.8}>
          <Text style={s.actionBtnText}>+ 그룹 만들기</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.actionBtn, inkBox(T.mint)]} onPress={() => setShowSearch(true)} activeOpacity={0.8}>
          <Text style={s.actionBtnText}>🔍 그룹 찾기</Text>
        </TouchableOpacity>
      </View>

      <Text style={s.sectionLabel}>내 그룹</Text>
      <ScrollView showsVerticalScrollIndicator={false}>
        {myGroups.length === 0 && (
          <Text style={s.emptyText}>아직 참가한 그룹이 없어요</Text>
        )}
        {myGroups.map(group => (
          <TouchableOpacity
            key={group.id}
            style={[s.groupCard, inkBox(T.paper)]}
            onPress={() => setSelectedGroup(group)}
            activeOpacity={0.8}
          >
            <View style={s.groupCardTop}>
              <Text style={s.groupName}>{group.name}</Text>
              <Text style={s.groupCode}>{group.code}</Text>
            </View>
            <Text style={s.groupMemberCount}>멤버 {group.members.length}명 →</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* 그룹 만들기 모달 */}
      <Modal visible={showCreate} transparent animationType="fade">
        <KeyboardAvoidingView style={s.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={[s.modalBox, inkBox(T.paper)]}>
            <Text style={s.modalTitle}>그룹 만들기</Text>
            <TextInput
              style={[s.input, inkBox(T.paperDark)]}
              placeholder="그룹 이름"
              placeholderTextColor={T.inkLight}
              value={newGroupName}
              onChangeText={setNewGroupName}
            />
            <View style={s.modalBtnRow}>
              <TouchableOpacity style={[s.modalBtn, inkBox(T.paperDark)]} onPress={() => setShowCreate(false)}>
                <Text style={s.modalBtnText}>취소</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.modalBtn, inkBox(T.yellow)]} onPress={handleCreate}>
                <Text style={s.modalBtnText}>만들기</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* 그룹 찾기 모달 */}
      <Modal visible={showSearch} transparent animationType="fade">
        <KeyboardAvoidingView style={s.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={[s.modalBox, inkBox(T.paper)]}>
            <Text style={s.modalTitle}>그룹 찾기</Text>
            <View style={s.searchRow}>
              <TextInput
                style={[s.input, inkBox(T.paperDark), { flex: 1 }]}
                placeholder="그룹 이름 또는 코드"
                placeholderTextColor={T.inkLight}
                value={searchQuery}
                onChangeText={setSearchQuery}
              />
              <TouchableOpacity style={[s.searchBtn, inkBox(T.sky)]} onPress={handleSearch}>
                <Text style={s.modalBtnText}>검색</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={s.searchResults} showsVerticalScrollIndicator={false}>
              {searchResults.length === 0 && searchQuery.length > 0 && (
                <Text style={s.emptyText}>검색 결과가 없어요</Text>
              )}
              {searchResults.map(group => (
                <View key={group.id} style={[s.searchResultItem, inkBox(T.paperDark)]}>
                  <View>
                    <Text style={s.groupName}>{group.name}</Text>
                    <Text style={s.groupCode}>{group.code} · {group.members.length}명</Text>
                  </View>
                  <TouchableOpacity
                    style={[s.joinBtn, inkBox(isJoined(group) ? T.paperLine : T.mint)]}
                    onPress={() => handleJoin(group)}
                    disabled={isJoined(group)}
                  >
                    <Text style={s.joinBtnText}>{isJoined(group) ? '참가됨' : '참가'}</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>
            <TouchableOpacity style={[s.modalBtn, inkBox(T.paperDark), { alignSelf: 'center', marginTop: 12 }]} onPress={() => { setShowSearch(false); setSearchResults([]); setSearchQuery(''); }}>
              <Text style={s.modalBtnText}>닫기</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: T.paper,
    paddingTop: 64,
    paddingHorizontal: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: '900',
    color: T.ink,
  },
  sub: {
    fontSize: 13,
    color: T.inkMed,
    marginTop: 4,
    marginBottom: 20,
  },
  btnRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 24,
  },
  actionBtn: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
  },
  actionBtnText: {
    fontSize: 13,
    fontWeight: '800',
    color: T.ink,
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: '900',
    color: T.inkMed,
    marginBottom: 10,
    letterSpacing: 1,
  },
  groupCard: {
    padding: 18,
    marginBottom: 12,
  },
  groupCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  groupName: {
    fontSize: 16,
    fontWeight: '900',
    color: T.ink,
  },
  groupCode: {
    fontSize: 11,
    fontWeight: '700',
    color: T.inkLight,
  },
  groupMemberCount: {
    fontSize: 13,
    fontWeight: '700',
    color: T.inkMed,
  },
  emptyText: {
    textAlign: 'center',
    color: T.inkLight,
    fontSize: 13,
    marginTop: 20,
  },

  // Member list (vertical)
  memberList: { marginTop: 16 },

  // Member card
  memberCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    marginBottom: 12,
    gap: 14,
  },
  rankBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: T.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankText: {
    fontSize: 12,
    fontWeight: '900',
    color: T.ink,
  },
  memberCharWrap: {
    width: 64,
    height: 93,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  memberInfo: {
    flex: 1,
  },
  memberName: {
    fontSize: 16,
    fontWeight: '900',
    color: T.ink,
    marginBottom: 8,
  },
  memberStats: {
    flexDirection: 'row',
    gap: 20,
  },
  memberStat: { alignItems: 'flex-start' },
  memberStatLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: T.inkLight,
    marginBottom: 2,
  },
  memberStatValue: {
    fontSize: 13,
    fontWeight: '900',
  },

  // Back
  backBtn: { marginBottom: 12 },
  backText: {
    fontSize: 14,
    fontWeight: '700',
    color: T.inkMed,
  },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(28,18,8,0.4)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  modalBox: {
    padding: 24,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '900',
    color: T.ink,
    marginBottom: 16,
  },
  input: {
    padding: 12,
    fontSize: 14,
    fontWeight: '600',
    color: T.ink,
    marginBottom: 16,
  },
  modalBtnRow: {
    flexDirection: 'row',
    gap: 10,
  },
  modalBtn: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
  },
  modalBtnText: {
    fontSize: 14,
    fontWeight: '800',
    color: T.ink,
  },

  // Search
  searchRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  searchBtn: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    justifyContent: 'center',
  },
  searchResults: { maxHeight: 240 },
  searchResultItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    marginBottom: 10,
  },
  joinBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  joinBtnText: {
    fontSize: 13,
    fontWeight: '800',
    color: T.ink,
  },
});
