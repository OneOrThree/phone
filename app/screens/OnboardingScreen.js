import { useRef, useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  PanResponder,
  ScrollView,
  FlatList,
  Modal,
} from 'react-native';
import { T } from '../components/theme';
import BirthdayPicker from '../components/BirthdayPicker';

const GOAL_MAX = 86400;
const GOAL_STEP = 900;
const THUMB_SIZE = 24;
const TRACK_HEIGHT = 12;
const SLIDER_HEIGHT = 44;

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);
const WHEEL_ITEM_H = 44;
const WHEEL_VISIBLE = 3;

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
  wrap: {
    width: 60,
    height: WHEEL_ITEM_H * WHEEL_VISIBLE,
    overflow: 'hidden',
  },
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

function TimePicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [tempHour, setTempHour] = useState(value.hour);
  const [tempMinute, setTempMinute] = useState(value.minute);

  function handleOpen() {
    setTempHour(value.hour);
    setTempMinute(value.minute);
    setOpen(true);
  }

  function handleConfirm() {
    onChange({ hour: tempHour, minute: tempMinute });
    setOpen(false);
  }

  const display = `${String(value.hour).padStart(2, '0')}:${String(value.minute).padStart(2, '0')}`;

  return (
    <>
      <TouchableOpacity onPress={handleOpen} style={tp.btn} activeOpacity={0.7}>
        <Text style={tp.btnText}>{display}</Text>
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade">
        <View style={tp.overlay}>
          <View style={tp.sheet}>
            <Text style={tp.title}>시간 선택</Text>
            <View style={tp.wheels}>
              <WheelList data={HOURS} value={tempHour} onChange={setTempHour} />
              <Text style={tp.colon}>:</Text>
              <WheelList data={MINUTES} value={tempMinute} onChange={setTempMinute} />
            </View>
            <TouchableOpacity onPress={handleConfirm} style={tp.confirm} activeOpacity={0.7}>
              <Text style={tp.confirmText}>확인</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
}

const tp = StyleSheet.create({
  btn: {
    borderWidth: 1.5,
    borderColor: T.ink,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  btnText: { fontSize: 18, fontWeight: '800', color: T.ink },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  sheet: {
    backgroundColor: T.paper,
    borderRadius: 16,
    padding: 24,
    width: 260,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: T.inkLight,
  },
  title: { fontSize: 16, fontWeight: '700', color: T.ink, marginBottom: 16 },
  wheels: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  colon: { fontSize: 28, fontWeight: '900', color: T.ink },
  confirm: {
    marginTop: 20,
    backgroundColor: T.ink,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 40,
  },
  confirmText: { fontSize: 15, fontWeight: '700', color: '#FFFFFF' },
});

const GENDER_OPTIONS = [
  { value: 'male', label: '남성' },
  { value: 'female', label: '여성' },
  { value: 'other', label: '기타' },
];

function formatGoalTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h === 0) return `${m}분`;
  if (m === 0) return `${h}시간`;
  return `${h}시간 ${m}분`;
}

function GoalSlider({ value, onChange }) {
  const [trackWidth, setTrackWidth] = useState(0);
  const trackRef = useRef(null);
  const trackWidthRef = useRef(0);
  const pageXRef = useRef(0);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  function measureTrack() {
    trackRef.current?.measure((x, y, w, h, pageX) => {
      pageXRef.current = pageX;
      trackWidthRef.current = w;
      setTrackWidth(w);
    });
  }

  function snapValue(localX) {
    const w = trackWidthRef.current;
    if (w === 0) return value;
    const clamped = Math.max(0, Math.min(w, localX));
    const raw = (clamped / w) * GOAL_MAX;
    const stepped = Math.round(raw / GOAL_STEP) * GOAL_STEP;
    return Math.min(GOAL_MAX, Math.max(GOAL_STEP, stepped));
  }

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e, gs) => {
        onChangeRef.current(snapValue(gs.x0 - pageXRef.current));
      },
      onPanResponderMove: (e, gs) => {
        onChangeRef.current(snapValue(gs.moveX - pageXRef.current));
      },
    }),
  ).current;

  const fillPercent = (value / GOAL_MAX) * 100;
  const thumbLeft = trackWidth > 0 ? (value / GOAL_MAX) * trackWidth - THUMB_SIZE / 2 : 0;

  return (
    <View style={s.sliderWrapper}>
      <Text style={s.sliderValue}>{formatGoalTime(value)}</Text>
      <View
        ref={trackRef}
        style={s.sliderArea}
        onLayout={measureTrack}
        {...panResponder.panHandlers}
      >
        <View style={s.sliderTrack}>
          <View style={[s.sliderFill, { width: `${fillPercent}%` }]} />
        </View>
        {trackWidth > 0 && <View style={[s.sliderThumb, { left: thumbLeft }]} />}
      </View>
      <View style={s.sliderTicks}>
        {['0h', '6h', '12h', '18h', '24h'].map((label) => (
          <Text key={label} style={s.sliderTickText}>
            {label}
          </Text>
        ))}
      </View>
    </View>
  );
}

