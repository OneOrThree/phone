import { useState, useEffect, useCallback, type ReactNode } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Switch,
  Modal,
  Platform,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import axios from 'axios';
import DateTimePicker from '@react-native-community/datetimepicker';
import { T, inkBox } from '@/constants/legacyTheme';
import { DrumPicker } from '@/components/LegacyDrumPicker';
import { api } from '@/services/api';
import type { TabScreenProps } from '@/types/navigation';

// 내 그룹 목록 아이템 (/api/v1/groups)
interface GroupListItem {
  groupId: string;
  name: string;
  role?: string;
  status?: string;
  description?: string;
  code?: string;
  currentMembers?: number;
  maxMembers?: number;
}

// 그룹 검색 결과 (/api/v1/groups/search)
interface GroupSearchItem {
  groupId: string;
  name: string;
  status?: string;
  currentMembers?: number;
  maxMembers?: number;
  hasPassword?: boolean;
}

// 그룹 개요 (/api/v1/groups/{id}/overview)
interface GroupOverview {
  name: string;
  description?: string;
  status?: string;
  missionType?: string;
  missionCategory?: string;
  durationMinutes?: number;
  windowStart?: string;
  windowEnd?: string;
  memberCount: number;
  maxMembers: number;
  hasPassword?: boolean;
  isMember?: boolean;
}

type PickerType = 'maxMembers' | 'duration' | 'windowStart' | 'windowEnd';

const STATUS_LABEL: Record<string, string> = { WAITING: '대기중', ACTIVE: '활성', ENDED: '종료' };
const ROLE_LABEL: Record<string, string> = { OWNER: '호스트', MEMBER: '멤버' };

const MEMBER_OPTIONS = Array.from({ length: 10 }, (_, i) => ({
  label: `${i + 1}명`,
  value: i + 1,
}));
const DURATION_OPTIONS = [15, 30, 45, 60, 90, 120].map((n) => ({ label: `${n}분`, value: n }));
const PICKER_TITLE: Record<string, string> = {
  maxMembers: '정원',
  duration: '지속 시간',
  windowStart: '시작 시간',
  windowEnd: '종료 시간',
};

function makeTime(hour: number, minute: number): Date {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d;
}
function formatTime(date: Date): string {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

// ───────────────────────────── G1: 그룹 목록 ─────────────────────────────

interface GroupListViewProps {
  groups: GroupListItem[];
  loading: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  onCreatePress: () => void;
  onSearchSubmit: (query: string) => void;
  onGroupPress: (groupId: string) => void;
}

function GroupListView({
  groups,
  loading,
  refreshing,
  onRefresh,
  onCreatePress,
  onSearchSubmit,
  onGroupPress,
}: GroupListViewProps) {
  const [searchQuery, setSearchQuery] = useState('');

  const filtered = searchQuery.trim()
    ? groups.filter(
        (g) =>
          g.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (g.code ?? '').toUpperCase().includes(searchQuery.toUpperCase()),
      )
    : groups;

  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator size="large" color={T.ink} />
      </View>
    );
  }

  return (
    <View style={s.container}>
      <StatusBar style="dark" />
      <View style={s.header}>
        <Text style={s.headerTitle}>그룹 목록</Text>
        <View style={s.headerSpacer} />
      </View>

      {/* 내 그룹 로컬 검색창 */}
      <View style={[s.listSearchBar, inkBox(T.paperDark)]}>
        <TextInput
          style={s.listSearchInput}
          placeholder="내 그룹 검색 (이름 또는 코드)"
          placeholderTextColor={T.inkLight}
          value={searchQuery}
          onChangeText={setSearchQuery}
          onSubmitEditing={() => searchQuery.trim() && onSearchSubmit(searchQuery.trim())}
          returnKeyType="search"
          clearButtonMode="while-editing"
          autoCapitalize="none"
        />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        keyboardShouldPersistTaps="handled"
      >
        {filtered.length === 0 && (
          <View style={s.emptyWrap}>
            {searchQuery.trim() ? (
              <>
                <Text style={s.emptyTitle}>검색 결과가 없어요</Text>
                <Text style={s.emptyBody}>엔터를 눌러 전체 그룹을 검색해보세요</Text>
              </>
            ) : (
              <>
                <Text style={s.emptyTitle}>아직 참가한 그룹이 없어요</Text>
                <Text style={s.emptyBody}>+ 버튼으로 그룹을 만들거나 검색해보세요</Text>
              </>
            )}
          </View>
        )}
        {filtered.map((group) => (
          <TouchableOpacity
            key={group.groupId}
            style={[s.groupCard, inkBox(T.paperDark)]}
            onPress={() => onGroupPress(group.groupId)}
            activeOpacity={0.85}
          >
            <View style={s.groupCardTop}>
              <Text style={s.groupName} numberOfLines={1}>
                {group.name}
              </Text>
              <View style={s.badgeRow}>
                <View style={[s.badge, group.role === 'OWNER' ? s.badgeOwner : s.badgeMember]}>
                  <Text style={[s.badgeText, group.role === 'OWNER' && s.badgeTextOwner]}>
                    {ROLE_LABEL[group.role ?? ''] ?? group.role}
                  </Text>
                </View>
                <View style={s.badge}>
                  <Text style={s.badgeText}>
                    {STATUS_LABEL[group.status ?? ''] ?? group.status}
                  </Text>
                </View>
              </View>
            </View>
            <View style={s.groupCardBottom}>
              <Text style={s.groupCode} numberOfLines={1}>
                {group.description ?? ''}
              </Text>
              <Text style={s.groupMembers}>
                👥 {group.currentMembers}/{group.maxMembers}명
              </Text>
            </View>
          </TouchableOpacity>
        ))}
        <View style={s.scrollBottom} />
      </ScrollView>

      <TouchableOpacity style={s.fab} onPress={onCreatePress} activeOpacity={0.8}>
        <Text style={s.fabText}>+</Text>
      </TouchableOpacity>
    </View>
  );
}

