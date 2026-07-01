import { type ReactNode } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { T } from '@/v2/constants/theme';

// 바텀시트 공용 껍데기(03/04/05) — 딤 + 하단 흰 패널. 딤 탭 시 닫힘.
export function SheetShell({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={StyleSheet.absoluteFill}>
      <Pressable style={s.dim} onPress={onClose} />
      <View style={[s.panel, { paddingBottom: insets.bottom + 20 }]}>{children}</View>
    </View>
  );
}

const s = StyleSheet.create({
  dim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(20,14,9,0.42)' },
  panel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: T.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 18,
    paddingTop: 16,
    shadowColor: '#141428',
    shadowOpacity: 0.22,
    shadowRadius: 40,
    shadowOffset: { width: 0, height: -14 },
    elevation: 20,
  },
});
