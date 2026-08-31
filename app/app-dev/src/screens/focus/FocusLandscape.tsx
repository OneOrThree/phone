// 가로 집중 화면(GROMO-973) — 산만한 요소를 걷어내고 플립 시계만 크게 보는 컴팩트 뷰.
// 우상단 회전 버튼(→세로), 위 과목명(휴식이면 '휴식'), 가운데 플립 시계, 우하단 캐릭터.
// 뽀모도로는 아래에 '세트 N/M'과 진행 점을 얹는다. 일시정지·정지는 없다(세로에서 조작).
import { View, Text, StyleSheet, useWindowDimensions } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { PressableScale } from '@/components/PressableScale';
import { CharacterImage } from '@/components/character/CharacterImage';
import { useCharacter } from '@/store/CharacterContext';
import { T, withAlpha } from '@/constants/theme';
import { t } from '@/i18n';
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
  const insets = useSafeAreaInsets();
  const { activeSource } = useCharacter();
  const isPomodoro = mode === 'pomodoro';

  // 카드 크기 산정(GROMO-1075: 확대) — 노치/홈 인디케이터를 뺀 '실제로 쓸 수 있는' 폭·높이 기준.
  // widthFactor = 시계 전체 폭 ÷ 카드 한 장 크기(자리 6개+콜론 2개 ≈ 4.5배, 4개+콜론 1개 ≈ 2.93배)에
  // 폰트 실측 오차용 여유를 얹은 값. 여기에 가용 폭의 94%·높이 55%를 상한으로 건다.
  // 높이 55%는 위 과목명(≈38pt)·아래 뽀모도로 세트 영역(≈57pt)과 겹치지 않는 최대치다
  // (중앙 정렬이라 반높이 27.5% ≤ 절반−57 이어야 하고, 이는 가용 높이 254pt 이상이면 성립).
  const widthFactor = format === 'mmss' ? 3.15 : 4.8;
  const availW = Math.max(1, width - insets.left - insets.right);
  const availH = Math.max(1, height - insets.top - insets.bottom);
  const sizeByWidth = Math.floor((availW * 0.94) / widthFactor);
  const sizeByHeight = Math.floor(availH * 0.55);
  const size = Math.max(56, Math.min(format === 'mmss' ? 220 : 180, sizeByWidth, sizeByHeight));

  // 우하단 캐릭터 — 가운데 시계 아래로 남는 높이 안에만 들어가게 잡아 시계와 겹치지 않는다.
  // (시계는 화면 정중앙이므로 시계 아래 여백 = 가용 높이 절반 − 카드 반높이.)
  // 빼는 값은 바닥 여백(md) + 시계와의 간격(md).
  const charSize = Math.max(56, Math.min(120, Math.floor(availH / 2 - size / 2 - T.space.md * 2)));

  const label = isPomodoro && phase === 'break' ? t('focus.session.break') : subjectName;

  return (
    <View style={s.root}>
      <LinearGradient colors={[T.night.top, T.night.bottom]} style={StyleSheet.absoluteFill} />
      <SafeAreaView style={s.flex1} edges={['top', 'bottom', 'left', 'right']}>
        {/* 우상단 회전 버튼 — 세로로 복귀(GROMO-1075).
            노치/다이나믹 아일랜드는 기기를 어느 쪽으로 눕히느냐에 따라 좌·우가 바뀌므로
            절대좌표로 우측에 붙이지 않고, SafeAreaView(left/right)가 만든 안전 영역 안에서
            일반 플로우 행으로 오른쪽 정렬한다 — 어느 방향으로 눕혀도 노치 밑에 들어가지 않는다. */}
        <View style={s.topRow}>
          <PressableScale
            style={s.rotateBtn}
            scaleTo={0.9}
            haptic="light"
            accessibilityLabel={t('focus.session.toPortrait')}
            onPress={onRotatePortrait}
          >
            <Ionicons name="phone-portrait-outline" size={20} color={T.paperLight} />
          </PressableScale>
        </View>

        {/* 우하단: 캐릭터 — 세로 화면과 같은 컴포넌트·같은 소스(누끼 캐릭터가 있으면 그것).
            회전 버튼과 같은 이유로 절대좌표가 아니라 일반 플로우(marginTop:auto로 바닥에 붙임)다. */}
        <View style={s.bottomRow} pointerEvents="none">
          <CharacterImage size={charSize} variant="study" sourceUri={activeSource ?? undefined} />
        </View>

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
                {t('focus.session.setProgress', { current: setIndex, total: sets })}
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
  topRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingTop: T.space.md,
    paddingHorizontal: T.space.lg,
    zIndex: 5,
  },
  rotateBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: withAlpha(T.white, 0.1),
    alignItems: 'center',
    justifyContent: 'center',
  },
  subject: {
    position: 'absolute',
    top: T.space.lg,
    left: 0,
    right: 0,
    // 회전 버튼(36 + 여백)과 겹치지 않게 좌우를 비워 둔다 — 긴 과목명은 가운데에서 말줄임된다.
    paddingHorizontal: 68,
    textAlign: 'center',
    ...T.text.subtitle,
    color: T.night.cream,
  },
  bottomRow: {
    marginTop: 'auto', // 남는 세로 공간을 전부 위로 밀어 캐릭터를 안전 영역 바닥에 붙인다
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: T.space.md,
    paddingBottom: T.space.md,
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