// ───────────────────────────── G2: 그룹 생성 ─────────────────────────────

interface CreateGroupViewProps {
  onBack: () => void;
  onCreated: () => void;
}

function CreateGroupView({ onBack, onCreated }: CreateGroupViewProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [password, setPassword] = useState('');
  const [maxMembers, setMaxMembers] = useState(10);
  const [missionType, setMissionType] = useState('DURATION');
  const [missionCategory, setMissionCategory] = useState('FOCUS');
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [windowStart, setWindowStart] = useState(() => makeTime(9, 0));
  const [windowEnd, setWindowEnd] = useState(() => makeTime(22, 0));
  const [loading, setLoading] = useState(false);

  // 드럼 피커 모달 상태
  const [pickerOpen, setPickerOpen] = useState<PickerType | null>(null);
  const [draftIdx, setDraftIdx] = useState(0);
  const [draftTime, setDraftTime] = useState(new Date());

  function openPicker(type: PickerType) {
    if (type === 'maxMembers') {
      setDraftIdx(MEMBER_OPTIONS.findIndex((o) => o.value === maxMembers));
    } else if (type === 'duration') {
      const idx = DURATION_OPTIONS.findIndex((o) => o.value === durationMinutes);
      setDraftIdx(idx < 0 ? 3 : idx);
    } else if (type === 'windowStart') {
      setDraftTime(windowStart);
    } else if (type === 'windowEnd') {
      setDraftTime(windowEnd);
    }
    setPickerOpen(type);
  }

  function confirmPicker() {
    if (pickerOpen === 'maxMembers') {
      setMaxMembers(MEMBER_OPTIONS[draftIdx].value);
    } else if (pickerOpen === 'duration') {
      setDurationMinutes(DURATION_OPTIONS[draftIdx].value);
    } else if (pickerOpen === 'windowStart') {
      setWindowStart(draftTime);
    } else if (pickerOpen === 'windowEnd') {
      setWindowEnd(draftTime);
    }
    setPickerOpen(null);
  }

  async function handleCreate() {
    if (!name.trim()) {
      Alert.alert('입력 오류', '그룹 이름을 입력해주세요');
      return;
    }
    if (!isPublic && !password.trim()) {
      Alert.alert('입력 오류', '비밀번호를 입력해주세요');
      return;
    }

    const body: {
      name: string;
      description?: string;
      password?: string;
      maxMembers: number;
      missionType: string;
      missionCategory: string;
      durationMinutes?: number;
      windowStart?: string;
      windowEnd?: string;
    } = {
      name: name.trim(),
      description: description.trim() || undefined,
      password: isPublic ? undefined : password.trim(),
      maxMembers,
      missionType,
      missionCategory,
    };

    if (missionType === 'DURATION') {
      body.durationMinutes = durationMinutes;
    } else {
      body.windowStart = windowStart.toISOString();
      body.windowEnd = windowEnd.toISOString();
    }

    setLoading(true);
    try {
      const res = await api.post<{ code?: string }>('/api/v1/groups', body);
      const data = res.data;
      Alert.alert('그룹 생성 완료 🎉', `참가 코드: ${data.code}\n(유효 시간 3시간)`, [
        { text: '확인', onPress: onCreated },
      ]);
    } catch (e) {
      // HTTP 응답이 온 경우(=서버가 실패 상태 반환)는 '생성 실패', 그 외(네트워크 오류)는 '오류'
      if (axios.isAxiosError(e) && e.response) {
        const err = (e.response.data ?? {}) as { message?: string };
        Alert.alert('생성 실패', err.message ?? '다시 시도해주세요');
        return;
      }
      Alert.alert('오류', (e as { message?: string }).message ?? '네트워크 오류가 발생했습니다');
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={s.container}>
      <StatusBar style="dark" />
      <View style={s.header}>
        <TouchableOpacity onPress={onBack} hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}>
          <Text style={s.backText}>‹ 뒤로</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>그룹 생성</Text>
        <View style={s.headerSpacer} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <Field label="그룹명 *">
          <TextInput
            style={[s.input, inkBox(T.paperDark)]}
            placeholder="그룹 이름 (최대 50자)"
            placeholderTextColor={T.inkLight}
            value={name}
            onChangeText={setName}
            maxLength={50}
          />
        </Field>

        <Field label="설명">
          <TextInput
            style={[s.input, s.textArea, inkBox(T.paperDark)]}
            placeholder="그룹 설명 (선택)"
            placeholderTextColor={T.inkLight}
            value={description}
            onChangeText={setDescription}
            maxLength={200}
            multiline
          />
        </Field>

        <Field label="공개 여부">
          <View style={s.switchRow}>
            <Text style={s.switchLabel}>{isPublic ? '공개' : '비공개'}</Text>
            <Switch
              value={isPublic}
              onValueChange={setIsPublic}
              trackColor={{ true: T.ink, false: T.paperLine }}
              thumbColor={T.paper}
            />
          </View>
        </Field>

        {!isPublic && (
          <Field label="비밀번호">
            <TextInput
              style={[s.input, inkBox(T.paperDark)]}
              placeholder="비밀번호 입력 (영숫자)"
              placeholderTextColor={T.inkLight}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />
          </Field>
        )}

        <Field label="정원">
          <TouchableOpacity
            style={[s.pickerTrigger, inkBox(T.paperDark)]}
            onPress={() => openPicker('maxMembers')}
            activeOpacity={0.7}
          >
            <Text style={s.pickerTriggerText}>{maxMembers}명</Text>
            <Text style={s.pickerChevron}>›</Text>
          </TouchableOpacity>
        </Field>

        <Field label="미션 유형">
          <Segment
            options={[
              { value: 'DURATION', label: '지속 시간' },
              { value: 'TIME_WINDOW', label: '시간대' },
            ]}
            value={missionType}
            onChange={setMissionType}
          />
        </Field>

        <Field label="미션 카테고리">
          <Segment
            options={[
              { value: 'FOCUS', label: '집중' },
              { value: 'SCREEN_TIME', label: '스크린타임' },
            ]}
            value={missionCategory}
            onChange={setMissionCategory}
          />
        </Field>

        {missionType === 'DURATION' && (
          <Field label="지속 시간">
            <TouchableOpacity
              style={[s.pickerTrigger, inkBox(T.paperDark)]}
              onPress={() => openPicker('duration')}
              activeOpacity={0.7}
            >
              <Text style={s.pickerTriggerText}>{durationMinutes}분</Text>
              <Text style={s.pickerChevron}>›</Text>
            </TouchableOpacity>
          </Field>
        )}

        {missionType === 'TIME_WINDOW' && (
          <>
            <Field label="시작 시간">
              <TouchableOpacity
                style={[s.pickerTrigger, inkBox(T.paperDark)]}
                onPress={() => openPicker('windowStart')}
                activeOpacity={0.7}
              >
                <Text style={s.pickerTriggerText}>{formatTime(windowStart)}</Text>
                <Text style={s.pickerChevron}>›</Text>
              </TouchableOpacity>
            </Field>
            <Field label="종료 시간">
              <TouchableOpacity
                style={[s.pickerTrigger, inkBox(T.paperDark)]}
                onPress={() => openPicker('windowEnd')}
                activeOpacity={0.7}
              >
                <Text style={s.pickerTriggerText}>{formatTime(windowEnd)}</Text>
                <Text style={s.pickerChevron}>›</Text>
              </TouchableOpacity>
            </Field>
          </>
        )}

        <Text style={s.codeHint}>
          ✦ 그룹 생성 시 8자리 참가 코드가 자동 발급됩니다 (유효 시간 3시간)
        </Text>

        <TouchableOpacity
          style={[s.primaryBtn, inkBox(T.ink), loading && s.btnDisabled]}
          onPress={handleCreate}
          disabled={loading}
          activeOpacity={0.8}
        >
          {loading ? (
            <ActivityIndicator color={T.paper} />
          ) : (
            <Text style={s.primaryBtnText}>그룹 만들기</Text>
          )}
        </TouchableOpacity>

        <View style={s.scrollBottom} />
      </ScrollView>

      {/* 드럼 피커 바텀 모달 */}
      <Modal
        visible={pickerOpen !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setPickerOpen(null)}
      >
        <TouchableOpacity
          style={s.pickerOverlay}
          activeOpacity={1}
          onPress={() => setPickerOpen(null)}
        />
        <View style={s.pickerSheet}>
          <View style={s.pickerToolbar}>
            <TouchableOpacity onPress={() => setPickerOpen(null)}>
              <Text style={s.pickerCancel}>취소</Text>
            </TouchableOpacity>
            <Text style={s.pickerTitle}>{pickerOpen ? (PICKER_TITLE[pickerOpen] ?? '') : ''}</Text>
            <TouchableOpacity onPress={confirmPicker}>
              <Text style={s.pickerDone}>완료</Text>
            </TouchableOpacity>
          </View>

          {(pickerOpen === 'maxMembers' || pickerOpen === 'duration') && (
            <DrumPicker
              items={pickerOpen === 'maxMembers' ? MEMBER_OPTIONS : DURATION_OPTIONS}
              selectedIndex={draftIdx}
              onChange={setDraftIdx}
            />
          )}

          {(pickerOpen === 'windowStart' || pickerOpen === 'windowEnd') && (
            <DateTimePicker
              value={draftTime}
              mode="time"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={(_, date) => {
                if (date) setDraftTime(date);
              }}
              style={s.dateTimePicker}
              locale="ko-KR"
            />
          )}
        </View>
      </Modal>
    </View>
  );
}

