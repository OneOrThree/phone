import { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated from 'react-native-reanimated';
import { T } from '@/constants/theme';
import type { FocusTimerMode } from '../types';
import { SheetShell } from '@/components/SheetShell';
import { SLIDE_MS, glassSlide, glassPill } from '@/components/liquidGlass';
import { useMotion } from '@/hooks/useMotion';

// 03 타이머 방식 — 카운트업/카운트다운/뽀모도로 중 선택.
const OPTIONS: {
  mode: FocusTimerMode;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  desc: string;
}[] = [
  { mode: 'countup', icon: 'arrow-up', title: '카운트업', desc: '0부터 시간을 쌓아요' },
  { mode: 'countdown', icon: 'arrow-down', title: '카운트다운', desc: '목표 시간부터 줄어들어요' },
  { mode: 'pomodoro', icon: 'timer-outline', title: '뽀모도로', desc: '집중·휴식을 반복해요' },
];

// GROMO-848 리퀴드 글래스 선택 연출(./liquidGlass) — 누르면 유리 알약이
// 누른 행으로 미끄러진 뒤(SLIDE_MS) 다음 단계로 진행한다.

export function TimerMethodSheet({
  subjectName,
  onSelect,
  onClose,
}: {
  subjectName: string;
  onSelect: (mode: FocusTimerMode) => void;
  onClose: () => void;
}) {
  // 알약을 누른 행 위로 보내기 위한 행별 y/높이 측정값
  const [rowRects, setRowRects] = useState<
    Partial<Record<FocusTimerMode, { y: number; h: number }>>
  >({});
  const [picked, setPicked] = useState<FocusTimerMode | null>(null);
  const proceedRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // '동작 줄이기'면 알약이 미끄러지지 않고 누른 행에 즉시 나타난다(위치·표시 여부는 그대로).
  // ⚠️ 아래 진행 타이머(SLIDE_MS + 60)는 손대지 않는다 — 세션 시작 흐름의 계약이다.
  const m = useMotion();

  // 딤 탭 등으로 시트가 닫히면 예약된 진행을 취소 (늦은 onSelect 방지)
  useEffect(
    () => () => {
      if (proceedRef.current) clearTimeout(proceedRef.current);
    },
    [],
  );

  const pick = (mode: FocusTimerMode) => {
    if (picked) return; // 슬라이드 중 중복 탭 방지
    if (!rowRects[mode]) {
      onSelect(mode); // 측정 전 탭 — 연출 생략하고 바로 진행
      return;
    }
    setPicked(mode);
    // 이 대기는 알약이 미끄러지는 걸 보여주기 위한 시간이다 — reduce면 알약이 이미 제자리에
    // 놓이므로 기다릴 연출이 없다. m.delay는 0을 돌려줄 뿐 setTimeout은 남으므로 진행은 완주한다.
    proceedRef.current = setTimeout(() => onSelect(mode), m.delay(SLIDE_MS + 60));
  };

  // 대기 위치는 첫 행 — 누르면 그 자리에서 누른 행으로 미끄러지며 나타난다
  const glassRect = (picked && rowRects[picked]) || rowRects.countup;

  return (
    <SheetShell onClose={onClose}>
      <Text style={s.title}>{subjectName} · 타이머 방식</Text>
      <Text style={s.sub}>어떻게 집중할지 골라요.</Text>
      <View style={s.list}>
        {OPTIONS.map((o) => (
          <TouchableOpacity
            key={o.mode}
            // Maestro E2E — 대본이 쓰는 카운트업 옵션만 식별(GROMO-947)
            testID={o.mode === 'countup' ? 'focus.mode.countup' : undefined}
            style={s.row}
            activeOpacity={0.8}
            onPress={() => pick(o.mode)}
            onLayout={(e) => {
              const { y, height } = e.nativeEvent.layout;
              setRowRects((prev) => ({ ...prev, [o.mode]: { y, h: height } }));
            }}
          >
            <View style={s.iconBox}>
              <Ionicons name={o.icon} size={22} color={T.accent} />
            </View>
            <View style={s.flex1}>
              <Text style={s.rowTitle}>{o.title}</Text>
              <Text style={s.rowDesc}>{o.desc}</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={T.inkMuted} />
          </TouchableOpacity>
        ))}
        {glassRect && (
          <Animated.View
            pointerEvents="none"
            style={[
              s.glass,
              glassPill,
              picked ? s.glassShown : s.glassHidden,
              {
                height: glassRect.h,
                transform: [{ translateY: glassRect.y }],
              },
              m.css(glassSlide),
            ]}
          />
        )}
      </View>
    </SheetShell>
  );
}

const s = StyleSheet.create({
  title: { ...T.text.body, fontWeight: '800', color: T.ink },
  sub: {
    ...T.text.label,
    fontWeight: '500',
    color: T.inkMuted,
    marginTop: 2,
    marginBottom: T.space.md,
  },
  list: { gap: T.space.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space.md,
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.paperAlt,
    borderRadius: 15,
    paddingVertical: T.space.md,
    paddingHorizontal: T.space.lg,
  },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: T.caramel,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flex1: { flex: 1 },
  rowTitle: { ...T.text.label, fontWeight: '700', color: T.ink },
  rowDesc: { ...T.text.caption, fontWeight: '500', color: T.inkMuted, marginTop: 1 },
  // 유리 알약 래퍼 — ⚠️ 글자 위 오버레이라 네이티브 리퀴드 글래스 금지(뒤 글자 블러됨).
  //    반투명 틴트(glassPill)만 사용.
  glass: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    borderRadius: 15,
  },
  glassShown: { opacity: 1 },
  glassHidden: { opacity: 0 },
});
