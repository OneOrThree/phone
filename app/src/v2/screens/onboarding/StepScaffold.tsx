import type { ReactNode } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { T } from '@/v2/constants/theme';

// 온보딩 스텝 공통 레이아웃 — 상단 제목/부제 + 본문(children) + 하단 풀폭 CTA(+선택적 보조 액션).
// header: 제목 위 영역(히어로 일러스트 등). center: 본문 세로 가운데 + 텍스트 가운데(히어로형 화면).
// TODO: 상단 단계 진행바(N/총단계) — OnboardingFlow에서 current/total 내려주면 공통 표시.
interface StepScaffoldProps {
  title: string;
  subtitle?: string;
  header?: ReactNode;
  center?: boolean;
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
  children,
  ctaLabel,
  onCta,
  ctaDisabled,
  secondaryLabel,
  onSecondary,
  onBack,
}: StepScaffoldProps) {
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

      <ScrollView
        contentContainerStyle={[s.body, center ? s.bodyCenter : null]}
        showsVerticalScrollIndicator={false}
      >
        {header ? <View style={s.header}>{header}</View> : null}
        <Text style={[T.text.title, s.title, center ? s.centerText : null]}>{title}</Text>
        {subtitle ? (
          <Text style={[T.text.body, s.subtitle, center ? s.centerText : null]}>{subtitle}</Text>
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
  backText: { fontSize: 30, lineHeight: 30, color: T.ink },
  body: { flexGrow: 1, paddingHorizontal: 26, paddingTop: 28 },
  bodyCenter: { justifyContent: 'center', alignItems: 'center', paddingBottom: 28 },
  header: { alignItems: 'center', marginBottom: 22 },
  title: { color: T.ink },
  centerText: { textAlign: 'center' },
  subtitle: { color: T.inkSub, marginTop: 8 },
  content: { flex: 1, marginTop: 20 },
  contentCenter: { marginTop: 18, alignItems: 'center' },
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