// ───────────────────────────── G3: 그룹 검색·참가 ─────────────────────────────

interface SearchGroupViewProps {
  onBack: () => void;
  initialQuery?: string;
  onGroupPress: (groupId: string) => void;
}

function SearchGroupView({ onBack, initialQuery = '', onGroupPress }: SearchGroupViewProps) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<GroupSearchItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    if (initialQuery.trim()) doSearch(initialQuery.trim());
  }, [initialQuery]);

  async function doSearch(q: string) {
    if (!q) {
      return;
    }
    setLoading(true);
    try {
      const url = `/api/v1/groups/search?query=${encodeURIComponent(q)}`;
      const res = await api.get<GroupSearchItem[]>(url);
      const data = res.data;
      setResults(data);
      setSearched(true);
    } catch (e) {
      Alert.alert('오류', (e as { message?: string }).message ?? '검색에 실패했습니다');
    } finally {
      setLoading(false);
    }
  }

  function handleSearch() {
    doSearch(query.trim());
  }

  function getJoinLabel(group: GroupSearchItem) {
    if (group.status === 'ENDED') return '종료됨';
    if ((group.currentMembers ?? 0) >= (group.maxMembers ?? 0)) return '인원 초과';
    if (group.hasPassword) return '코드 입력';
    return '참가하기';
  }

  function isDisabled(group: GroupSearchItem) {
    return group.status === 'ENDED' || (group.currentMembers ?? 0) >= (group.maxMembers ?? 0);
  }

  function handleJoin(group: GroupSearchItem) {
    onGroupPress(group.groupId);
  }

  const isCodeSearch = query.trim().length === 8;

  return (
    <View style={s.container}>
      <StatusBar style="dark" />
      <View style={s.header}>
        <TouchableOpacity onPress={onBack} hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}>
          <Text style={s.backText}>‹ 뒤로</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>그룹 검색</Text>
        <View style={s.headerSpacer} />
      </View>

      <View style={[s.searchBar, inkBox(T.paperDark)]}>
        <TextInput
          style={s.searchInput}
          placeholder="그룹명 또는 8자리 코드"
          placeholderTextColor={T.inkLight}
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={handleSearch}
          returnKeyType="search"
          autoCapitalize="none"
        />
        <TouchableOpacity onPress={handleSearch} style={s.searchBtn}>
          <Text style={s.searchBtnText}>검색</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator color={T.ink} />
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false}>
          {searched && results.length === 0 && (
            <Text style={s.searchEmptyText}>검색 결과가 없어요</Text>
          )}
          {results.map((group, idx) => {
            const codeMatch = isCodeSearch && idx === 0;
            const disabled = isDisabled(group);
            const label = getJoinLabel(group);

            return (
              <TouchableOpacity
                key={group.groupId}
                style={[s.searchCard, inkBox(T.paperDark)]}
                onPress={() => handleJoin(group)}
                activeOpacity={0.85}
              >
                <View style={s.searchCardBody}>
                  <View style={s.searchCardNameRow}>
                    <Text style={s.groupName} numberOfLines={1}>
                      {group.name}
                      {group.hasPassword ? ' 🔒' : ''}
                    </Text>
                    {codeMatch && (
                      <View style={s.codeMatchBadge}>
                        <Text style={s.codeMatchText}>코드 일치</Text>
                      </View>
                    )}
                  </View>
                  <View style={s.searchCardMeta}>
                    <Text style={s.groupMembers}>
                      {`👥 ${group.currentMembers}/${group.maxMembers}명`}
                    </Text>
                    <View style={s.searchBadge}>
                      <Text style={s.badgeText}>{STATUS_LABEL[group.status ?? '']}</Text>
                    </View>
                  </View>
                </View>
                <View style={[s.joinBtn, disabled && s.joinBtnDisabled]}>
                  <Text style={[s.joinBtnText, disabled && s.joinBtnTextDisabled]}>{label}</Text>
                </View>
              </TouchableOpacity>
            );
          })}
          <View style={s.scrollBottom} />
        </ScrollView>
      )}
    </View>
  );
}

