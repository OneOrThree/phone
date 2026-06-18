import { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Clipboard,
} from 'react-native';
import { T, inkBox } from '../../components/theme';
import { apiFetch } from '../../utils/api';

const MISSION_CATEGORY = { FOCUS: '집중', SCREEN_TIME: '스크린타임' };
const STATUS_LABEL = { WAITING: '대기 중', ACTIVE: '활성', ENDED: '종료' };
const ROLE_LABEL = { OWNER: '호스트', MEMBER: '멤버' };

const SORT_OPTIONS = [{ key: 'focusTime', label: '⏱ 집중', field: 'focusTimeMinutes' }];

function formatWindowTime(instant) {
  if (!instant) return '';
  const d = new Date(instant);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatExpiry(instant) {
  if (!instant) return '만료됨';
  const diff = new Date(instant) - Date.now();
  if (diff <= 0) return '만료됨';
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  return h > 0 ? `${h}시간 ${m}분 후 만료` : `${m}분 후 만료`;
}

function formatMinutes(min) {
  if (!min) return '0분';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}시간 ${m}분` : `${m}분`;
}

export default function GroupTab({ group, groupId }) {
  const [code, setCode] = useState(group?.code ?? null);
  const [codeExpiresAt, setCodeExpiresAt] = useState(group?.codeExpiresAt ?? null);
  const [renewLoading, setRenewLoading] = useState(false);
  const [sortBy, setSortBy] = useState('focusTime');
  const [sortOrder, setSortOrder] = useState('desc');

  const isOwner = !!code;

  const missionText = !group
    ? ''
    : group.missionType === 'DURATION'
      ? `${MISSION_CATEGORY[group.missionCategory] ?? group.missionCategory} · ${group.durationMinutes}분`
      : `${MISSION_CATEGORY[group.missionCategory] ?? group.missionCategory} · ${formatWindowTime(group.windowStart)} ~ ${formatWindowTime(group.windowEnd)}`;

  async function handleRenewCode() {
    setRenewLoading(true);
    try {
      const res = await apiFetch(`/api/v1/groups/${groupId}/code`, { method: 'POST' });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setCode(data.code);
      setCodeExpiresAt(data.codeExpiresAt);
    } catch {
      Alert.alert('오류', '코드 갱신에 실패했습니다');
    } finally {
      setRenewLoading(false);
    }
  }

  function handleCopyCode() {
    if (!code) return;
    Clipboard.setString(code);
    Alert.alert('복사 완료', `${code} 복사됨`);
  }

  function handleSortPress(key) {
    if (sortBy === key) {
      setSortOrder((o) => (o === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortBy(key);
      setSortOrder('desc');
    }
  }

  if (!group) return null;

  const sortField = SORT_OPTIONS.find((o) => o.key === sortBy)?.field ?? 'screenTimeMinutes';
  const sortedMembers = [...(group.members ?? [])].sort((a, b) =>
    sortOrder === 'desc' ? b[sortField] - a[sortField] : a[sortField] - b[sortField],
  );

  return (
    <ScrollView style={s.container} showsVerticalScrollIndicator={false}>
      {/* 그룹 정보 */}
      <Section title="그룹 정보">
        {!!group.description && <Text style={s.description}>{group.description}</Text>}
        <InfoRow label="미션" value={missionText} />
        <InfoRow label="인원" value={`${group.members?.length ?? 0}/${group.maxMembers}명`} />
        <InfoRow label="상태" value={STATUS_LABEL[group.status] ?? group.status} />
      </Section>

      {/* 초대 코드 — OWNER에게만 표시 */}
      {isOwner && (
        <Section title="초대 코드">
          <TouchableOpacity
            style={[s.codeBox, inkBox(T.paperDark)]}
            onPress={handleCopyCode}
            activeOpacity={0.8}
          >
            <Text style={s.codeText}>{code}</Text>
            <Text style={s.codeCopy}>복사</Text>
          </TouchableOpacity>
          <Text style={s.codeExpiry}>{formatExpiry(codeExpiresAt)}</Text>
          <TouchableOpacity
            style={[s.renewBtn, inkBox(T.paperDark), renewLoading && s.btnDisabled]}
            onPress={handleRenewCode}
            disabled={renewLoading}
            activeOpacity={0.8}
          >
            <Text style={s.renewBtnText}>{renewLoading ? '갱신 중...' : '↻  코드 갱신'}</Text>
          </TouchableOpacity>
        </Section>
      )}

      {/* 멤버 목록 */}
      <Section title={`멤버 ${group.members?.length ?? 0}명`}>
        {/* 정렬 토글 */}
        <View style={s.sortRow}>
          <Text style={s.sortLabel}>정렬</Text>
          {SORT_OPTIONS.map(({ key, label }) => {
            const active = sortBy === key;
            return (
              <TouchableOpacity
                key={key}
                style={[s.sortBtn, active && s.sortBtnActive]}
                onPress={() => handleSortPress(key)}
                activeOpacity={0.8}
              >
                <Text style={[s.sortBtnText, active && s.sortBtnTextActive]}>
                  {label} {active ? (sortOrder === 'desc' ? '↓' : '↑') : ''}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {sortedMembers.map((member) => (
          <View key={member.userId} style={[s.memberRow, inkBox(T.paperDark)]}>
            <View style={s.memberLeft}>
              <Text style={s.memberName}>{member.nickname}</Text>
              <View style={s.memberStats}>
                <Text style={[s.statText, s.statTextActive]}>
                  ⏱ {formatMinutes(member.focusTimeMinutes)}
                </Text>
              </View>
            </View>
            <View style={[s.roleBadge, member.role === 'OWNER' && s.roleBadgeOwner]}>
              <Text style={[s.roleBadgeText, member.role === 'OWNER' && s.roleBadgeTextOwner]}>
                {ROLE_LABEL[member.role] ?? member.role}
              </Text>
            </View>
          </View>
        ))}
      </Section>

      <View style={s.scrollBottom} />
    </ScrollView>
  );
}

function Section({ title, children }) {
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function InfoRow({ label, value }) {
  return (
    <View style={s.infoRow}>
      <Text style={s.infoLabel}>{label}</Text>
      <Text style={s.infoValue}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.paper, paddingHorizontal: 20 },
  scrollBottom: { height: 80 },

  section: { marginTop: 24 },
  sectionTitle: { fontSize: 13, fontWeight: '800', color: T.inkMed, marginBottom: 12 },

  description: { fontSize: 14, color: T.ink, lineHeight: 20, marginBottom: 12 },

  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: T.paperLine,
  },
  infoLabel: { fontSize: 13, fontWeight: '700', color: T.inkMed },
  infoValue: { fontSize: 13, fontWeight: '700', color: T.ink },

  codeBox: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
  },
  codeText: { fontSize: 22, fontWeight: '900', color: T.ink, letterSpacing: 4 },
  codeCopy: { fontSize: 13, fontWeight: '700', color: T.inkMed },
  codeExpiry: { fontSize: 12, color: T.inkLight, marginTop: 8, marginBottom: 12 },
  renewBtn: { padding: 12, alignItems: 'center' },
  renewBtnText: { fontSize: 14, fontWeight: '700', color: T.inkMed },
  btnDisabled: { opacity: 0.4 },

  sortRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  sortLabel: { fontSize: 12, fontWeight: '700', color: T.inkLight, marginRight: 4 },
  sortBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: T.paperLine,
    backgroundColor: T.paper,
  },
  sortBtnActive: {
    borderColor: T.ink,
    backgroundColor: T.paperDark,
  },
  sortBtnText: { fontSize: 12, fontWeight: '700', color: T.inkLight },
  sortBtnTextActive: { color: T.ink },

  memberRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 14,
    marginBottom: 8,
  },
  memberLeft: { flex: 1, gap: 4 },
  memberName: { fontSize: 14, fontWeight: '700', color: T.ink },
  memberStats: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statText: { fontSize: 12, fontWeight: '600', color: T.inkLight },
  statTextActive: { color: T.inkMed, fontWeight: '800' },
  statDot: { fontSize: 12, color: T.paperLine },

  roleBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: T.paperDark,
    borderWidth: 1,
    borderColor: T.paperLine,
  },
  roleBadgeOwner: { backgroundColor: T.ink },
  roleBadgeText: { fontSize: 11, fontWeight: '700', color: T.inkMed },
  roleBadgeTextOwner: { color: T.paper },
});
