import type { ReactNode } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
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
}

export default function SettingsScaffold({
  title,
  onBack,
  children,
  footer,
  scroll = true,
}: SettingsScaffoldProps) {
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
        <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>
          {children}
        </ScrollView>
      ) : (
        <View style={[s.body, s.flex1]}>{children}</View>
      )}

      {footer ? <View style={s.footer}>{footer}</View> : null}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.paperLight },
  flex1: { flex: 1 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingTop: 4,
    paddingBottom: 10,
  },
  back: { padding: 4 },
  title: { ...T.text.heading, color: T.ink },
  body: { paddingHorizontal: 18, paddingTop: 6, paddingBottom: 32 },
  footer: { paddingHorizontal: 18, paddingBottom: 18, paddingTop: 8 },
});
