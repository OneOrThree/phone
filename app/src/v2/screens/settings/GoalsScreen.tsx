import { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import SettingsScaffold from '@/v2/screens/settings/components/SettingsScaffold';
import Slider from '@/v2/screens/onboarding/components/Slider';
import { useUser } from '@/store/UserContext';
import { STORAGE_KEYS } from '@/types/storage';
import type { V2RootStackParamList } from '@/navigation/types';
import { T } from '@/constants/theme';

type IconName = keyof typeof Ionicons.glyphMap;

// 개인 목표 수정(SettingsGoals) — 집중(채우기)·사용(넘지 않기) 두 목표를 슬라이더로 조정.
// ★ '오늘 보상 기준은 그대로' 보장: 저장해도 컨텍스트·서버를 즉시 바꾸지 않고 goalPending에 '내일부터'
//   예약만 남긴다. 실제 반영은 발효일이 지난 뒤 PendingGoalApplier(App 루트)가 한다.
//   현재 예약이 있으면 그 값으로 슬라이더를 초기화하고, 현재 목표와 같게 되돌려 저장하면 예약을 취소한다.

// 목표 하한/상한(분) — 집중 30분~10시간, 사용 30분~12시간. 10분 단위.
const MIN_MINUTES = 30;
const FOCUS_MAX_MINUTES = 10 * 60;
const USAGE_MAX_MINUTES = 12 * 60;
const STEP = 10;

// 초 → 10분 단위 스냅 + [하한, 상한] 클램프한 '목표 분'.
function toGoalMinutes(seconds: number, maxMinutes: number): number {
  return snapClamp(seconds / 60, maxMinutes);
}

// 분 → 10분 단위 스냅 + [하한, 상한] 클램프.
function snapClamp(minutes: number, maxMinutes: number): number {
  const snapped = Math.round(minutes / STEP) * STEP;
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
  activeMinutes: number; // 오늘 적용 중인 목표
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
  activeMinutes,
  onChange,
}: GoalCardProps) {
  const changed = value !== activeMinutes;

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

      {/* 선택값(크게) + 오늘 적용 중인 값 대비 */}
      <Text style={s.value}>{fmt(value)}</Text>
      {changed ? (
        <Text style={s.fromText} numberOfLines={1}>
          오늘 {fmt(activeMinutes)} · 내일부터 이 값으로 적용
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
  const { userId, goalSeconds, screenTimeGoalSeconds } = useUser();

  // 오늘 적용 중인 목표(비교 기준) — 저장해도 이 값은 안 바뀐다(내일 발효).
  const activeFocusMin = useMemo(
    () => toGoalMinutes(goalSeconds, FOCUS_MAX_MINUTES),
    [goalSeconds],
  );
  const activeUsageMin = useMemo(
    () => toGoalMinutes(screenTimeGoalSeconds, USAGE_MAX_MINUTES),
    [screenTimeGoalSeconds],
  );

  // 슬라이더 상태 — 초기엔 현재 목표, 예약이 있으면 예약값으로 덮어씀(아래 effect).
  const [focusMinutes, setFocusMinutes] = useState(activeFocusMin);
  const [usageMinutes, setUsageMinutes] = useState(activeUsageMin);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  // 발효 전 예약(goalPending)이 있으면 그 값으로 슬라이더 초기화.
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEYS.goalPending)
      .then((raw) => {
        if (raw) {
          try {
            const p = JSON.parse(raw) as {
              dailyFocusTimeGoalMinutes?: number;
              dailyScreenTimeGoalMinutes?: number;
            };
            if (typeof p.dailyFocusTimeGoalMinutes === 'number') {
              setFocusMinutes(snapClamp(p.dailyFocusTimeGoalMinutes, FOCUS_MAX_MINUTES));
            }
            if (typeof p.dailyScreenTimeGoalMinutes === 'number') {
              setUsageMinutes(snapClamp(p.dailyScreenTimeGoalMinutes, USAGE_MAX_MINUTES));
            }
          } catch {
            // 깨진 예약값은 무시
          }
        }
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  // 내일(발효일).
  const tomorrow = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d;
  }, []);
  const tomorrowLabel = `${tomorrow.getMonth() + 1}/${tomorrow.getDate()}`;

  async function handleSave() {
    if (saving || !loaded) return;
    setSaving(true);
    const focusChanged = focusMinutes !== activeFocusMin;
    const usageChanged = usageMinutes !== activeUsageMin;
    try {
      if (focusChanged || usageChanged) {
        // 오늘은 그대로 두고 '내일부터 적용' 예약만 저장(컨텍스트·서버 미반영).
        // 바뀐 목표 필드만 담고, 계정(userId)에 스코프해 다른 계정에 잘못 적용되지 않게 한다(리뷰 반영).
        await AsyncStorage.setItem(
          STORAGE_KEYS.goalPending,
          JSON.stringify({
            userId,
            ...(focusChanged ? { dailyFocusTimeGoalMinutes: focusMinutes } : {}),
            ...(usageChanged ? { dailyScreenTimeGoalMinutes: usageMinutes } : {}),
            effectiveDate: toISODate(tomorrow),
          }),
        );
      } else {
        // 현재 목표와 동일하게 되돌림 → 기존 예약 취소.
        await AsyncStorage.removeItem(STORAGE_KEYS.goalPending);
      }
    } catch {
      // 예약 저장/삭제 실패는 치명적이지 않음
    }
    setSaving(false);
    navigation.goBack();
  }

  return (
    <SettingsScaffold
      title="개인 목표 수정"
      onBack={() => navigation.goBack()}
      footer={
        <TouchableOpacity
          style={[s.saveBtn, saving || !loaded ? s.saveBtnDisabled : null]}
          activeOpacity={0.85}
          disabled={saving || !loaded}
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
        activeMinutes={activeFocusMin}
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
        activeMinutes={activeUsageMin}
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
