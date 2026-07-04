import type { ReactNode } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { T } from '@/constants/theme';
import { useOnboardingProgress } from '@/v2/screens/onboarding/components/OnboardingProgressContext';

// 온보딩 스텝 공통 레이아웃 — 상단 진행바 + 제목/부제 + 본문(children) + 하단 풀폭 CTA(+선택적 보조 액션).
// header: 제목 위 영역(히어로 일러스트 등). center: 본문 세로 가운데 + 텍스트 가운데(히어로형 화면).
// 진행바: OnboardingProgressContext가 있으면(=온보딩 플로우 내) current/total로 상단에 공통 표시.
interface StepScaffoldProps {
  title: string;
  subtitle?: string;
  header?: ReactNode;
  center?: boolean;
  titleCenter?: boolean; // 제목/부제만 가운데 정렬(세로 중앙 정렬 없이)
  children?: ReactNode;
  ctaLabel: string;
  onCta: () => void;
  ctaDisabled?: boolean;
  secondaryLabel?: string;
  onSecondary?: () => void;
  onBack?: () => void;
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
  secondaryLabel,
  onSecondary,
  onBack,
}: StepScaffoldProps) {
  const progress = useOnboardingProgress();
  return (
    <SafeAreaView style={s.root}>
      {onBack ? (
        <TouchableOpacity
          onPress={onBack}
          style={s.back}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Text style={s.backText}>‹</Text>
        </TouchableOpacity>
      ) : null}

      {progress ? (
        <View style={[s.progress, onBack ? s.progressInset : null]}>
          <View style={s.progressTrack}>
            <View
              style={[
                s.progressFill,
                {
                  width: `${(Math.min(progress.current + 1, progress.total) / progress.total) * 100}%`,
                },
              ]}
            />
          </View>
        </View>
      ) : null}

      <ScrollView
        contentContainerStyle={[s.body, center ? s.bodyCenter : null]}
        showsVerticalScrollIndicator={false}
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
          disabled={ctaDisabled}
          onPress={onCta}
          style={[s.cta, ctaDisabled ? s.ctaDisabled : null]}
        >
          <Text style={s.ctaText}>{ctaLabel}</Text>
        </TouchableOpacity>
        {secondaryLabel ? (
          <TouchableOpacity onPress={onSecondary} style={s.secondary}>
            <Text style={s.secondaryText}>{secondaryLabel}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.paper },
  back: { position: 'absolute', top: 6, left: 10, zIndex: 10, padding: 8 },
  backText: { fontSize: 30, lineHeight: 30, color: T.ink }, // ‹ 글리프 — 아이콘 대용(타이포 스케일 밖)
  progress: { paddingTop: 16, paddingBottom: 4, paddingHorizontal: 26 },
  progressInset: { paddingLeft: 46 }, // 뒤로가기 셰브론 피하기
  progressTrack: { height: 4, borderRadius: 2, backgroundColor: T.caramel, overflow: 'hidden' },
  progressFill: { height: 4, borderRadius: 2, backgroundColor: T.accent },
  body: { flexGrow: 1, paddingHorizontal: 26, paddingTop: 28 },
  bodyCenter: { justifyContent: 'center', alignItems: 'center', paddingBottom: 28 },
  header: { alignSelf: 'stretch', alignItems: 'flex-start', marginBottom: 18 },
  headerCenter: { alignItems: 'center', marginBottom: 22 },
  title: { color: T.ink },
  centerText: { textAlign: 'center' },
  subtitle: { color: T.inkSub, marginTop: 8 },
  content: { flex: 1, marginTop: 20 },
  // alignSelf:stretch로 가로를 채워야 안쪽 alignSelf:stretch 자식(카드 등)이 풀폭이 된다.
  // (부모가 bodyCenter의 alignItems:center라 stretch 없으면 콘텐츠 폭으로 쭈그러듦)
  contentCenter: { marginTop: 18, alignItems: 'center', alignSelf: 'stretch' },
  footer: { paddingHorizontal: 22, paddingBottom: 22, paddingTop: 8 },
  cta: {
    height: 56,
    borderRadius: 18,
    backgroundColor: T.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaDisabled: { opacity: 0.45 },
  ctaText: { ...T.text.subtitle, color: T.white },
  secondary: { alignItems: 'center', marginTop: 14 },
  secondaryText: { ...T.text.label, color: T.inkMuted },
});
