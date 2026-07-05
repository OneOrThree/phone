import { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import SettingsScaffold from '@/v2/screens/settings/components/SettingsScaffold';
import Slider from '@/v2/screens/onboarding/components/Slider';
import { useUser } from '@/store/UserContext';
import { updateFocusTimeGoal, updateScreenTimeGoal } from '@/services/userApi';
import { STORAGE_KEYS } from '@/types/storage';
import type { V2RootStackParamList } from '@/navigation/types';
import { T } from '@/constants/theme';

type IconName = keyof typeof Ionicons.glyphMap;

// 개인 목표 수정(SettingsGoals) — 집중(채우기)·사용(넘지 않기) 두 목표를 슬라이더로 조정.
// 값 변경 시 '기존' 값을 함께 보여주고, 저장하면 서버 반영 + 컨텍스트 갱신 + '내일 발효' 예약을
// 로컬(goalPending)에 남긴다. 실제 '내일부터 적용' 강제는 후속 작업이고, 지금은 즉시 저장 + 안내만.

// 목표 하한/상한(분) — 집중 30분~10시간, 사용 30분~12시간. 10분 단위.
const MIN_MINUTES = 30;
const FOCUS_MAX_MINUTES = 10 * 60;
const USAGE_MAX_MINUTES = 12 * 60;
const STEP = 10;

// 초 → 10분 단위로 스냅한 뒤 [하한, 상한]으로 클램프한 '목표 분'.
function toGoalMinutes(seconds: number, maxMinutes: number): number {
  const snapped = Math.round(seconds / 60 / STEP) * STEP;
  return Math.min(maxMinutes, Math.max(MIN_MINUTES, snapped));
}

// 총 분 → '3시간 20분' / '4시간' / '30분' 표기.
function fmt(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h && m) return `${h}시간 ${m}분`;
  if (h) return `${h}시간`;
  return `${m}분`;
}

