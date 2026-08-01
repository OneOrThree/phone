import { type ReactNode } from 'react';
import { Modal, View, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { T, withAlpha } from '@/constants/theme';

// 바텀시트 공용 껍데기(03/04/05) — 딤 + 하단 흰 패널. 딤 탭 시 닫힘.
//
// ⚠️ 탭 화면(홈·리그·그룹·전체) 안에서 쓸 때는 반드시 asModal을 켠다.
//    기본형은 화면 트리 안에 그리는 absoluteFill View인데, 플로팅 탭바는
//    BottomTabView가 화면 컨테이너 **다음에** 렌더하므로 시트가 항상 탭바·FAB 아래에 깔린다
//    (하단 0~98pt가 전폭으로 덮여 시트 하단 버튼이 눌리지 않는다).
//    asModal은 같은 트리를 RN Modal로 한 겹 올려 탭바 위로 띄운다.
//    스택 화면(settings·focus·공지)은 탭바가 없으므로 기본형 그대로 쓴다.
export function SheetShell({
  children,
  onClose,
  asModal = false,
}: {
  children: ReactNode;
  onClose: () => void;
  asModal?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const body = (
    <View style={StyleSheet.absoluteFill}>
      <Pressable style={s.dim} onPress={onClose} />
      <View style={[s.panel, { paddingBottom: insets.bottom + 20 }]}>{children}</View>
    </View>
  );

  // 기본값은 기존 렌더 그대로 — settings·focus 사용처가 한 픽셀도 달라지지 않게 분기 자체를 나눈다.
  if (!asModal) return body;

  // animationType='none' — 기존 시트가 애니메이션 없이 즉시 뜨던 체감을 유지한다.
  return (
    <Modal transparent statusBarTranslucent visible animationType="none" onRequestClose={onClose}>
      {body}
    </Modal>
  );
}

const s = StyleSheet.create({
  dim: { ...StyleSheet.absoluteFill, backgroundColor: withAlpha(T.night.bottom, 0.42) },
  panel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: T.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: T.space.xl,
    paddingTop: T.space.lg,
    shadowColor: T.shadow,
    shadowOpacity: 0.22,
    shadowRadius: 40,
    shadowOffset: { width: 0, height: -14 },
    elevation: 20,
  },
});
