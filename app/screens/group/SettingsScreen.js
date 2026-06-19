import { useState, useEffect } from 'react';
import {
  View,
  Text,
  Switch,
  ScrollView,
  TouchableOpacity,
  Alert,
  StyleSheet,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { T } from '../../components/theme';
import { apiFetch } from '../../utils/api';

function SectionHeader({ title }) {
  return <Text style={s.sectionHeader}>{title}</Text>;
}

function Divider() {
  return <View style={s.divider} />;
}

function ToggleRow({ label, sub, value, onValueChange }) {
  return (
    <View style={[s.row, sub && s.subRow]}>
      <Text style={[s.label, sub && s.subLabel]}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: T.paperLine, true: T.ink }}
        thumbColor={T.paper}
        ios_backgroundColor={T.paperLine}
      />
    </View>
  );
}

function NavRow({ label, onPress, danger }) {
  return (
    <TouchableOpacity style={s.row} onPress={onPress} activeOpacity={0.7}>
      <Text style={[s.label, danger && s.dangerLabel]}>{label}</Text>
      {!danger && <Text style={s.chevron}>›</Text>}
    </TouchableOpacity>
  );
}

function SelectorRow({ label, value, options, onChange }) {
  return (
    <View style={s.row}>
      <Text style={s.label}>{label}</Text>
      <View style={s.selectorGroup}>
        {options.map((opt) => (
          <TouchableOpacity
            key={opt.value}
            style={[s.selectorBtn, value === opt.value && s.selectorBtnActive]}
            onPress={() => onChange(opt.value)}
            activeOpacity={0.8}
          >
            <Text style={[s.selectorText, value === opt.value && s.selectorTextActive]}>
              {opt.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

export default function SettingsScreen({ groupId, group, isOwner, onLeaveSuccess }) {
  // 알림 설정 (로컬 저장)
  const [chatNotif, setChatNotif] = useState(true);
  const [chatNightNotif, setChatNightNotif] = useState(false);
  const [challengeNotif, setChallengeNotif] = useState(true);
  const [challengeNightNotif, setChallengeNightNotif] = useState(false);
  const [pokeNotif, setPokeNotif] = useState(true);

  // 방장 전용 그룹 설정
  const [chatEnabled, setChatEnabled] = useState(true);
  const [noticePermission, setNoticePermission] = useState('U');
  const [invitePermission, setInvitePermission] = useState('R');

  useEffect(() => {
    async function loadNotifSettings() {
      try {
        const keys = ['chat', 'chat:night', 'challenge', 'challenge:night', 'poke'];
        const vals = await Promise.all(
          keys.map((k) => AsyncStorage.getItem(`gromo:notif:${k}:${groupId}`)),
        );
        if (vals[0] !== null) setChatNotif(vals[0] === 'true');
        if (vals[1] !== null) setChatNightNotif(vals[1] === 'true');
        if (vals[2] !== null) setChallengeNotif(vals[2] === 'true');
        if (vals[3] !== null) setChallengeNightNotif(vals[3] === 'true');
        if (vals[4] !== null) setPokeNotif(vals[4] === 'true');
      } catch {
        // 무시
      }
    }
    loadNotifSettings();
  }, [groupId]);

  useEffect(() => {
    if (!group) return;
    setChatEnabled(group.chatEnabled ?? true);
    setNoticePermission(group.noticePermission ?? 'U');
    setInvitePermission(group.invitePermission ?? 'R');
  }, [group]);

  function saveNotif(key, value) {
    AsyncStorage.setItem(`gromo:notif:${key}:${groupId}`, String(value)).catch(() => {});
  }

  async function patchSettings(payload) {
    try {
      const res = await apiFetch(`/api/v1/groups/${groupId}/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  function handleRenameGroup() {
    Alert.prompt(
      '그룹 이름 변경',
      '새 그룹 이름을 입력하세요',
      async (newName) => {
        if (!newName?.trim()) return;
        const res = await apiFetch(`/api/v1/groups/${groupId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: newName.trim() }),
        });
        if (res.ok) Alert.alert('완료', '그룹 이름이 변경됐어요');
        else Alert.alert('오류', '변경에 실패했어요');
      },
      'plain-text',
      group?.name ?? '',
    );
  }

  function handleEditDescription() {
    Alert.prompt(
      '그룹 한줄소개',
      '그룹을 한 줄로 소개해주세요',
      async (desc) => {
        if (desc === null) return;
        const res = await apiFetch(`/api/v1/groups/${groupId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ description: desc.trim() }),
        });
        if (!res.ok) Alert.alert('오류', '변경에 실패했어요');
      },
      'plain-text',
      group?.description ?? '',
    );
  }

  function handleChatLimit() {
    Alert.prompt(
      '채팅 횟수 제한',
      '1인당 하루 최대 채팅 횟수 (0 = 무제한)',
      async (val) => {
        const num = parseInt(val, 10);
        if (isNaN(num) || num < 0) return;
        const ok = await patchSettings({ chatLimitPerPerson: num });
        if (!ok) Alert.alert('오류', '설정 변경에 실패했어요');
      },
      'plain-text',
      String(group?.chatLimitPerPerson ?? 0),
    );
  }

  async function handleToggleChatEnabled(val) {
    setChatEnabled(val);
    const ok = await patchSettings({ chatEnabled: val });
    if (!ok) {
      setChatEnabled(!val);
      Alert.alert('오류', '설정 변경에 실패했어요');
    }
  }

  async function handleNoticePermission(val) {
    const prev = noticePermission;
    setNoticePermission(val);
    const ok = await patchSettings({ noticePermission: val });
    if (!ok) setNoticePermission(prev);
  }

  async function handleInvitePermission(val) {
    const prev = invitePermission;
    setInvitePermission(val);
    const ok = await patchSettings({ invitePermission: val });
    if (!ok) setInvitePermission(prev);
  }

  function handleLeaveGroup() {
    Alert.alert(`"${group?.name ?? '그룹'}" 탈퇴`, '정말 이 그룹에서 나갈까요?', [
      { text: '취소', style: 'cancel' },
      {
        text: '탈퇴하기',
        style: 'destructive',
        onPress: async () => {
          const res = await apiFetch(`/api/v1/groups/${groupId}/members/me`, {
            method: 'DELETE',
          });
          if (res.ok) onLeaveSuccess?.();
          else Alert.alert('오류', '탈퇴에 실패했어요');
        },
      },
    ]);
  }

  const PERM_OPTIONS = [
    { label: '모두', value: 'R' },
    { label: '방장만', value: 'U' },
  ];

  return (
    <ScrollView
      style={s.root}
      contentContainerStyle={s.content}
      showsVerticalScrollIndicator={false}
    >
      {/* 알림 설정 */}
      <SectionHeader title="알림 설정" />
      <View style={s.card}>
        <ToggleRow
          label="채팅방 알림"
          value={chatNotif}
          onValueChange={(v) => {
            setChatNotif(v);
            saveNotif('chat', v);
          }}
        />
        {chatNotif && (
          <>
            <Divider />
            <ToggleRow
              label="심야 알림 (22:00–07:00)"
              sub
              value={chatNightNotif}
              onValueChange={(v) => {
                setChatNightNotif(v);
                saveNotif('chat:night', v);
              }}
            />
          </>
        )}
        <Divider />
        <ToggleRow
          label="챌린지 알림"
          value={challengeNotif}
          onValueChange={(v) => {
            setChallengeNotif(v);
            saveNotif('challenge', v);
          }}
        />
        {challengeNotif && (
          <>
            <Divider />
            <ToggleRow
              label="심야 알림 (22:00–07:00)"
              sub
              value={challengeNightNotif}
              onValueChange={(v) => {
                setChallengeNightNotif(v);
                saveNotif('challenge:night', v);
              }}
            />
          </>
        )}
        <Divider />
        <ToggleRow
          label="곡찌르기 받기"
          value={pokeNotif}
          onValueChange={(v) => {
            setPokeNotif(v);
            saveNotif('poke', v);
          }}
        />
      </View>

      {/* 그룹 관리 — 방장 전용 */}
      {isOwner && (
        <>
          <SectionHeader title="그룹 관리" />
          <View style={s.card}>
            <NavRow label="그룹 이름 변경" onPress={handleRenameGroup} />
            <Divider />
            <NavRow label="그룹 한줄소개 설정" onPress={handleEditDescription} />
            <Divider />
            <ToggleRow
              label="그룹 채팅"
              value={chatEnabled}
              onValueChange={handleToggleChatEnabled}
            />
            <Divider />
            <NavRow label="1인당 채팅 횟수 제한" onPress={handleChatLimit} />
            <Divider />
            <NavRow
              label="멤버별 채팅 허용/비허용"
              onPress={() => Alert.alert('준비 중', '멤버별 설정은 곧 추가돼요 😊')}
            />
          </View>

          <SectionHeader title="권한 설정" />
          <View style={s.card}>
            <SelectorRow
              label="공지 작성 권한"
              value={noticePermission}
              options={PERM_OPTIONS}
              onChange={handleNoticePermission}
            />
            <Divider />
            <SelectorRow
              label="초대 링크 공유"
              value={invitePermission}
              options={PERM_OPTIONS}
              onChange={handleInvitePermission}
            />
          </View>
        </>
      )}

      {/* 기타 */}
      <SectionHeader title="기타" />
      <View style={s.card}>
        <NavRow label="그룹 탈퇴" onPress={handleLeaveGroup} danger />
      </View>

      <View style={s.bottomPad} />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.paperDark },
  content: { padding: 16 },
  bottomPad: { height: 40 },

  sectionHeader: {
    fontSize: 12,
    fontWeight: '700',
    color: T.inkLight,
    marginTop: 20,
    marginBottom: 8,
    paddingHorizontal: 4,
    letterSpacing: 0.5,
  },

  card: {
    backgroundColor: T.paper,
    borderRadius: 12,
    overflow: 'hidden',
  },

  divider: {
    height: 1,
    backgroundColor: T.paperLine,
    marginHorizontal: 16,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 52,
  },
  subRow: {
    paddingLeft: 32,
    backgroundColor: T.paperDark,
  },

  label: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: T.ink,
  },
  subLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: T.inkMed,
  },
  dangerLabel: {
    color: T.danger,
  },

  chevron: {
    fontSize: 22,
    color: T.inkLight,
    marginLeft: 8,
  },

  selectorGroup: {
    flexDirection: 'row',
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: T.paperLine,
    overflow: 'hidden',
  },
  selectorBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    backgroundColor: T.paper,
  },
  selectorBtnActive: {
    backgroundColor: T.ink,
  },
  selectorText: {
    fontSize: 13,
    fontWeight: '700',
    color: T.inkMed,
  },
  selectorTextActive: {
    color: T.paper,
  },
});
