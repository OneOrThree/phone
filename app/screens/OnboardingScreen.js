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
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { T } from '../components/theme';

const GOAL_MAX = 86400;
const GOAL_STEP = 900;
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
        <Text style={s.subtitle}>나에 대해 알려주세요</Text>

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
          <View style={s.dateRow}>
            <TextInput
              style={[s.dateInput, s.dateInputYear]}
              value={birthYear}
              onChangeText={(v) => setBirthYear(v.replace(/[^0-9]/g, '').slice(0, 4))}
              keyboardType="number-pad"
              placeholder="YYYY"
              placeholderTextColor={T.inkLight}
              maxLength={4}
            />
            <Text style={s.dateSep}>/</Text>
            <TextInput
              style={s.dateInput}
              value={birthMonth}
              onChangeText={(v) => setBirthMonth(v.replace(/[^0-9]/g, '').slice(0, 2))}
              keyboardType="number-pad"
              placeholder="MM"
              placeholderTextColor={T.inkLight}
              maxLength={2}
            />
            <Text style={s.dateSep}>/</Text>
            <TextInput
              style={s.dateInput}
              value={birthDay}
              onChangeText={(v) => setBirthDay(v.replace(/[^0-9]/g, '').slice(0, 2))}
              keyboardType="number-pad"
              placeholder="DD"
              placeholderTextColor={T.inkLight}
              maxLength={2}
            />
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
  container: {
    flex: 1,
    backgroundColor: T.paper,
    paddingHorizontal: 24,
    paddingTop: 80,
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
  row: {
    flexDirection: 'row',
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
    fontWeight: '600',
    color: T.ink,
    textAlign: 'center',
    borderWidth: 1.5,
    borderColor: T.inkLight,
    borderRadius: 6,
  },
  dateInputYear: {
    flex: 2,
  },
  dateSep: {
    fontSize: 18,
    fontWeight: '700',
    color: T.inkMed,
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