// ───────────────────────────── 공통 컴포넌트 ─────────────────────────────

interface FieldProps {
  label: string;
  children: ReactNode;
}

function Field({ label, children }: FieldProps) {
  return (
    <View style={s.field}>
      <Text style={s.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

interface SegmentOption {
  value: string;
  label: string;
}

interface SegmentProps {
  options: SegmentOption[];
  value: string;
  onChange: (value: string) => void;
}

function Segment({ options, value, onChange }: SegmentProps) {
  return (
    <View style={s.segmentRow}>
      {options.map((opt) => (
        <TouchableOpacity
          key={opt.value}
          style={[s.segmentBtn, value === opt.value && s.segmentBtnActive]}
          onPress={() => onChange(opt.value)}
          activeOpacity={0.8}
        >
          <Text style={[s.segmentBtnText, value === opt.value && s.segmentBtnTextActive]}>
            {opt.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

// ───────────────────────────── 그룹 개요 모달 ─────────────────────────────

function formatWindowTime(instant?: string) {
  if (!instant) return '';
  const d = new Date(instant);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

interface InfoRowProps {
  label: string;
  value: string;
}

function InfoRow({ label, value }: InfoRowProps) {
  return (
    <View style={s.ovInfoRow}>
      <Text style={s.ovInfoLabel}>{label}</Text>
      <Text style={s.ovInfoValue}>{value}</Text>
    </View>
  );
}

interface GroupOverviewModalProps {
  visible: boolean;
  data: GroupOverview | null;
  groupId: string | null;
  onClose: () => void;
  onJoined: () => void;
}

function GroupOverviewModal({
  visible,
  data,
  groupId,
  onClose,
  onJoined,
}: GroupOverviewModalProps) {
  const [password, setPassword] = useState('');
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    if (!visible) {
      setPassword('');
      setJoining(false);
    }
  }, [visible]);

  async function handleJoin() {
    if (!data) return;
    setJoining(true);
    try {
      const body = data.hasPassword ? { password: password.trim() } : {};
      await api.post(`/api/v1/groups/${groupId}/join`, body);
      onJoined();
    } catch (e) {
      const status = axios.isAxiosError(e) ? e.response?.status : undefined;
      if (status === 401) {
        Alert.alert('오류', '비밀번호가 틀렸습니다');
        return;
      }
      if (status === 409) {
        Alert.alert('오류', '이미 참가 중이거나 정원이 초과되었습니다');
        return;
      }
      if (status !== undefined) {
        Alert.alert('오류', '참가에 실패했습니다');
        return;
      }
      Alert.alert('오류', '네트워크 오류가 발생했습니다');
    } finally {
      setJoining(false);
    }
  }

  const canJoin = data && data.status !== 'ENDED' && data.memberCount < data.maxMembers;
  const missionText = !data
    ? ''
    : data.missionType === 'DURATION'
      ? `${data.missionCategory === 'FOCUS' ? '집중' : '스크린타임'} · ${data.durationMinutes}분`
      : `${data.missionCategory === 'FOCUS' ? '집중' : '스크린타임'} · ${formatWindowTime(data.windowStart)} ~ ${formatWindowTime(data.windowEnd)}`;

  const joinLabel = !data
    ? ''
    : data.status === 'ENDED'
      ? '종료된 그룹'
      : data.memberCount >= data.maxMembers
        ? '정원 초과'
        : '참가하기';

  const joinDisabled = !canJoin || joining || (data?.hasPassword && !password.trim());

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={s.ovOverlay} activeOpacity={1} onPress={onClose} />
      <View style={s.ovSheet}>
        <View style={s.ovHandle} />

        {!data ? (
          <ActivityIndicator size="large" color={T.ink} style={s.ovLoader} />
        ) : (
          <>
            <Text style={s.ovName}>{data.name}</Text>
            {!!data.description && <Text style={s.ovDesc}>{data.description}</Text>}

            <View style={s.ovDivider} />

            <InfoRow label="미션" value={missionText} />
            <InfoRow label="인원" value={`${data.memberCount}/${data.maxMembers}명`} />
            <InfoRow label="상태" value={STATUS_LABEL[data.status ?? ''] ?? data.status ?? ''} />
            {data.hasPassword && <InfoRow label="비공개" value="비밀번호 필요 🔒" />}

            {data.hasPassword && canJoin && (
              <TextInput
                style={[s.ovInput, inkBox(T.paperDark)]}
                placeholder="비밀번호 입력"
                placeholderTextColor={T.inkLight}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
              />
            )}

            <TouchableOpacity
              style={[
                s.ovJoinBtn,
                canJoin ? s.ovJoinBtnActive : s.ovJoinBtnInactive,
                joinDisabled && s.btnDisabled,
              ]}
              onPress={handleJoin}
              disabled={joinDisabled}
              activeOpacity={0.8}
            >
              {joining ? (
                <ActivityIndicator color={T.paper} />
              ) : (
                <Text style={[s.ovJoinBtnText, !canJoin && s.ovJoinBtnTextDisabled]}>
                  {joinLabel}
                </Text>
              )}
            </TouchableOpacity>
          </>
        )}
      </View>
    </Modal>
  );
}

// ───────────────────────────── 메인 스크린 ─────────────────────────────

type GroupListScreenProps = TabScreenProps<'그룹'>;

type ViewMode = 'list' | 'create' | 'search';

export default function GroupListScreen({ navigation }: GroupListScreenProps) {
  const [view, setView] = useState<ViewMode>('list');
  const [searchInitialQuery, setSearchInitialQuery] = useState('');
  const [groups, setGroups] = useState<GroupListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // 개요 모달 상태
  const [overviewVisible, setOverviewVisible] = useState(false);
  const [overviewGroupId, setOverviewGroupId] = useState<string | null>(null);
  const [overviewData, setOverviewData] = useState<GroupOverview | null>(null);

  const fetchGroups = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const res = await api.get<GroupListItem[]>('/api/v1/groups');
      const data = res.data;
      setGroups(data);
    } catch (e) {
      Alert.alert('오류', (e as { message?: string }).message ?? '그룹 목록을 불러오지 못했습니다');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (view === 'list') fetchGroups();
  }, [view, fetchGroups]);

  // 비멤버 그룹 탭 시: overview API 호출 → isMember면 바로 진입, 아니면 모달 표시
  async function openOverview(groupId: string) {
    setOverviewGroupId(groupId);
    setOverviewData(null);
    setOverviewVisible(true);
    try {
      const res = await api.get<GroupOverview>(`/api/v1/groups/${groupId}/overview`);
      const data = res.data;
      if (data.isMember) {
        setOverviewVisible(false);
        navigation.navigate('GroupDetail', { groupId });
      } else {
        setOverviewData(data);
      }
    } catch {
      setOverviewVisible(false);
      Alert.alert('오류', '그룹 정보를 불러오지 못했습니다');
    }
  }

  return (
    <View style={s.root}>
      {view === 'create' ? (
        <CreateGroupView onBack={() => setView('list')} onCreated={() => setView('list')} />
      ) : view === 'search' ? (
        <SearchGroupView
          onBack={() => setView('list')}
          initialQuery={searchInitialQuery}
          onGroupPress={openOverview}
        />
      ) : (
        <GroupListView
          groups={groups}
          loading={loading}
          refreshing={refreshing}
          onRefresh={() => fetchGroups(true)}
          onCreatePress={() => setView('create')}
          onSearchSubmit={(q) => {
            setSearchInitialQuery(q);
            setView('search');
          }}
          onGroupPress={(groupId) => navigation.navigate('GroupDetail', { groupId })}
        />
      )}

      <GroupOverviewModal
        visible={overviewVisible}
        data={overviewData}
        groupId={overviewGroupId}
        onClose={() => setOverviewVisible(false)}
        onJoined={() => {
          setOverviewVisible(false);
          if (overviewGroupId !== null) {
            navigation.navigate('GroupDetail', { groupId: overviewGroupId });
          }
        }}
      />
    </View>
  );
}

// ───────────────────────────── 스타일 ─────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1 },
  container: { flex: 1, backgroundColor: T.paper, paddingTop: 56, paddingHorizontal: 20 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  headerTitle: { fontSize: 18, fontWeight: '900', color: T.ink },
  headerSpacer: { width: 56 },
  backText: { fontSize: 16, fontWeight: '700', color: T.inkMed, width: 56 },
  scrollBottom: { height: 100 },

  // G1 - 인라인 검색창
  listSearchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 2,
    marginBottom: 16,
  },
  listSearchInput: { flex: 1, paddingVertical: 10, fontSize: 14, fontWeight: '600', color: T.ink },

  // G1 - 그룹 카드
  groupCard: { padding: 16, marginBottom: 12 },
  groupCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  groupCardBottom: { flexDirection: 'row', justifyContent: 'space-between' },
  groupName: { fontSize: 16, fontWeight: '900', color: T.ink, flex: 1, marginRight: 8 },
  groupCode: { fontSize: 12, fontWeight: '600', color: T.inkLight },
  groupMembers: { fontSize: 12, fontWeight: '700', color: T.inkMed },
  badgeRow: { flexDirection: 'row', gap: 6 },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    backgroundColor: T.paperDark,
    borderWidth: 1,
    borderColor: T.paperLine,
  },
  badgeText: { fontSize: 11, fontWeight: '700', color: T.inkMed },
  badgeOwner: { backgroundColor: T.ink },
  badgeMember: { backgroundColor: T.paperDark },
  badgeTextOwner: { color: T.paper },

  // Empty state
  emptyWrap: { alignItems: 'center', paddingTop: 60 },
  emptyTitle: { fontSize: 15, fontWeight: '700', color: T.inkMed },
  emptyBody: { fontSize: 12, color: T.inkLight, marginTop: 6 },

  // FAB
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 20,
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: T.ink,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: T.ink,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  fabText: { color: T.paper, fontSize: 30, fontWeight: '300', lineHeight: 36 },

  // G2 - 폼
  field: { marginBottom: 16 },
  fieldLabel: { fontSize: 13, fontWeight: '800', color: T.inkMed, marginBottom: 8 },
  input: { padding: 12, fontSize: 14, fontWeight: '600', color: T.ink },
  textArea: { height: 80, textAlignVertical: 'top' },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  switchLabel: { fontSize: 14, fontWeight: '700', color: T.ink },
  segmentRow: { flexDirection: 'row', gap: 8 },
  segmentBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: T.paperLine,
    backgroundColor: T.paperDark,
  },
  segmentBtnActive: { backgroundColor: T.ink, borderColor: T.ink },
  segmentBtnText: { fontSize: 13, fontWeight: '700', color: T.inkMed },
  segmentBtnTextActive: { color: T.paper },
  codeHint: {
    fontSize: 12,
    color: T.inkLight,
    textAlign: 'center',
    marginVertical: 16,
    lineHeight: 18,
  },
  primaryBtn: {
    padding: 14,
    alignItems: 'center',
    backgroundColor: T.ink,
    marginTop: 4,
  },
  btnDisabled: { opacity: 0.4 },
  primaryBtnText: { color: T.paper, fontSize: 16, fontWeight: '800' },

  // 드럼 피커 트리거
  pickerTrigger: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 14,
  },
  pickerTriggerText: { fontSize: 14, fontWeight: '700', color: T.ink },
  pickerChevron: { fontSize: 20, color: T.inkLight, fontWeight: '300' },

  // 피커 모달
  pickerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  pickerSheet: {
    backgroundColor: T.paper,
    borderTopWidth: 1.5,
    borderTopColor: T.ink,
    paddingBottom: 24,
  },
  pickerToolbar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: T.paperLine,
  },
  pickerCancel: { fontSize: 15, fontWeight: '600', color: T.inkMed },
  pickerTitle: { fontSize: 15, fontWeight: '800', color: T.ink },
  pickerDone: { fontSize: 15, fontWeight: '800', color: T.ink },
  dateTimePicker: { height: 240, backgroundColor: T.paper },

  // G3 - 검색
  searchBar: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  searchInput: { flex: 1, padding: 12, fontSize: 14, fontWeight: '600', color: T.ink },
  searchBtn: { paddingHorizontal: 14, paddingVertical: 12 },
  searchBtnText: { fontSize: 14, fontWeight: '800', color: T.ink },
  searchEmptyText: {
    textAlign: 'center',
    marginTop: 40,
    fontSize: 15,
    fontWeight: '700',
    color: T.inkMed,
  },
  searchCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    marginBottom: 10,
    gap: 12,
  },
  searchCardBody: { flex: 1 },
  searchCardNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  searchCardMeta: { flexDirection: 'row', alignItems: 'center' },
  searchBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    backgroundColor: T.paperDark,
    borderWidth: 1,
    borderColor: T.paperLine,
    marginLeft: 8,
  },
  codeMatchBadge: {
    backgroundColor: T.ink,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  codeMatchText: { fontSize: 10, fontWeight: '700', color: T.paper },
  joinBtn: {
    backgroundColor: T.ink,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  joinBtnDisabled: { backgroundColor: T.paperDark, borderWidth: 1, borderColor: T.paperLine },
  joinBtnText: { fontSize: 12, fontWeight: '700', color: T.paper },
  joinBtnTextDisabled: { color: T.inkLight },

  // 개요 모달
  ovOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  ovSheet: {
    backgroundColor: T.paper,
    borderTopWidth: 1.5,
    borderTopColor: T.ink,
    paddingHorizontal: 24,
    paddingBottom: 48,
  },
  ovHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: T.paperLine,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 20,
  },
  ovLoader: { paddingVertical: 40 },
  ovName: { fontSize: 20, fontWeight: '900', color: T.ink, marginBottom: 6 },
  ovDesc: { fontSize: 13, color: T.inkMed, lineHeight: 18, marginBottom: 4 },
  ovDivider: { height: 1, backgroundColor: T.paperLine, marginVertical: 12 },
  ovInfoRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  ovInfoLabel: { fontSize: 13, fontWeight: '700', color: T.inkMed },
  ovInfoValue: { fontSize: 13, fontWeight: '700', color: T.ink },
  ovInput: { marginTop: 16, padding: 12, fontSize: 14, fontWeight: '600', color: T.ink },
  ovJoinBtn: { marginTop: 20, padding: 14, alignItems: 'center', borderRadius: 8 },
  ovJoinBtnActive: { backgroundColor: T.ink },
  ovJoinBtnInactive: { backgroundColor: T.paperDark, borderWidth: 1, borderColor: T.paperLine },
  ovJoinBtnText: { fontSize: 16, fontWeight: '800', color: T.paper },
  ovJoinBtnTextDisabled: { color: T.inkLight },
});