// Date → 'YYYY-MM-DD'(로컬 기준) — goalPending 발효일 저장용.
function toISODate(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

// ── 목표 하나(집중 또는 사용)를 편집하는 카드 ─────────────────────────────
interface GoalCardProps {
  icon: IconName;
  iconColor: string;
  iconBg: string;
  label: string;
  sub: string;
  min: number;
  max: number;
  value: number;
  originalMinutes: number;
  onChange: (minutes: number) => void;
}

function GoalCard({
  icon,
  iconColor,
  iconBg,
  label,
  sub,
  min,
  max,
  value,
  originalMinutes,
  onChange,
}: GoalCardProps) {
  const changed = value !== originalMinutes;

  return (
    <View style={s.card}>
      <View style={s.cardHead}>
        <View style={[s.cardIcon, { backgroundColor: iconBg }]}>
          <Ionicons name={icon} size={18} color={iconColor} />
        </View>
        <View style={s.flex1}>
          <Text style={s.cardLabel}>{label}</Text>
          <Text style={s.cardSub}>{sub}</Text>
        </View>
      </View>

      {/* 현재 선택값(크게) + 바뀐 경우 기존값 표기 */}
      <Text style={s.value}>{fmt(value)}</Text>
      {changed ? (
        <Text style={s.fromText} numberOfLines={1}>
          기존 {fmt(originalMinutes)}에서 변경
        </Text>
      ) : (
        <Text style={s.fromText}>현재 목표</Text>
      )}

      <View style={s.sliderArea}>
        <Slider min={min} max={max} step={STEP} value={value} onChange={onChange} />
        <View style={s.sliderLabels}>
          <Text style={s.minor}>{fmt(min)}</Text>
          <Text style={s.minor}>{fmt(max)}</Text>
        </View>
      </View>
    </View>
  );
}

export default function GoalsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<V2RootStackParamList>>();
  const { goalSeconds, screenTimeGoalSeconds, setGoalSeconds, setScreenTimeGoalSeconds } =
    useUser();

  // 편집 전 원본(저장 전까진 컨텍스트가 바뀌지 않으므로 비교 기준으로 안전).
  const originalFocusMin = useMemo(
    () => toGoalMinutes(goalSeconds, FOCUS_MAX_MINUTES),
    [goalSeconds],
  );
  const originalUsageMin = useMemo(
    () => toGoalMinutes(screenTimeGoalSeconds, USAGE_MAX_MINUTES),
    [screenTimeGoalSeconds],
  );

  // 편집 상태(분) — 초기값은 원본.
  const [focusMinutes, setFocusMinutes] = useState(originalFocusMin);
  const [usageMinutes, setUsageMinutes] = useState(originalUsageMin);
  const [saving, setSaving] = useState(false);

  // 내일(발효일) — 안내 문구용 M/D와 저장용 ISO 날짜.
  const tomorrow = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d;
  }, []);
  const tomorrowLabel = `${tomorrow.getMonth() + 1}/${tomorrow.getDate()}`;

  async function handleSave() {
    if (saving) return;
    setSaving(true);

    // 서버 반영(둘을 독립적으로 시도 — 하나가 실패해도 나머지·로컬 반영은 진행).
    try {
      await updateFocusTimeGoal({ dailyFocusTimeGoalMinutes: focusMinutes });
    } catch {
      // 서버 반영 실패는 무시(로컬 반영 후 다음 동기화에서 복구)
    }
    try {
      await updateScreenTimeGoal({ dailyScreenTimeGoalMinutes: usageMinutes });
    } catch {
      // 서버 반영 실패는 무시(로컬 반영 후 다음 동기화에서 복구)
    }

    // 컨텍스트 즉시 반영(앱 전역의 목표 표시가 곧바로 갱신됨).
    setGoalSeconds(focusMinutes * 60);
    setScreenTimeGoalSeconds(usageMinutes * 60);

    // '내일 발효' 예약 — 후속 발효 처리에서 effectiveDate를 소비한다.
    try {
      await AsyncStorage.setItem(
        STORAGE_KEYS.goalPending,
        JSON.stringify({
          dailyFocusTimeGoalMinutes: focusMinutes,
          dailyScreenTimeGoalMinutes: usageMinutes,
          effectiveDate: toISODate(tomorrow),
        }),
      );
    } catch {
      // 로컬 예약 저장 실패는 치명적이지 않음
    }

    navigation.goBack();
  }

  return (
    <SettingsScaffold
      title="개인 목표 수정"
      onBack={() => navigation.goBack()}
      footer={
        <TouchableOpacity
          style={[s.saveBtn, saving && s.saveBtnDisabled]}
          activeOpacity={0.85}
          disabled={saving}
          onPress={handleSave}
        >
          <Text style={s.saveText}>{saving ? '저장 중…' : '저장'}</Text>
        </TouchableOpacity>
      }
    >
      <GoalCard
        icon="flag-outline"
        iconColor={T.accentDeep}
        iconBg={T.accentBg}
        label="목표 집중시간"
        sub="채우기 · 많이 채울수록 좋아요"
        min={MIN_MINUTES}
        max={FOCUS_MAX_MINUTES}
        value={focusMinutes}
        originalMinutes={originalFocusMin}
        onChange={setFocusMinutes}
      />

      <GoalCard
        icon="phone-portrait-outline"
        iconColor={T.greenDeep}
        iconBg={T.greenBg}
        label="목표 사용시간"
        sub="넘지 않기 · 줄일수록 좋아요"
        min={MIN_MINUTES}
        max={USAGE_MAX_MINUTES}
        value={usageMinutes}
        originalMinutes={originalUsageMin}
        onChange={setUsageMinutes}
      />

      <View style={s.note}>
        <Ionicons name="information-circle-outline" size={16} color={T.accentDeep} />
        <Text style={s.noteText}>
          변경한 목표는 내일({tomorrowLabel})부터 적용돼요. 오늘 보상 기준은 그대로예요.
        </Text>
      </View>
    </SettingsScaffold>
  );
}

const s = StyleSheet.create({
  flex1: { flex: 1 },

  // 목표 카드
  card: {
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.paperAlt,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 18,
    marginTop: 16,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardIcon: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardLabel: { ...T.text.label, color: T.ink },
  cardSub: { ...T.text.caption, color: T.inkMuted, marginTop: 2 },

  // 값 표시
  value: { ...T.text.display, color: T.ink, textAlign: 'center', marginTop: 14 },
  fromText: {
    ...T.text.caption,
    fontWeight: '500',
    color: T.inkMuted,
    textAlign: 'center',
    marginTop: 4,
  },

  // 슬라이더
  sliderArea: { alignSelf: 'stretch', marginTop: 16 },
  sliderLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  minor: { ...T.text.caption, fontWeight: '500', color: T.inkMuted },

  // 안내 박스
  note: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: T.noteBg,
    borderWidth: 1,
    borderColor: T.noteBorder,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginTop: 18,
  },
  noteText: { ...T.text.caption, fontWeight: '500', color: T.inkSub, flex: 1, lineHeight: 19 },

  // 저장 버튼(footer)
  saveBtn: {
    height: 54,
    borderRadius: 16,
    backgroundColor: T.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnDisabled: { opacity: 0.5 },
  saveText: { ...T.text.subtitle, color: T.white },
});
