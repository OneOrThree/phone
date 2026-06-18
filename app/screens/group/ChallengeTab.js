import { useRef, useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  FlatList,
  TouchableOpacity,
  Modal,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  StyleSheet,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { T, inkBox } from '../../components/theme';
import { apiFetch } from '../../utils/api';

const DEVICE_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

const CHALLENGE_TYPES = [
  { label: 'A-B 포커스', value: 'TIME_WINDOW' },
  { label: 'N 스크린타임', value: 'DURATION' },
];

// 휠 피커 데이터
const WHEEL_HOURS = Array.from({ length: 24 }, (_, i) => i);
const WHEEL_MINS = Array.from({ length: 12 }, (_, i) => i * 5);
const WHEEL_DUR_HOURS = Array.from({ length: 9 }, (_, i) => i); // 0~8시간 (DURATION용)
const WHEEL_ITEM_H = 44;
const WHEEL_VISIBLE = 3;

// OnboardingScreen과 동일한 WheelList 컴포넌트
function WheelList({ data, value, onChange }) {
  const listRef = useRef(null);
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

  function handleScrollEnd(e) {
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

function timeToInstant(hour, minute) {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

function formatTime(instant) {
  if (!instant) return '--:--';
  const d = new Date(instant);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatTimeVal({ hour, minute }) {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function formatDurationVal({ hour, minute }) {
  if (hour === 0 && minute === 0) return '0분';
  if (hour === 0) return `${minute}분`;
  if (minute === 0) return `${hour}시간`;
  return `${hour}시간 ${minute}분`;
}

function getChallengeIcon(c) {
  if (c.missionCategory === 'SCREEN_TIME') return '📱';
  if (c.missionType === 'TIME_WINDOW') return '⏰';
  return '🎯';
}

function getChallengeName(c) {
  if (c.missionType === 'TIME_WINDOW') {
    return c.missionCategory === 'SCREEN_TIME' ? 'A-B 스크린타임' : 'A-B 포커스';
  }
  return c.missionCategory === 'SCREEN_TIME' ? 'N 스크린타임' : 'N 집중';
}

function getChallengeDesc(c) {
  if (c.missionType === 'TIME_WINDOW') {
    const start = formatTime(c.windowStart);
    const end = formatTime(c.windowEnd);
    const label = c.missionCategory === 'SCREEN_TIME' ? '스크린타임' : '집중';
    return `${start} ~ ${end} ${label}`;
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

export default function ChallengeTab({ group, groupId }) {
  const [challenges, setChallenges] = useState([]);
  const [loading, setLoading] = useState(true);
  const [createVisible, setCreateVisible] = useState(false);
  const [challengeType, setChallengeType] = useState('TIME_WINDOW');
  const [category, setCategory] = useState('FOCUS');
  const [startTime, setStartTime] = useState({ hour: 9, minute: 0 });
  const [endTime, setEndTime] = useState({ hour: 11, minute: 0 });
  const [duration, setDuration] = useState({ hour: 1, minute: 0 });
  // 시간 피커 팝업: 'start' | 'end' | 'duration' | null
  const [pickerTarget, setPickerTarget] = useState(null);
  const [tempHour, setTempHour] = useState(0);
  const [tempMinute, setTempMinute] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const insets = useSafeAreaInsets();

  const isOwner = !!group?.code;

  async function fetchChallenges() {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/v1/groups/${groupId}/challenges`);
      if (!res.ok) throw new Error();
      const data = await res.json();
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

  function openCreate() {
    setChallengeType('TIME_WINDOW');
    setCategory('FOCUS');
    setStartTime({ hour: 9, minute: 0 });
    setEndTime({ hour: 11, minute: 0 });
    setDuration({ hour: 1, minute: 0 });
    setPickerTarget(null);
    setCreateVisible(true);
  }

  function openTimePicker(target) {
    const val = target === 'start' ? startTime : target === 'end' ? endTime : duration;
    setTempHour(val.hour);
    setTempMinute(val.minute);
    setPickerTarget(target);
  }

  function confirmTimePicker() {
    if (pickerTarget === 'start') setStartTime({ hour: tempHour, minute: tempMinute });
    else if (pickerTarget === 'end') setEndTime({ hour: tempHour, minute: tempMinute });
    else if (pickerTarget === 'duration') setDuration({ hour: tempHour, minute: tempMinute });
    setPickerTarget(null);
  }

  async function handleSave() {
    let body = { missionCategory: category, missionType: challengeType };

    if (challengeType === 'TIME_WINDOW') {
      const ws = timeToInstant(startTime.hour, startTime.minute);
      const we = timeToInstant(endTime.hour, endTime.minute);
      if (new Date(ws) >= new Date(we)) {
        Alert.alert('입력 오류', '종료 시각이 시작 시각보다 늦어야 해요');
        return;
      }
      body = { ...body, windowStart: ws, windowEnd: we, timeZone: DEVICE_TZ };
    } else {
      const mins = duration.hour * 60 + duration.minute;
      if (mins <= 0) {
        Alert.alert('입력 오류', '1분 이상으로 설정해주세요');
        return;
      }
      body = { ...body, durationMinutes: mins };
    }

    setSubmitting(true);
    try {
      const res = await apiFetch(`/api/v1/groups/${groupId}/challenges`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (res.status === 409) {
        Alert.alert('중복 챌린지', '같은 카테고리의 활성 챌린지가 이미 있어요');
        return;
      }
      if (!res.ok) throw new Error();
      setCreateVisible(false);
      fetchChallenges();
    } catch {
      Alert.alert('오류', '챌린지 생성에 실패했습니다');
    } finally {
      setSubmitting(false);
    }
  }

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
            challenges.map((c) => (
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
                  <View style={[s.statusBadge, c.status === 'ENDED' && s.statusBadgeEnded]}>
                    <Text style={[s.statusText, c.status === 'ENDED' && s.statusTextEnded]}>
                      {c.status === 'ACTIVE' ? '활성' : '종료'}
                    </Text>
                  </View>
                </View>
                <Text style={s.cardDesc}>{getChallengeDesc(c)}</Text>
              </View>
            ))
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

            {/* 미션 카테고리 (G13에서 챌린지 유형과 위치 교체) */}
            <Text style={s.fieldLabel}>미션 카테고리</Text>
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

            {/* 챌린지 유형 (G13에서 미션 카테고리와 위치 교체) */}
            <Text style={[s.fieldLabel, { marginTop: 8 }]}>챌린지 유형</Text>
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

            {/* 조건부 폼 — 시간 버튼 터치 시 피커 팝업 오픈 */}
            {challengeType === 'TIME_WINDOW' ? (
              <View style={[s.formBox, inkBox(T.paperDark)]}>
                <Text style={s.formBoxTitle}>A-B 포커스 설정</Text>
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
                <Text style={s.formBoxTitle}>시간 설정</Text>
                <TouchableOpacity
                  style={[s.durationBtn, inkBox(T.paper)]}
                  onPress={() => openTimePicker('duration')}
                  activeOpacity={0.8}
                >
                  <Text style={s.timeBtnText}>{formatDurationVal(duration)}</Text>
                </TouchableOpacity>
              </View>
            )}
          </ScrollView>

          {/* 저장 버튼 */}
          <TouchableOpacity
            style={[s.submitBtn, submitting && s.btnDisabled, { marginBottom: insets.bottom + 16 }]}
            onPress={handleSave}
            disabled={submitting}
            activeOpacity={0.8}
          >
            <Text style={s.submitBtnText}>{submitting ? '저장 중...' : '저장하기'}</Text>
          </TouchableOpacity>

          {/* 시간 피커 오버레이 (모달 내부 절대좌표) */}
          {pickerTarget !== null && (
            <View style={s.pickerOverlay}>
              <TouchableOpacity
                style={s.pickerBackdrop}
                onPress={() => setPickerTarget(null)}
                activeOpacity={1}
              />
              <View style={s.pickerSheet}>
                <Text style={s.pickerTitle}>
                  {pickerTarget === 'duration' ? '시간 설정' : '시각 선택'}
                </Text>
                <View style={s.pickerWheels}>
                  <WheelList
                    data={pickerTarget === 'duration' ? WHEEL_DUR_HOURS : WHEEL_HOURS}
                    value={tempHour}
                    onChange={setTempHour}
                  />
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
  cardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 8 },
  cardIcon: { fontSize: 20 },
  cardHeaderText: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardName: { fontSize: 15, fontWeight: '800', color: T.ink },
  cardDesc: { fontSize: 13, fontWeight: '500', color: T.inkMed },

  noBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: T.paperDark,
    borderWidth: 1,
    borderColor: T.paperLine,
  },
  noBadgeText: { fontSize: 11, fontWeight: '700', color: T.inkLight },

  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
    backgroundColor: T.ink,
  },
  statusBadgeEnded: { backgroundColor: T.paperDark, borderWidth: 1, borderColor: T.paperLine },
  statusText: { fontSize: 11, fontWeight: '700', color: T.paper },
  statusTextEnded: { color: T.inkLight },

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
  timeFieldLabel: { fontSize: 12, fontWeight: '700', color: T.inkMed },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  timeBtn: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
  },
  timeBtnText: { fontSize: 18, fontWeight: '800', color: T.ink },
  timeSep: { fontSize: 18, fontWeight: '700', color: T.inkMed },

  // DURATION 폼
  durationBtn: {
    paddingVertical: 12,
    alignItems: 'center',
  },

  submitBtn: {
    marginHorizontal: 20,
    paddingVertical: 16,
    borderRadius: 8,
    backgroundColor: T.ink,
    alignItems: 'center',
  },
  submitBtnText: { fontSize: 15, fontWeight: '800', color: T.paper },
  btnDisabled: { opacity: 0.4 },

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
  pickerBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
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
