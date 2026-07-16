import type { ReactNode } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { T } from '@/constants/theme';
import { useOnboardingProgress } from '@/screens/onboarding/components/OnboardingProgressContext';

// 온보딩 스텝 공통 레이아웃 — 상단 진행바 + 제목/부제 + 본문(children) + 하단 풀폭 CTA(+선택적 보조 액션).
// header: 제목 위 영역(히어로 일러스트 등). center: 본문 세로 가운데 + 텍스트 가운데(히어로형 화면).
// 진행바: OnboardingProgressContext가 있으면(=온보딩 플로우 내) current/total로 상단에 공통 표시.
interface StepScaffoldProps {
  title: string;
  subtitle?: ReactNode; // 문자열 또는 일부 강조(<Text>)를 넣기 위한 JSX 허용
  header?: ReactNode;
  center?: boolean;
  titleCenter?: boolean; // 제목/부제만 가운데 정렬(세로 중앙 정렬 없이)
  children?: ReactNode;
  ctaLabel: string;
  onCta: () => void;
  ctaDisabled?: boolean;
  // 로딩 연출 등이 끝날 때까지 CTA를 잠시 감출 때 — 자리는 유지해 레이아웃 튐 방지.
  ctaHidden?: boolean;
  secondaryLabel?: string;
  onSecondary?: () => void;
  // 기본은 스크롤 잠금(전환 시 본문 튐 방지). 콘텐츠가 긴 스텝만 opt-in해 세로 스크롤 허용.
  scrollable?: boolean;
}

export default function StepScaffold({
  title,
  subtitle,
  header,
  center,
  titleCenter,
  children,
  ctaLabel,
  onCta,
  ctaDisabled,
  ctaHidden,
  secondaryLabel,
  onSecondary,
  scrollable,
}: StepScaffoldProps) {
  const progress = useOnboardingProgress();
  // 안전영역 인셋을 동기적으로 읽어 패딩으로 적용 — 네이티브 SafeAreaView는 스텝 remount마다
  // 인셋 적용 전 한 프레임이 생겨 하단 CTA가 튀므로, 첫 프레임부터 확정되는 이 방식을 쓴다.
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        s.root,
        {
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
          paddingLeft: insets.left,
          paddingRight: insets.right,
        },
      ]}
    >
      {progress ? (
        // 페이지별 세그먼트 — 현재 스텝(0-based)까지 채워서 전체 중 몇 번째인지 한눈에 보이게.
        <View style={s.progress}>
          <View style={s.progressRow}>
            {Array.from({ length: progress.total }, (_, i) => (
              <View
                key={i}
                style={[s.progressSeg, i <= progress.current ? s.progressSegOn : null]}
              />
            ))}
          </View>
        </View>
      ) : null}

      <ScrollView
        style={s.scroll}
        contentContainerStyle={[s.body, center ? s.bodyCenter : null]}
        showsVerticalScrollIndicator={false}
        scrollEnabled={!!scrollable}
      >
        {header ? <View style={[s.header, center ? s.headerCenter : null]}>{header}</View> : null}
        <Text style={[T.text.title, s.title, center || titleCenter ? s.centerText : null]}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={[T.text.body, s.subtitle, center || titleCenter ? s.centerText : null]}>
            {subtitle}
          </Text>
        ) : null}
        {children ? <View style={center ? s.contentCenter : s.content}>{children}</View> : null}
      </ScrollView>

      <View style={s.footer}>
        <TouchableOpacity
          activeOpacity={0.85}
          disabled={ctaDisabled || ctaHidden}
          onPress={onCta}
          style={[s.cta, ctaDisabled ? s.ctaDisabled : null, ctaHidden ? s.ctaHidden : null]}
        >
          <Text style={s.ctaText}>{ctaLabel}</Text>
        </TouchableOpacity>
        {/* 보조 액션 자리 — 라벨이 없어도 높이를 고정 예약해 CTA 위치를 전 화면 동일하게 유지. */}
        <View style={s.secondarySlot}>
          {secondaryLabel ? (
            <TouchableOpacity
              onPress={onSecondary}
              hitSlop={{ top: 14, bottom: 14, left: 20, right: 20 }}
            >
              <Text style={s.secondaryText}>{secondaryLabel}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.paper },
  // 본문 영역을 화면에 고정(flex:1). 기본은 세로 스크롤 잠금 — 본문 높이가 바뀌어도 화면이
  // 세로로 고정된다(하단 CTA는 ScrollView 밖 형제라 항상 하단 고정). 콘텐츠가 긴 스텝은
  // scrollable prop으로 스크롤을 켜 작은 기기에서 하단 잘림을 방지한다(가로 스와이프 뒤로가기 유지).
  scroll: { flex: 1 },
  progress: { paddingTop: T.space.lg, paddingBottom: T.space.xs, paddingHorizontal: T.space.xxl },
  progressRow: { flexDirection: 'row', gap: 6 },
  progressSeg: { flex: 1, height: 4, borderRadius: 2, backgroundColor: T.caramel },
  progressSegOn: { backgroundColor: T.accent },
  body: { flexGrow: 1, paddingHorizontal: T.space.xxl, paddingTop: 28 },
  bodyCenter: { justifyContent: 'center', alignItems: 'center', paddingBottom: 28 },
  header: { alignSelf: 'stretch', alignItems: 'flex-start', marginBottom: T.space.xl },
  headerCenter: { alignItems: 'center', marginBottom: T.space.xxl },
  title: { color: T.ink },
  centerText: { textAlign: 'center' },
  subtitle: { color: T.inkSub, marginTop: T.space.sm },
  content: { flex: 1, marginTop: T.space.xl },
  // alignSelf:stretch로 가로를 채워야 안쪽 alignSelf:stretch 자식(카드 등)이 풀폭이 된다.
  // (부모가 bodyCenter의 alignItems:center라 stretch 없으면 콘텐츠 폭으로 쭈그러듦)
  contentCenter: { marginTop: T.space.xl, alignItems: 'center', alignSelf: 'stretch' },
  footer: { paddingHorizontal: T.space.xxl, paddingBottom: T.space.md, paddingTop: T.space.sm },
  cta: {
    height: 56,
    borderRadius: 18,
    backgroundColor: T.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaDisabled: { opacity: 0.45 },
  ctaHidden: { opacity: 0 },
  ctaText: { ...T.text.subtitle, color: T.white },
  secondarySlot: {
    height: 22,
    marginTop: T.space.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: { ...T.text.label, color: T.inkMuted },
});
