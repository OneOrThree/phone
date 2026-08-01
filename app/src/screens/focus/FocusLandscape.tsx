// 가로 집중 화면(GROMO-973) — 산만한 요소를 걷어내고 플립 시계만 크게 보는 컴팩트 뷰.
// 좌상단 회전 버튼(→세로), 위 과목명(휴식이면 '휴식'), 가운데 플립 시계.
// 뽀모도로는 아래에 '세트 N/M'과 진행 점을 얹는다. 일시정지·정지는 없다(세로에서 조작).
import { View, Text, StyleSheet, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { PressableScale } from '@/components/PressableScale';
import { T, withAlpha } from '@/constants/theme';
import type { FocusTimerMode } from './types';
import { FlipClock } from './FlipClock';

interface Props {
  mode: FocusTimerMode;
  format: 'hhmmss' | 'mmss'; // 1시간 이상이면 hhmmss, 분 단위면 mmss (호출부에서 세션 길이로 판정)
  displaySeconds: number; // countup=경과 / countdown=남음 / pomodoro=현 페이즈 남음
  phase: 'focus' | 'break';
  setIndex: number;
  sets: number;
  subjectName: string;
  onRotatePortrait: () => void;
}

export function FocusLandscape({
  mode,
  format,
  displaySeconds,
  phase,
  setIndex,
  sets,
  subjectName,
  onRotatePortrait,
}: Props) {
  const { width, height } = useWindowDimensions();
  const isPomodoro = mode === 'pomodoro';
  // 화면 폭·높이에 맞춰 카드 크기 산정(6자리는 더 좁게). 가용 폭 82%·높이 42% 안에 들어오게.
  const widthFactor = format === 'mmss' ? 3.4 : 5.2;
  const sizeByWidth = Math.floor((width * 0.82) / widthFactor);
  const sizeByHeight = Math.floor(height * 0.42);
  const size = Math.max(56, Math.min(format === 'mmss' ? 172 : 132, sizeByWidth, sizeByHeight));

  const label = isPomodoro && phase === 'break' ? '휴식' : subjectName;

  return (
    <View style={s.root}>
      <LinearGradient colors={[T.night.top, T.night.bottom]} style={StyleSheet.absoluteFill} />
      <SafeAreaView style={s.flex1} edges={['top', 'bottom', 'left', 'right']}>
        {/* 좌상단 회전 버튼 — 세로로 복귀 */}
        <PressableScale
          style={s.rotateBtn}
          scaleTo={0.9}
          haptic="light"
          accessibilityLabel="세로 화면으로 전환"
          onPress={onRotatePortrait}
        >
          <Ionicons name="phone-portrait-outline" size={20} color={T.paperLight} />
        </PressableScale>

        {/* 위: 과목명(휴식이면 '휴식') */}
        <Text style={s.subject} numberOfLines={1}>
          {label}
        </Text>

        {/* 가운데: 플립 시계(화면 정중앙) */}
        <View style={s.clockCenter} pointerEvents="none">
          <FlipClock seconds={displaySeconds} format={format} size={size} />
        </View>

        {/* 아래: 뽀모도로 세트 + 진행 점 */}
        {isPomodoro && (
          <View style={s.foot} pointerEvents="none">
            <View style={s.setBadge}>
              <View style={s.setBadgeDot} />
              <Text style={s.setBadgeText}>
                세트 {setIndex} / {sets}
              </Text>
            </View>
            <View style={s.setDots}>
              {Array.from({ length: sets }).map((_, i) => (
                <View key={i} style={[s.setDot, i < setIndex && s.setDotOn]} />
              ))}
            </View>
          </View>
        )}
      </SafeAreaView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.night.bottom },
  flex1: { flex: 1 },
  rotateBtn: {
    position: 'absolute',
    top: T.space.md,
    left: T.space.lg,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: withAlpha(T.white, 0.1),
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 5,
  },
  subject: {
    position: 'absolute',
    top: T.space.lg,
    left: 0,
    right: 0,
    textAlign: 'center',
    ...T.text.subtitle,
    color: T.night.cream,
  },
  clockCenter: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  foot: {
    position: 'absolute',
    bottom: T.space.lg,
    left: 0,
    right: 0,
    alignItems: 'center',
    gap: T.space.sm,
  },
  setBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space.xs,
    backgroundColor: withAlpha(T.accent, 0.16),
    borderWidth: 1,
    borderColor: withAlpha(T.accent, 0.32),
    borderRadius: 99,
    paddingVertical: T.space.xs,
    paddingHorizontal: T.space.md,
  },
  setBadgeDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: T.night.gold },
  setBadgeText: { ...T.text.caption, fontWeight: '700', color: T.night.gold },
  setDots: { flexDirection: 'row', gap: T.space.sm },
  setDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: withAlpha(T.night.cream, 0.22) },
  setDotOn: { backgroundColor: T.night.gold },
});