export default function OnboardingScreen({ onComplete }) {
  const [nickname, setNickname] = useState('');
  const [gender, setGender] = useState(null);
  const [birthDate, setBirthDate] = useState(null);
  const [goalSeconds, setGoalSeconds] = useState(10800);
  const [wakeTime, setWakeTime] = useState({ hour: 0, minute: 0 });
  const [sleepTime, setSleepTime] = useState({ hour: 0, minute: 0 });
  const [reportTime, setReportTime] = useState({ hour: 0, minute: 0 });

  const canProceed = nickname.trim().length > 0 && gender !== null && birthDate !== null;

  function handleComplete() {
    const y = birthDate.getFullYear();
    const m = String(birthDate.getMonth() + 1).padStart(2, '0');
    const d = String(birthDate.getDate()).padStart(2, '0');
    const birthday = `${y}-${m}-${d}`;
    onComplete({
      nickname: nickname.trim(),
      gender,
      birthday,
      goalSeconds,
      dayStartTime: `${String(wakeTime.hour).padStart(2, '0')}:${String(wakeTime.minute).padStart(2, '0')}`,
      dayEndTime: `${String(sleepTime.hour).padStart(2, '0')}:${String(sleepTime.minute).padStart(2, '0')}`,
      reportTime: `${String(reportTime.hour).padStart(2, '0')}:${String(reportTime.minute).padStart(2, '0')}`,
    });
  }

  return (
    <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        style={s.container}
        contentContainerStyle={s.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={s.title}>gromo</Text>
        <Text style={s.subtitle}>나에 대해 알려주세요</Text>

        <View style={s.section}>
          <Text style={s.label}>닉네임</Text>
          <TextInput
            style={s.textInput}
            value={nickname}
            onChangeText={(v) => setNickname(v.slice(0, 10))}
            placeholder="닉네임 입력 (최대 10자)"
            placeholderTextColor={T.inkLight}
            maxLength={10}
          />
        </View>

        <View style={s.section}>
          <Text style={s.label}>성별</Text>
          <View style={s.row}>
            {GENDER_OPTIONS.map((opt) => (
              <TouchableOpacity
                key={opt.value}
                style={[s.toggleBtn, gender === opt.value && s.toggleBtnActive]}
                onPress={() => setGender(opt.value)}
                activeOpacity={0.7}
              >
                <Text style={[s.toggleText, gender === opt.value && s.toggleTextActive]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={s.section}>
          <Text style={s.label}>생년월일</Text>
          <BirthdayPicker value={birthDate} onChange={setBirthDate} />
        </View>

        <View style={s.section}>
          <Text style={s.label}>GroMo가 추적할 당신의 시간</Text>
          <View style={s.timeBlock}>
            <View style={s.timeRow}>
              <Text style={s.timePrefix}>저는 주로</Text>
              <TimePicker value={wakeTime} onChange={setWakeTime} />
              <Text style={s.timeText}>에 일어나서</Text>
            </View>
            <View style={[s.timeRow, s.timeRowSecond]}>
              <View style={s.timePrefix} />
              <TimePicker value={sleepTime} onChange={setSleepTime} />
              <Text style={s.timeText}>에 자요</Text>
            </View>
            <View style={[s.timeRow, s.timeRowSecond]}>
              <Text style={s.timePrefixLong}>분석 레포트는</Text>
              <TimePicker value={reportTime} onChange={setReportTime} />
              <Text style={s.timeText}>에 받고 싶어요</Text>
            </View>
            <Text style={s.timeCaption}>하루 핸드폰 사용과 몰입 결과를 알려드려요</Text>
          </View>
        </View>

        <View style={s.section}>
          <Text style={s.label}>목표 스크린타임</Text>
          <View style={s.sliderCard}>
            <GoalSlider value={goalSeconds} onChange={setGoalSeconds} />
          </View>
        </View>

        <TouchableOpacity
          style={[s.primaryBtn, !canProceed && s.primaryBtnDisabled]}
          onPress={handleComplete}
          disabled={!canProceed}
          activeOpacity={0.7}
        >
          <Text style={s.primaryBtnText}>시작하기</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  container: {
    flex: 1,
    backgroundColor: T.paper,
    paddingHorizontal: 24,
    paddingTop: 80,
  },
  scrollContent: {
    paddingBottom: 60,
  },
  title: {
    fontSize: 36,
    fontWeight: '900',
    color: T.ink,
    letterSpacing: 2,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 15,
    color: T.inkMed,
    marginBottom: 36,
  },
  section: {
    marginBottom: 28,
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
    color: T.inkMed,
    marginBottom: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  textInput: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    fontSize: 16,
    fontWeight: '600',
    color: T.ink,
    borderWidth: 1.5,
    borderColor: T.inkLight,
    borderRadius: 6,
  },
  timeBlock: {
    alignSelf: 'center',
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  timeRowSecond: { marginTop: 12 },
  timePrefix: {
    width: 90,
    fontSize: 16,
    fontWeight: '600',
    color: T.ink,
    textAlign: 'right',
  },
  timePrefixLong: {
    width: 90,
    fontSize: 16,
    fontWeight: '600',
    color: T.ink,
    textAlign: 'right',
  },
  timeText: {
    fontSize: 16,
    fontWeight: '600',
    color: T.ink,
  },
  timeCaption: {
    marginTop: 10,
    fontSize: 12,
    color: T.inkLight,
    textAlign: 'center',
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  toggleBtn: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderWidth: 1.5,
    borderColor: T.inkLight,
    borderRadius: 6,
  },
  toggleBtnActive: {
    backgroundColor: T.ink,
    borderColor: T.ink,
  },
  toggleText: {
    fontSize: 14,
    fontWeight: '600',
    color: T.inkMed,
  },
  toggleTextActive: {
    color: '#FFFFFF',
  },
  sliderCard: {
    padding: 20,
    borderWidth: 1.5,
    borderColor: T.inkLight,
    borderRadius: 8,
  },
  sliderValue: {
    fontSize: 32,
    fontWeight: '900',
    color: T.ink,
    textAlign: 'center',
    marginBottom: 16,
  },
  sliderWrapper: { width: '100%' },
  sliderArea: {
    height: SLIDER_HEIGHT,
    justifyContent: 'center',
    position: 'relative',
  },
  sliderTrack: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: TRACK_HEIGHT,
    top: (SLIDER_HEIGHT - TRACK_HEIGHT) / 2,
    borderRadius: TRACK_HEIGHT / 2,
    backgroundColor: T.paperLine,
    borderWidth: 1.5,
    borderColor: T.inkLight,
    overflow: 'hidden',
  },
  sliderFill: {
    height: '100%',
    backgroundColor: T.ink,
  },
  sliderThumb: {
    position: 'absolute',
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    backgroundColor: T.paper,
    borderWidth: 2.5,
    borderColor: T.ink,
    top: (SLIDER_HEIGHT - THUMB_SIZE) / 2,
  },
  sliderTicks: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  sliderTickText: {
    fontSize: 11,
    fontWeight: '600',
    color: T.inkLight,
  },
  primaryBtn: {
    marginTop: 8,
    marginBottom: 48,
    paddingVertical: 16,
    backgroundColor: T.ink,
    borderRadius: 8,
    alignItems: 'center',
  },
  primaryBtnDisabled: {
    backgroundColor: T.inkLight,
  },
  primaryBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
