import type { ReactNode } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { T } from '@/constants/theme';

// 설정 하위 화면 공통 레이아웃 — 상단 '‹ 제목' 바 + 본문(children) + 선택적 하단 고정 영역(footer).
// 시안 SET·* 하위 화면 공통 골격. 허브(MenuScreen)에서 push 되는 화면들이 이걸 쓴다.
interface SettingsScaffoldProps {
  title: string;
  onBack: () => void;
  children: ReactNode;
  footer?: ReactNode; // 하단 고정 CTA(예: 저장 버튼)
  scroll?: boolean; // 본문 스크롤 여부(기본 true)
  // 본문 콘텐츠를 최소 뷰포트 높이까지 늘림(flexGrow) — flex 스페이서로 하단 고정 요소를
  // 만들 때 사용. 콘텐츠가 넘치면(작은 기기·큰 글씨) 그대로 스크롤된다.
  stretch?: boolean;
}

export default function SettingsScaffold({
  title,
  onBack,
  children,
  footer,
  scroll = true,
  stretch = false,
}: SettingsScaffoldProps) {
  const insets = useSafeAreaInsets();
  return (
    <SafeAreaView style={s.root} edges={['top']}>
      <View style={s.bar}>
        <TouchableOpacity
          onPress={onBack}
          style={s.back}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="chevron-back" size={24} color={T.ink} />
        </TouchableOpacity>
        <Text style={s.title} numberOfLines={1}>
          {title}
        </Text>
      </View>

      {scroll ? (
        <ScrollView
          contentContainerStyle={[s.body, stretch ? s.bodyGrow : null]}
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[s.body, s.flex1]}>{children}</View>
      )}

      {footer ? (
        <View style={[s.footer, { paddingBottom: insets.bottom + 18 }]}>{footer}</View>
      ) : null}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.paperLight },
  flex1: { flex: 1 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space.sm,
    paddingHorizontal: T.space.md,
    paddingTop: T.space.xs,
    paddingBottom: T.space.md,
  },
  back: { padding: T.space.xs },
  title: { ...T.text.heading, color: T.ink },
  body: { paddingHorizontal: T.space.xl, paddingTop: T.space.sm, paddingBottom: 32 },
  bodyGrow: { flexGrow: 1 },
  footer: { paddingHorizontal: T.space.xl, paddingTop: T.space.sm },
});
