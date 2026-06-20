import { useState, useEffect } from 'react';
import { View, Text, Switch, ScrollView, TouchableOpacity, Alert, StyleSheet, Modal, Share } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { T } from '../../components/theme';
import { apiFetch } from '../../utils/api';

function formatExpiry(instant) {
  if (!instant) return '';
  const d = new Date(instant);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${mm}/${dd} ${hh}:${min} 만료`;
}

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

function NavRow({ label, onPress, danger, indent, value }) {
  return (
    <TouchableOpacity style={[s.row, indent && s.rowIndent]} onPress={onPress} activeOpacity={0.7}>
      <Text style={[s.label, danger && s.dangerLabel, indent && s.labelIndent]}>{label}</Text>
      {!danger && (
        <View style={s.navRight}>
          {value != null && <Text style={s.navValue}>{value}</Text>}
          <Text style={s.chevron}>›</Text>
        </View>
      )}
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

export default function SettingsScreen({ groupId, group, isOwner, onLeaveSuccess, onChatEnabledChange, onGroupUpdated }) {
  const insets = useSafeAreaInsets();

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
  const [noticeGrantedIds, setNoticeGrantedIds] = useState([]);

  // 공지 권한 멤버 선택 모달
  const [pickerVisible, setPickerVisible] = useState(false);
  const [pickerSelected, setPickerSelected] = useState([]);

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
    setNoticeGrantedIds(group.noticeGrantedUserIds ?? []);
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
        if (res.ok) {
          Alert.alert('완료', '그룹 이름이 변경됐어요');
          onGroupUpdated?.({ name: newName.trim() });
        } else Alert.alert('오류', '변경에 실패했어요');
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
        if (res.ok) onGroupUpdated?.({ description: desc.trim() });
        else Alert.alert('오류', '변경에 실패했어요');
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
    } else {
      onChatEnabledChange?.(val);
    }
  }

  async function handleNoticePermission(val) {
    const prev = noticePermission;
    setNoticePermission(val);
    const ok = await patchSettings({ noticePermission: val });
    if (!ok) setNoticePermission(prev);
  }

  function openNoticePicker() {
    setPickerSelected([...noticeGrantedIds]);
    setPickerVisible(true);
  }

  function togglePickMember(userId) {
    setPickerSelected((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId],
    );
  }

  async function saveNoticePicker() {
    const prev = [...noticeGrantedIds];
    setNoticeGrantedIds(pickerSelected);
    setPickerVisible(false);
    const ok = await patchSettings({ noticeGrantedUserIds: pickerSelected });
    if (!ok) {
      setNoticeGrantedIds(prev);
      Alert.alert('오류', '설정 변경에 실패했어요');
    }
  }

  async function handleInvitePermission(val) {
    const prev = invitePermission;
    setInvitePermission(val);
    const ok = await patchSettings({ invitePermission: val });
    if (!ok) setInvitePermission(prev);
  }

  function handleLeaveGroup() {
    const memberCount = group?.members?.length ?? 0;
    const isLastMember = memberCount <= 1;

    let message = '정말 이 그룹에서 나갈까요?';
    if (isOwner) {
      message = isLastMember
        ? '마지막 멤버입니다. 탈퇴하면 그룹이 영구적으로 닫혀요.'
        : '방장 권한이 다음 멤버에게 자동으로 위임돼요.';
    }

    Alert.alert(`"${group?.name ?? '그룹'}" 탈퇴`, message, [
      { text: '취소', style: 'cancel' },
      {
        text: isOwner && isLastMember ? '그룹 닫기' : '탈퇴하기',
        style: 'destructive',
        onPress: async () => {
          try {
            const res = await apiFetch(`/api/v1/groups/${groupId}/members/me`, {
              method: 'DELETE',
            });
            if (res.ok) {
              onLeaveSuccess?.();
            } else {
              const body = await res.json().catch(() => ({}));
              Alert.alert('오류', body.message ?? '탈퇴에 실패했어요');
            }
          } catch {
            Alert.alert('오류', '네트워크 오류가 발생했어요');
          }
        },
      },
    ]);
  }

  function handleShareCode() {
    Share.share({ message: `그룹 "${group?.name}" 초대 코드: ${group?.code}` });
  }

  const nonOwnerMembers = (group?.members ?? []).filter((m) => m.role !== 'OWNER');
  const grantedCount = noticeGrantedIds.length;
  const noticeGrantedLabel = grantedCount === 0 ? '없음' : `${grantedCount}명`;

  return (
    <ScrollView
      style={s.root}
      contentContainerStyle={s.content}
      showsVerticalScrollIndicator={false}
    >
      {/* 그룹 정보 — 방장 전용 */}
      {isOwner && (
        <>
          <SectionHeader title="그룹 정보" />
          <View style={s.card}>
            <NavRow label="그룹 이름 변경" onPress={handleRenameGroup} />
            <Divider />
            <NavRow label="한줄소개 설정" onPress={handleEditDescription} />
          </View>

          {/* 채팅 설정 */}
          <SectionHeader title="채팅 설정" />
          <View style={s.card}>
            <ToggleRow
              label="그룹 채팅"
              value={chatEnabled}
              onValueChange={handleToggleChatEnabled}
            />
            {chatEnabled && (
              <>
                <Divider />
                <NavRow label="1인당 채팅 횟수 제한" onPress={handleChatLimit} indent />
                <Divider />
                <NavRow
                  label="멤버별 채팅 허용/비허용"
                  onPress={() => Alert.alert('준비 중', '멤버별 설정은 곧 추가돼요 😊')}
                  indent
                />
              </>
            )}
          </View>

          {/* 권한 설정 */}
          <SectionHeader title="권한 설정" />
          <View style={s.card}>
            <NavRow
              label="공지 작성 권한 부여"
              value={noticeGrantedLabel}
              onPress={openNoticePicker}
            />
            <Divider />
            <SelectorRow
              label="초대 링크 공유"
              value={invitePermission}
              options={[{ label: '모두', value: 'R' }, { label: '방장만', value: 'U' }]}
              onChange={handleInvitePermission}
            />
            {/* 초대 코드 — 방장에게는 항상 표시 */}
            {group?.code && (
              <>
                <Divider />
                <View style={s.codeRow}>
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text style={s.codeLabel}>초대 코드</Text>
                    <Text style={s.codeValue}>{group.code}</Text>
                    {group.codeExpiresAt && (
                      <Text style={s.codeExpiry}>{formatExpiry(group.codeExpiresAt)}</Text>
                    )}
                  </View>
                  <TouchableOpacity onPress={handleShareCode} style={s.shareBtn}>
                    <Text style={s.shareBtnTxt}>공유</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </>
      )}

      {/* 초대 코드 — 비방장에게는 모두 권한일 때만 표시 */}
      {!isOwner && invitePermission === 'R' && group?.code && (
        <>
          <SectionHeader title="초대 코드" />
          <View style={s.card}>
            <View style={s.codeRow}>
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={s.codeLabel}>초대 코드</Text>
                <Text style={s.codeValue}>{group.code}</Text>
                {group.codeExpiresAt && (
                  <Text style={s.codeExpiry}>{formatExpiry(group.codeExpiresAt)}</Text>
                )}
              </View>
              <TouchableOpacity onPress={handleShareCode} style={s.shareBtn}>
                <Text style={s.shareBtnTxt}>공유</Text>
              </TouchableOpacity>
            </View>
          </View>
        </>
      )}

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
          label="콕찌르기 받기"
          value={pokeNotif}
          onValueChange={(v) => {
            setPokeNotif(v);
            saveNotif('poke', v);
          }}
        />
      </View>

      {/* 위험 구역 */}
      <SectionHeader title="위험 구역" />
      <View style={s.card}>
        <NavRow label="그룹 탈퇴" onPress={handleLeaveGroup} danger />
      </View>

      <View style={s.bottomPad} />
    </ScrollView>

    {/* 공지 작성 권한 멤버 선택 모달 */}
    <Modal visible={pickerVisible} animationType="slide" onRequestClose={() => setPickerVisible(false)}>
      <View style={[s.pickerRoot, { paddingTop: insets.top }]}>
        {/* 헤더 */}
        <View style={s.pickerHeader}>
          <TouchableOpacity
            onPress={() => setPickerVisible(false)}
            hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
            style={s.pickerHeaderSide}
          >
            <Text style={s.pickerCancel}>취소</Text>
          </TouchableOpacity>
          <Text style={s.pickerTitle}>공지 작성 권한 부여</Text>
          <TouchableOpacity
            onPress={saveNoticePicker}
            hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
            style={s.pickerHeaderSide}
          >
            <Text style={s.pickerSave}>저장</Text>
          </TouchableOpacity>
        </View>

        <Text style={s.pickerSub}>선택한 멤버는 공지를 직접 작성할 수 있어요. 방장은 항상 가능해요.</Text>

        <ScrollView style={s.pickerList} showsVerticalScrollIndicator={false}>
          {nonOwnerMembers.length === 0 ? (
            <Text style={s.pickerEmpty}>방장 외 멤버가 없어요</Text>
          ) : (
            nonOwnerMembers.map((member, i) => {
              const checked = pickerSelected.includes(member.userId);
              return (
                <TouchableOpacity
                  key={member.userId}
                  style={[s.pickerRow, i > 0 && s.pickerRowBorder]}
                  onPress={() => togglePickMember(member.userId)}
                  activeOpacity={0.7}
                >
                  <View style={s.pickerAvatar}>
                    <Text style={s.pickerAvatarTxt}>{member.nickname?.[0] ?? '?'}</Text>
                  </View>
                  <Text style={s.pickerName}>{member.nickname}</Text>
                  <View style={[s.checkbox, checked && s.checkboxChecked]}>
                    {checked && <Text style={s.checkmark}>✓</Text>}
                  </View>
                </TouchableOpacity>
              );
            })
          )}
        </ScrollView>
      </View>
    </Modal>
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
  rowIndent: { paddingLeft: 32, backgroundColor: 'rgba(0,0,0,0.02)' },
  labelIndent: { color: '#555', fontSize: 14 },
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

  navRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  navValue: { fontSize: 13, fontWeight: '600', color: T.inkLight },

  // 초대 코드
  codeRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14, gap: 12,
  },
  codeLabel: { fontSize: 12, fontWeight: '600', color: T.inkLight },
  codeValue: { fontSize: 20, fontWeight: '900', color: T.ink, letterSpacing: 2 },
  codeExpiry: { fontSize: 11, fontWeight: '500', color: T.inkLight },
  shareBtn: {
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 8, borderWidth: 1.5, borderColor: T.ink,
  },
  shareBtnTxt: { fontSize: 13, fontWeight: '800', color: T.ink },

  // 공지 권한 멤버 선택 모달
  pickerRoot: { flex: 1, backgroundColor: T.paper },
  pickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1.5,
    borderBottomColor: T.ink,
  },
  pickerHeaderSide: { width: 48 },
  pickerCancel: { fontSize: 15, fontWeight: '700', color: T.inkMed },
  pickerSave: { fontSize: 15, fontWeight: '800', color: T.ink, textAlign: 'right' },
  pickerTitle: { fontSize: 16, fontWeight: '900', color: T.ink, textAlign: 'center' },
  pickerSub: {
    fontSize: 13, fontWeight: '500', color: T.inkMed,
    paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: T.paperLine,
  },
  pickerList: { flex: 1 },
  pickerEmpty: { fontSize: 14, fontWeight: '600', color: T.inkLight, textAlign: 'center', marginTop: 60 },
  pickerRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 14, gap: 12,
  },
  pickerRowBorder: { borderTopWidth: 1, borderTopColor: T.paperLine },
  pickerAvatar: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: T.paperDark, borderWidth: 1.5, borderColor: T.paperLine,
    alignItems: 'center', justifyContent: 'center',
  },
  pickerAvatarTxt: { fontSize: 18, fontWeight: '900', color: T.inkMed },
  pickerName: { flex: 1, fontSize: 15, fontWeight: '700', color: T.ink },
  checkbox: {
    width: 24, height: 24, borderRadius: 12,
    borderWidth: 1.5, borderColor: T.paperLine,
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxChecked: { backgroundColor: T.ink, borderColor: T.ink },
  checkmark: { fontSize: 13, fontWeight: '900', color: T.paper },

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
