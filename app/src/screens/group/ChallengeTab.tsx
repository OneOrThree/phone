import { useRef, useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  FlatList,
  TextInput,
  TouchableOpacity,
  Modal,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  StyleSheet,
  Alert,
} from 'react-native';
import type { NativeSyntheticEvent, NativeScrollEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import axios from 'axios';
import { T, inkBox } from '@/constants/theme';
import { api } from '@/services/api';
import { useUser } from '@/store/UserContext';
import { zoneSuffix, deviceTimeZone } from '@/utils/challengeTime';
import type { Group } from '@/types/api';

// 그룹 상세 — 화면에서 쓰는 멤버 필드만 사용
type GroupDetail = Group;

// 챌린지
interface Challenge {
  id: number;
  status?: string;
  missionType?: string;
  missionCategory?: string;
  durationMinutes?: number;
  windowStart?: string;
  windowEnd?: string;
  timeZone?: string;
  completedCount?: number;
  canParticipate?: boolean;
  [key: string]: unknown;
}

// 시각 값 (시/분)
interface TimeValue {
  hour: number;
  minute: number;
}

interface ChallengeTabProps {
  group: GroupDetail | null;
  groupId: number;
}

const CHALLENGE_TYPES = [
  { label: 'A-B 포커스', value: 'TIME_WINDOW' },
  { label: 'N 스크린타임', value: 'DURATION' },
];

// 휠 피커 데이터 (TIME_WINDOW 시간 선택용)
const WHEEL_HOURS = Array.from({ length: 24 }, (_, i) => i);
const WHEEL_MINS = Array.from({ length: 12 }, (_, i) => i * 5);
const WHEEL_ITEM_H = 44;
const WHEEL_VISIBLE = 3;

interface WheelListProps {
  data: number[];
  value: number;
  onChange: (v: number) => void;
}

function WheelList({ data, value, onChange }: WheelListProps) {
  const listRef = useRef<FlatList<number>>(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const idx = data.indexOf(value);
    if (idx >= 0 && listRef.current) {
      listRef.current.scrollToIndex({ index: idx, animated: false });
    }
  }, [data, value]);

  function handleScrollEnd(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const idx = Math.round(e.nativeEvent.contentOffset.y / WHEEL_ITEM_H);
    onChangeRef.current(data[Math.min(data.length - 1, Math.max(0, idx))]);
  }

  return (
    <View style={wl.wrap}>
      <View style={wl.selector} pointerEvents="none" />
      <FlatList
        ref={listRef}
        data={data}
        keyExtractor={(v) => String(v)}
        showsVerticalScrollIndicator={false}
        snapToInterval={WHEEL_ITEM_H}
        decelerationRate="fast"
        onMomentumScrollEnd={handleScrollEnd}
        getItemLayout={(_, index) => ({
          length: WHEEL_ITEM_H,
          offset: WHEEL_ITEM_H * index,
          index,
        })}
        contentContainerStyle={wl.listContent}
        renderItem={({ item }) => (
          <View style={wl.item}>
            <Text style={[wl.text, value === item && wl.textActive]}>
              {String(item).padStart(2, '0')}
            </Text>
          </View>
        )}
      />
    </View>
  );
}

const wl = StyleSheet.create({
  wrap: { width: 60, height: WHEEL_ITEM_H * WHEEL_VISIBLE, overflow: 'hidden' },
  selector: {
    position: 'absolute',
    top: WHEEL_ITEM_H,
    left: 0,
    right: 0,
    height: WHEEL_ITEM_H,
    borderTopWidth: 1.5,
    borderBottomWidth: 1.5,
    borderColor: T.ink,
    zIndex: 1,
  },
  listContent: { paddingVertical: WHEEL_ITEM_H },
  item: { height: WHEEL_ITEM_H, justifyContent: 'center', alignItems: 'center' },
  text: { fontSize: 18, color: T.inkLight },
  textActive: { fontSize: 22, fontWeight: '800', color: T.ink },
});

// ─── 헬퍼 ────────────────────────────────────────────────────────────────────

