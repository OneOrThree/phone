import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import SettingsScaffold from '@/screens/settings/components/SettingsScaffold';
import { DurationDrumPicker } from '@/components/DurationDrumPicker';
import { useUser } from '@/store/UserContext';
import { STORAGE_KEYS } from '@/types/storage';
import type { V2RootStackParamList } from '@/navigation/types';
import { T } from '@/constants/theme';

type IconName = keyof typeof Ionicons.glyphMap;

// 개인 목표 수정(SettingsGoals) — 집중(채우기)·사용(넘지 않기) 두 목표를 드럼(휠) 피커로 조정.
// ★ '오늘 보상 기준은 그대로' 보장: 저장해도 컨텍스트·서버를 즉시 바꾸지 않고 goalPending에 '내일부터'
//   예약만 남긴다. 실제 반영은 발효일이 지난 뒤 PendingGoalApplier(App 루트)가 한다.
//   현재 예약이 있으면 그 값으로 피커를 초기화하고, 현재 목표와 같게 되돌려 저장하면 예약을 취소한다.

// 목표 하한/상한(분) — 온보딩 목표 설정과 동일하게 5분 단위 휠로 통일 (GROMO-969, 구 1분 단위는 630).
// 집중 5분~24시간, 사용 30분~12시간.
const FOCUS_MIN_MINUTES = 5;
const FOCUS_MAX_MINUTES = 24 * 60;
const FOCUS_STEP = 5;
const USAGE_MIN_MINUTES = 30;
const USAGE_MAX_MINUTES = 12 * 60;
const USAGE_STEP = 5;

// 분 → step 단위 스냅 + [하한, 상한] 클램프.
function snapClamp(minutes: number, min: number, max: number, step: number): number {
  const snapped = Math.round(minutes / step) * step;
  return Math.min(max, Math.max(min, snapped));
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

      <View style={s.pickerArea}>
        <DurationDrumPicker minMinutes={min} maxMinutes={max} value={value} onChange={onChange} />
      </View>

      {/* 선택값과 오늘 적용 중인 값의 대비 */}
      {changed ? (
        <Text style={s.fromText} numberOfLines={1}>
          오늘 {fmt(activeMinutes)} · 내일부터 이 값으로 적용
        </Text>
      ) : (
        <Text style={s.fromText}>현재 목표</Text>
      )}
    </View>
  );
}

export default function GoalsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<V2RootStackParamList>>();
  const { userId, goalSeconds, screenTimeGoalSeconds } = useUser();

  // 오늘 적용 중인 목표(비교·표시 기준) — 저장해도 이 값은 안 바뀐다(내일 발효).
  // 스냅하지 않은 실제 값을 쓴다: 구(1분 단위) 목표를 5분 스냅하면 피커 초기값과 같아져
  // '변경 없음'으로 오인되고, 스냅값으로 바꾸는 저장이 영영 불가능해진다(리뷰 반영).
  const activeFocusMin = useMemo(() => Math.round(goalSeconds / 60), [goalSeconds]);
  const activeUsageMin = useMemo(
    () => Math.round(screenTimeGoalSeconds / 60),
    [screenTimeGoalSeconds],
  );

  // 피커 상태 — 초기엔 현재 목표(5분 단위 스냅), 예약이 있으면 예약값으로 덮어씀(아래 effect).
  const [focusMinutes, setFocusMinutes] = useState(() =>
    snapClamp(activeFocusMin, FOCUS_MIN_MINUTES, FOCUS_MAX_MINUTES, FOCUS_STEP),
  );
  const [usageMinutes, setUsageMinutes] = useState(() =>
    snapClamp(activeUsageMin, USAGE_MIN_MINUTES, USAGE_MAX_MINUTES, USAGE_STEP),
  );
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  // 기존 예약 원본 — 값이 그대로인 재저장 시 발효일을 보존하기 위해 들고 있는다(리뷰 반영).
  const pendingRef = useRef<{
    userId?: string | null;
    dailyFocusTimeGoalMinutes?: number;
    dailyScreenTimeGoalMinutes?: number;
    effectiveDate?: string;
  } | null>(null);

  // 발효 전 예약(goalPending)이 있으면 그 값으로 피커 초기화.
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEYS.goalPending)
      .then((raw) => {
        if (raw) {
          try {
            const p = JSON.parse(raw) as NonNullable<typeof pendingRef.current>;
            pendingRef.current = p;
            if (typeof p.dailyFocusTimeGoalMinutes === 'number') {
              setFocusMinutes(
                snapClamp(
                  p.dailyFocusTimeGoalMinutes,
                  FOCUS_MIN_MINUTES,
                  FOCUS_MAX_MINUTES,
                  FOCUS_STEP,
                ),
              );
            }
            if (typeof p.dailyScreenTimeGoalMinutes === 'number') {
              setUsageMinutes(
                snapClamp(
                  p.dailyScreenTimeGoalMinutes,
                  USAGE_MIN_MINUTES,
                  USAGE_MAX_MINUTES,
                  USAGE_STEP,
                ),
              );
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
        const next = {
          ...(focusChanged ? { dailyFocusTimeGoalMinutes: focusMinutes } : {}),
          ...(usageChanged ? { dailyScreenTimeGoalMinutes: usageMinutes } : {}),
        };
        // 기존 예약과 값이 그대로면 발효일 보존(리뷰 반영) — 발효일이 지났는데 서버 반영이
        // 실패해 예약이 남은 상태에서 그대로 재저장하면, 내일로 도장을 다시 찍어 이미 due인
        // 재시도가 하루 밀린다. 실제로 값을 고친 경우에만 '내일부터'가 새로 시작된다.
        const prev = pendingRef.current;
        const sameAsPending =
          prev != null &&
          (!prev.userId || prev.userId === userId) &&
          prev.dailyFocusTimeGoalMinutes === next.dailyFocusTimeGoalMinutes &&
          prev.dailyScreenTimeGoalMinutes === next.dailyScreenTimeGoalMinutes;
        await AsyncStorage.setItem(
          STORAGE_KEYS.goalPending,
          JSON.stringify({
            userId,
            ...next,
            effectiveDate:
              sameAsPending && prev.effectiveDate ? prev.effectiveDate : toISODate(tomorrow),
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
        sub="채우기"
        min={FOCUS_MIN_MINUTES}
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
        sub="넘지 않기"
        min={USAGE_MIN_MINUTES}
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
    paddingHorizontal: T.space.lg,
    paddingTop: T.space.lg,
    paddingBottom: T.space.xl,
    marginTop: T.space.lg,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: T.space.md },
  cardIcon: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardLabel: { ...T.text.label, color: T.ink },
  cardSub: { ...T.text.caption, color: T.inkMuted, marginTop: 2 },

  // 피커 + 값 대비 표시
  pickerArea: { alignSelf: 'stretch', marginTop: T.space.md },
  fromText: {
    ...T.text.caption,
    fontWeight: '500',
    color: T.inkMuted,
    textAlign: 'center',
    marginTop: T.space.sm,
  },

  // 안내 박스
  note: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: T.space.sm,
    backgroundColor: T.noteBg,
    borderWidth: 1,
    borderColor: T.noteBorder,
    borderRadius: 14,
    paddingVertical: T.space.md,
    paddingHorizontal: T.space.lg,
    marginTop: T.space.xl,
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
