import { useRef, useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  PanResponder,
  ScrollView,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { T, inkBox } from '../components/theme';

const GOAL_MAX = 86400;
const GOAL_STEP = 900; // 15분
const THUMB_SIZE = 24;
const TRACK_HEIGHT = 12;
const SLIDER_HEIGHT = 44;

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
  const [gender, setGender] = useState(null);
  const [birthYear, setBirthYear] = useState('');
  const [birthMonth, setBirthMonth] = useState('');
  const [birthDay, setBirthDay] = useState('');
  const [goalSeconds, setGoalSeconds] = useState(10800);

  const canProceed =
    gender !== null && birthYear.length === 4 && birthMonth.length > 0 && birthDay.length > 0;

  async function handleComplete() {
    const birthday = `${birthYear}-${birthMonth.padStart(2, '0')}-${birthDay.padStart(2, '0')}`;
    await AsyncStorage.setItem(
      'gromo:onboarding',
      JSON.stringify({ gender, birthday, goalSeconds }),
    );
    await AsyncStorage.setItem('gromo:onboardingDone', 'true');
    onComplete({ goalSeconds });
  }

  return (
    <KeyboardAvoidingView
      style={s.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <Text style={s.title}>gromo</Text>
        <Text style={s.subtitle}>나에 대해 알려주세요 ✦</Text>

        {/* 성별 */}
        <View style={s.section}>
          <Text style={s.label}>성별</Text>
          <View style={s.row}>
            {GENDER_OPTIONS.map((opt) => (
              <Pressable
                key={opt.value}
                style={({ pressed }) => [
                  s.optionBtn,
                  inkBox(gender === opt.value ? T.yellow : T.paper),
                  pressed && s.pressed,
                ]}
                onPress={() => setGender(opt.value)}
              >
                <Text style={s.optionText}>{opt.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* 생년월일 */}
        <View style={s.section}>
          <Text style={s.label}>생년월일</Text>
          <View style={s.dateRow}>
            <TextInput
              style={[s.dateInput, s.dateInputYear, inkBox(T.paper)]}
              value={birthYear}
              onChangeText={(v) => setBirthYear(v.replace(/[^0-9]/g, '').slice(0, 4))}
              keyboardType="number-pad"
              placeholder="YYYY"
              placeholderTextColor={T.inkLight}
              maxLength={4}
            />
            <Text style={s.dateSep}>/</Text>
            <TextInput
              style={[s.dateInput, inkBox(T.paper)]}
              value={birthMonth}
              onChangeText={(v) => setBirthMonth(v.replace(/[^0-9]/g, '').slice(0, 2))}
              keyboardType="number-pad"
              placeholder="MM"
              placeholderTextColor={T.inkLight}
              maxLength={2}
            />
            <Text style={s.dateSep}>/</Text>
            <TextInput
              style={[s.dateInput, inkBox(T.paper)]}
              value={birthDay}
              onChangeText={(v) => setBirthDay(v.replace(/[^0-9]/g, '').slice(0, 2))}
              keyboardType="number-pad"
              placeholder="DD"
              placeholderTextColor={T.inkLight}
              maxLength={2}
            />
          </View>
        </View>

        {/* 목표 스크린타임 */}
        <View style={s.section}>
          <Text style={s.label}>목표 스크린타임</Text>
          <View style={[s.sliderCard, inkBox(T.paperDark)]}>
            <GoalSlider value={goalSeconds} onChange={setGoalSeconds} />
          </View>
        </View>

        <Pressable
          style={({ pressed }) => [
            s.startBtn,
            inkBox(canProceed ? T.coral : T.paperDark),
            pressed && canProceed && s.pressed,
          ]}
          onPress={handleComplete}
          disabled={!canProceed}
        >
          <Text style={s.startBtnText}>시작하기 →</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: T.paper,
    paddingHorizontal: 28,
    paddingTop: 80,
  },
  title: {
    fontSize: 40,
    fontWeight: '900',
    color: T.ink,
    letterSpacing: 4,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 16,
    fontWeight: '700',
    color: T.inkMed,
    marginBottom: 40,
  },
  section: {
    marginBottom: 32,
  },
  label: {
    fontSize: 14,
    fontWeight: '800',
    color: T.ink,
    marginBottom: 12,
    letterSpacing: 1,
  },
  row: {
    flexDirection: 'row',
    gap: 10,
  },
  optionBtn: {
    paddingVertical: 10,
    paddingHorizontal: 22,
    alignItems: 'center',
  },
  optionText: {
    fontSize: 14,
    fontWeight: '800',
    color: T.ink,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dateInput: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 10,
    fontSize: 16,
    fontWeight: '700',
    color: T.ink,
    textAlign: 'center',
  },
  dateInputYear: {
    flex: 2,
  },
  dateSep: {
    fontSize: 20,
    fontWeight: '900',
    color: T.inkMed,
  },
  sliderCard: {
    padding: 20,
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
    borderWidth: 2,
    borderColor: T.ink,
    overflow: 'hidden',
  },
  sliderFill: {
    height: '100%',
    backgroundColor: T.coral,
  },
  sliderThumb: {
    position: 'absolute',
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    backgroundColor: T.yellow,
    borderWidth: 3,
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
    fontWeight: '700',
    color: T.inkLight,
  },
  startBtn: {
    marginTop: 8,
    marginBottom: 48,
    paddingVertical: 16,
    alignItems: 'center',
  },
  startBtnText: {
    fontSize: 17,
    fontWeight: '900',
    color: T.ink,
  },
  pressed: {
    transform: [{ translateX: 2 }, { translateY: 2 }],
    borderBottomWidth: 2.5,
    borderRightWidth: 2.5,
  },
});