function timeToInstant(hour: number, minute: number) {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

function formatTime(timeStr: string | null | undefined) {
  if (!timeStr) return '--:--';
  // 백엔드가 "HH:mm:ss" 형식으로 반환 → "HH:mm"으로 표시
  const [h, m] = timeStr.split(':');
  return `${h}:${m}`;
}

function formatTimeVal({ hour, minute }: TimeValue) {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function getChallengeIcon(c: Challenge) {
  if (c.missionCategory === 'SCREEN_TIME') return '📱';
  if (c.missionType === 'TIME_WINDOW') return '⏰';
  return '🎯';
}

function getChallengeName(c: Challenge) {
  if (c.missionType === 'TIME_WINDOW') {
    return c.missionCategory === 'SCREEN_TIME' ? 'A-B 스크린타임' : 'A-B 포커스';
  }
  return c.missionCategory === 'SCREEN_TIME' ? 'N 스크린타임' : 'N 집중';
}

function getChallengeDesc(c: Challenge) {
  if (c.missionType === 'TIME_WINDOW') {
    const start = formatTime(c.windowStart);
    const end = formatTime(c.windowEnd);
    const label = c.missionCategory === 'SCREEN_TIME' ? '스크린타임' : '집중';
    return `${start} ~ ${end}${zoneSuffix(c.timeZone)} ${label}`;
  }
  const min = c.durationMinutes ?? 0;
  if (c.missionCategory === 'SCREEN_TIME') {
    const h = Math.floor(min / 60);
    const m = min % 60;
    const timeStr = h > 0 ? (m > 0 ? `${h}시간 ${m}분` : `${h}시간`) : `${m}분`;
    return `하루 스크린타임 ${timeStr} 이하`;
  }
  return `${min}분 이상 집중`;
}

// ─── 메인 컴포넌트 ────────────────────────────────────────────────────────────

export default function ChallengeTab({ group, groupId }: ChallengeTabProps) {
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [loading, setLoading] = useState(true);
  const [createVisible, setCreateVisible] = useState(false);
  const [challengeType, setChallengeType] = useState('TIME_WINDOW');
  const [category, setCategory] = useState('FOCUS');
  const [startTime, setStartTime] = useState<TimeValue>({ hour: 9, minute: 0 });
  const [endTime, setEndTime] = useState<TimeValue>({ hour: 11, minute: 0 });
  const [durationText, setDurationText] = useState('60');
  const [pickerTarget, setPickerTarget] = useState<'start' | 'end' | null>(null);
  const [tempHour, setTempHour] = useState(0);
  const [tempMinute, setTempMinute] = useState(0);
  const [saving, setSaving] = useState(false);
  const insets = useSafeAreaInsets();

  const { userId: myUserId } = useUser();
  const isOwner = group?.members?.find((m) => m.userId === myUserId)?.role === 'OWNER';
  const totalMembers = group?.members?.length ?? 0;

  async function fetchChallenges() {
    setLoading(true);
    try {
      const res = await api.get<Challenge[]>(`/api/v1/groups/${groupId}/challenges`);
      const data = res.data;
      setChallenges(data);
    } catch {
      // 조용히 실패 처리
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchChallenges();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  function handleDeleteChallenge(challenge: Challenge) {
    Alert.alert('챌린지 삭제', `"${getChallengeName(challenge)}" 챌린지를 삭제할까요?`, [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.delete(`/api/v1/groups/${groupId}/challenges/${challenge.id}`);
            setChallenges((prev) => prev.filter((c) => c.id !== challenge.id));
          } catch (e) {
            if (axios.isAxiosError(e) && e.response) {
              const body = (e.response.data ?? {}) as { message?: string };
              Alert.alert('오류', body.message ?? '삭제에 실패했어요');
            } else {
              Alert.alert('오류', '네트워크 오류가 발생했어요');
            }
          }
        },
      },
    ]);
  }

  function openCreate() {
    setChallengeType('TIME_WINDOW');
    setCategory('FOCUS');
    setStartTime({ hour: 9, minute: 0 });
    setEndTime({ hour: 11, minute: 0 });
    setDurationText('60');
    setPickerTarget(null);
    setCreateVisible(true);
  }

  function openTimePicker(target: 'start' | 'end') {
    const val = target === 'start' ? startTime : endTime;
    setTempHour(val.hour);
    setTempMinute(val.minute);
    setPickerTarget(target);
  }

  function confirmTimePicker() {
    if (pickerTarget === 'start') setStartTime({ hour: tempHour, minute: tempMinute });
    else if (pickerTarget === 'end') setEndTime({ hour: tempHour, minute: tempMinute });
    setPickerTarget(null);
  }

  async function handleSave() {
    let payload: Record<string, unknown>;
    if (challengeType === 'TIME_WINDOW') {
      const ws = timeToInstant(startTime.hour, startTime.minute);
      const we = timeToInstant(endTime.hour, endTime.minute);
      if (new Date(ws) >= new Date(we)) {
        Alert.alert('입력 오류', '종료 시각이 시작 시각보다 늦어야 해요');
        return;
      }
      payload = {
        missionCategory: category,
        missionType: 'TIME_WINDOW',
        durationMinutes: 0,
        windowStart: ws,
        windowEnd: we,
        timeZone: deviceTimeZone(),
      };
    } else {
      const mins = parseInt(durationText, 10);
      if (isNaN(mins) || mins <= 0) {
        Alert.alert('입력 오류', '1분 이상으로 설정해주세요');
        return;
      }
      payload = {
        missionCategory: category,
        missionType: 'DURATION',
        durationMinutes: mins,
        windowStart: null,
        windowEnd: null,
        timeZone: deviceTimeZone(),
      };
    }

    setSaving(true);
    try {
      await api.post(`/api/v1/groups/${groupId}/challenges`, payload);
      setCreateVisible(false);
      fetchChallenges();
    } catch (e) {
      if (axios.isAxiosError(e) && e.response) {
        const body = (e.response.data ?? {}) as { message?: string };
        Alert.alert('오류', body.message ?? '챌린지 생성에 실패했어요');
      } else {
        Alert.alert('오류', '네트워크 오류가 발생했어요');
      }
    } finally {
      setSaving(false);
    }
  }

  const formTitle =
    challengeType === 'TIME_WINDOW'
      ? 'A-B 포커스 설정'
      : `${CHALLENGE_TYPES.find((t) => t.value === challengeType)?.label ?? 'N'} 설정`;

  return (
    <View style={s.root}>
      {loading ? (
        <ActivityIndicator size="large" color={T.ink} style={s.loader} />
      ) : (
        <ScrollView style={s.list} showsVerticalScrollIndicator={false}>
          {challenges.length === 0 ? (
            <View style={s.empty}>
              <Text style={s.emptyText}>등록된 챌린지가 없어요</Text>
            </View>
          ) : (
            challenges.map((c) => {
              const completed = c.completedCount ?? 0;
              const progressRatio = totalMembers > 0 ? Math.min(completed / totalMembers, 1) : 0;
              return (
                <View key={c.id} style={[s.card, inkBox(T.paper)]}>
                  <View style={s.cardHeader}>
                    <Text style={s.cardIcon}>{getChallengeIcon(c)}</Text>
                    <View style={s.cardHeaderText}>
                      <Text style={s.cardName}>{getChallengeName(c)}</Text>
                      {!c.canParticipate && (
                        <View style={s.noBadge}>
                          <Text style={s.noBadgeText}>참여 불가</Text>
                        </View>
                      )}
                    </View>
                    {isOwner && (
                      <TouchableOpacity
                        onPress={() => handleDeleteChallenge(c)}
                        hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
                        style={s.deleteBtn}
                      >
                        <Text style={s.deleteBtnText}>✕</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                  <Text style={s.cardDesc}>{getChallengeDesc(c)}</Text>
                  <View style={s.progressRow}>
                    <View style={s.progressTrack}>
                      <View style={[s.progressFill, { width: `${progressRatio * 100}%` }]} />
                    </View>
                    <Text style={s.progressLabel}>
                      달성: {completed} / {totalMembers}명
                    </Text>
                  </View>
                </View>
              );
            })
          )}
          <View style={s.listBottom} />
        </ScrollView>
      )}

      {/* FAB — 방장에게만 노출 */}
      {isOwner && (
        <TouchableOpacity style={s.fab} onPress={openCreate} activeOpacity={0.8}>
          <Text style={s.fabText}>+</Text>
        </TouchableOpacity>
      )}

      {/* 챌린지 생성 모달 */}
      <Modal
        visible={createVisible}
        animationType="slide"
        onRequestClose={() => setCreateVisible(false)}
      >
        <KeyboardAvoidingView
          style={s.modalRoot}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          {/* 헤더 */}
          <View style={[s.modalHeader, { paddingTop: insets.top + 8 }]}>
            <TouchableOpacity
              onPress={() => setCreateVisible(false)}
              hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
              style={s.headerSide}
            >
              <Text style={s.cancelText}>취소</Text>
            </TouchableOpacity>
            <Text style={s.modalTitle}>챌린지 설정</Text>
            <View style={s.headerSide} />
          </View>

          <ScrollView style={s.modalBody} keyboardShouldPersistTaps="handled">
            {/* 방장 전용 배지 */}
            <View style={s.ownerBadge}>
              <Text style={s.ownerBadgeText}>⭐ 방장 전용</Text>
            </View>

            {/* 챌린지 유형 */}
            <Text style={s.fieldLabel}>챌린지 유형</Text>
            <View style={s.segmentRow}>
              {CHALLENGE_TYPES.map((ct) => (
                <TouchableOpacity
                  key={ct.value}
                  style={[s.segBtn, challengeType === ct.value && s.segBtnActive]}
                  onPress={() => setChallengeType(ct.value)}
                  activeOpacity={0.8}
                >
                  <Text style={[s.segBtnText, challengeType === ct.value && s.segBtnTextActive]}>
                    {ct.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* 조건부 폼 */}
            {challengeType === 'TIME_WINDOW' ? (
              <View style={[s.formBox, inkBox(T.paperDark)]}>
                <Text style={s.formBoxTitle}>{formTitle}</Text>
                <View style={s.timeLabels}>
                  <Text style={s.timeFieldLabel}>시작 시각</Text>
                  <View style={{ flex: 1 }} />
                  <Text style={s.timeFieldLabel}>종료 시각</Text>
                </View>
                <View style={s.timeRow}>
                  <TouchableOpacity
                    style={[s.timeBtn, inkBox(T.paper)]}
                    onPress={() => openTimePicker('start')}
                    activeOpacity={0.8}
                  >
                    <Text style={s.timeBtnText}>{formatTimeVal(startTime)}</Text>
                  </TouchableOpacity>
                  <Text style={s.timeSep}>~</Text>
                  <TouchableOpacity
                    style={[s.timeBtn, inkBox(T.paper)]}
                    onPress={() => openTimePicker('end')}
                    activeOpacity={0.8}
                  >
                    <Text style={s.timeBtnText}>{formatTimeVal(endTime)}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <View style={[s.formBox, inkBox(T.paperDark)]}>
                <Text style={s.formBoxTitle}>{formTitle}</Text>
                <Text style={s.timeFieldLabel}>목표 시간 (분)</Text>
                <View style={s.durationRow}>
                  <TextInput
                    style={[s.durationInput, inkBox(T.paper)]}
                    value={durationText}
                    onChangeText={setDurationText}
                    keyboardType="numeric"
                    maxLength={4}
                    returnKeyType="done"
                  />
                  <Text style={s.durationSuffix}>분 이하</Text>
                </View>
              </View>
            )}

            {/* 미션 카테고리 */}
            <Text style={[s.fieldLabel, { marginTop: 8 }]}>미션 카테고리</Text>
            <View style={s.segmentRow}>
              <TouchableOpacity
                style={[s.segBtn, category === 'FOCUS' && s.segBtnActive]}
                onPress={() => setCategory('FOCUS')}
                activeOpacity={0.8}
              >
                <Text style={[s.segBtnText, category === 'FOCUS' && s.segBtnTextActive]}>
                  포커스
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.segBtn, category === 'SCREEN_TIME' && s.segBtnActive]}
                onPress={() => setCategory('SCREEN_TIME')}
                activeOpacity={0.8}
              >
                <Text style={[s.segBtnText, category === 'SCREEN_TIME' && s.segBtnTextActive]}>
                  스크린타임
                </Text>
              </TouchableOpacity>
            </View>
          </ScrollView>

          {/* 저장 버튼 */}
          <TouchableOpacity
            style={[
              s.submitBtn,
              saving && s.submitBtnDisabled,
              { marginBottom: insets.bottom + 16 },
            ]}
            onPress={handleSave}
            activeOpacity={0.8}
            disabled={saving}
          >
            <Text style={s.submitBtnText}>{saving ? '저장 중…' : '저장하기'}</Text>
          </TouchableOpacity>

          {/* 시간 피커 오버레이 (TIME_WINDOW 시작/종료 시각 선택) */}
          {pickerTarget !== null && (
            <View style={s.pickerOverlay}>
              <TouchableOpacity
                style={s.pickerBackdrop}
                onPress={() => setPickerTarget(null)}
                activeOpacity={1}
              />
              <View style={s.pickerSheet}>
                <Text style={s.pickerTitle}>시각 선택</Text>
                <View style={s.pickerWheels}>
                  <WheelList data={WHEEL_HOURS} value={tempHour} onChange={setTempHour} />
                  <Text style={s.pickerColon}>:</Text>
                  <WheelList data={WHEEL_MINS} value={tempMinute} onChange={setTempMinute} />
                </View>
                <TouchableOpacity
                  onPress={confirmTimePicker}
                  style={s.pickerConfirm}
                  activeOpacity={0.7}
                >
                  <Text style={s.pickerConfirmText}>확인</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  loader: { marginTop: 60 },

  list: { flex: 1, paddingHorizontal: 20, paddingTop: 16 },
  listBottom: { height: 100 },

  empty: { marginTop: 80, alignItems: 'center' },
  emptyText: { fontSize: 14, fontWeight: '700', color: T.inkLight },

  card: { padding: 16, marginBottom: 12 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 6, gap: 8 },
  cardIcon: { fontSize: 20 },
  cardHeaderText: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardName: { fontSize: 15, fontWeight: '800', color: T.ink },
  cardDesc: { fontSize: 13, fontWeight: '500', color: T.inkMed, marginBottom: 10 },

  deleteBtn: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteBtnText: { fontSize: 15, fontWeight: '800', color: T.inkLight },

  noBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: T.paperDark,
    borderWidth: 1,
    borderColor: T.paperLine,
  },
  noBadgeText: { fontSize: 11, fontWeight: '700', color: T.inkLight },

  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  progressTrack: {
    flex: 1,
    height: 14,
    borderRadius: 4,
    backgroundColor: T.paperDark,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', backgroundColor: T.ink, borderRadius: 4 },
  progressLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: T.inkMed,
    minWidth: 72,
    textAlign: 'right',
  },

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
  },
  fabText: { fontSize: 28, color: T.paper, lineHeight: 32 },

  // ── 모달 ──────────────────────────────────────────────────────────────────
  modalRoot: { flex: 1, backgroundColor: T.paper },

  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: 1.5,
    borderBottomColor: T.ink,
  },
  headerSide: { width: 56 },
  cancelText: { fontSize: 15, fontWeight: '700', color: T.inkMed },
  modalTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '900',
    color: T.ink,
  },

  modalBody: { flex: 1, paddingHorizontal: 20 },

  ownerBadge: {
    marginTop: 20,
    marginBottom: 24,
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: T.paperDark,
    borderWidth: 1.5,
    borderColor: T.ink,
  },
  ownerBadgeText: { fontSize: 13, fontWeight: '700', color: T.ink },

  fieldLabel: { fontSize: 13, fontWeight: '800', color: T.inkMed, marginBottom: 10 },

  segmentRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  segBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: T.paperLine,
    backgroundColor: T.paper,
    alignItems: 'center',
  },
  segBtnActive: { backgroundColor: T.ink, borderColor: T.ink },
  segBtnText: { fontSize: 14, fontWeight: '700', color: T.inkMed },
  segBtnTextActive: { color: T.paper },

  formBox: { padding: 16, marginBottom: 4 },
  formBoxTitle: { fontSize: 13, fontWeight: '800', color: T.inkMed, marginBottom: 14 },

  // TIME_WINDOW 폼
  timeLabels: { flexDirection: 'row', marginBottom: 6 },
  timeFieldLabel: { fontSize: 12, fontWeight: '700', color: T.inkMed, marginBottom: 8 },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  timeBtn: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  timeBtnText: { fontSize: 18, fontWeight: '800', color: T.ink },
  timeSep: { fontSize: 18, fontWeight: '700', color: T.inkMed },

  // DURATION 폼
  durationRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  durationInput: {
    width: 100,
    paddingVertical: 10,
    paddingHorizontal: 16,
    fontSize: 18,
    fontWeight: '800',
    color: T.ink,
    textAlign: 'center',
  },
  durationSuffix: { fontSize: 14, fontWeight: '600', color: T.inkMed },

  submitBtn: {
    marginHorizontal: 20,
    paddingVertical: 16,
    borderRadius: 8,
    backgroundColor: T.ink,
    alignItems: 'center',
  },
  submitBtnDisabled: { opacity: 0.5 },
  submitBtnText: { fontSize: 15, fontWeight: '800', color: T.paper },

  // ── 시간 피커 오버레이 ──────────────────────────────────────────────────────
  pickerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 100,
  },
  pickerBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  pickerSheet: {
    backgroundColor: T.paper,
    borderRadius: 16,
    padding: 24,
    width: 260,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: T.inkLight,
  },
  pickerTitle: { fontSize: 16, fontWeight: '700', color: T.ink, marginBottom: 16 },
  pickerWheels: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pickerColon: { fontSize: 28, fontWeight: '900', color: T.ink },
  pickerConfirm: {
    marginTop: 20,
    backgroundColor: T.ink,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 40,
  },
  pickerConfirmText: { fontSize: 15, fontWeight: '700', color: T.paper },
});
