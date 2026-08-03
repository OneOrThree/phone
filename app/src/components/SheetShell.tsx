import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  Keyboard,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { T, withAlpha } from '@/constants/theme';

// 바텀시트 공용 껍데기(03/04/05) — 딤 + 하단 흰 패널.
// 닫기: ① 딤 탭 ② 상단 그랩바를 잡고 아래로 끌기(pull-down). 둘 다 onClose를 부른다.
// 키보드: iOS에서 키보드가 뜨면 패널을 그 높이만큼 위로 띄워 입력/버튼이 가리지 않게 한다
//         (공지·찾기 시트의 입력 가림 해소).
//
// ⚠️ 탭 화면(홈·리그·그룹·전체) 안에서 쓸 때는 반드시 asModal을 켠다.
//    기본형은 화면 트리 안에 그리는 absoluteFill View인데, 플로팅 탭바는
//    BottomTabView가 화면 컨테이너 **다음에** 렌더하므로 시트가 항상 탭바·FAB 아래에 깔린다.
//    asModal은 같은 트리를 RN Modal로 한 겹 올려 탭바 위로 띄운다.
//    스택 화면(settings·focus·공지)은 탭바가 없으므로 기본형 그대로 쓴다.
export function SheetShell({
  children,
  onClose,
  asModal = false,
  dismissible = true,
}: {
  children: ReactNode;
  onClose: () => void;
  asModal?: boolean;
  // false면(예: 저장 요청 중) 그랩바 드래그가 임계치를 넘어도 닫지 않고 제자리로 되돌린다 —
  // onClose가 no-op으로 막힌 시트에서 패널만 화면 밖으로 밀려 박제되는 회귀 방지.
  dismissible?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  // onClose는 사용처마다 새 함수라(제출 중 무력화 등) PanResponder 클로저가 stale해지지 않게
  // ref로 최신값을 읽는다.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // PanResponder는 한 번만 생성돼 클로저가 stale하므로 dismissible도 ref로 최신값을 읽는다.
  const dismissibleRef = useRef(dismissible);
  dismissibleRef.current = dismissible;

  // 드래그 이동량 — 그랩바를 아래로 끄는 동안 패널을 그만큼 내린다(네이티브 드라이버 transform).
  const translateY = useRef(new Animated.Value(0)).current;

  // 키보드 높이 추적(iOS만) — 안드로이드는 windowSoftInputMode가 처리하므로 건드리지 않는다.
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    const showSub = Keyboard.addListener('keyboardWillShow', (e) =>
      setKeyboardHeight(e.endCoordinates.height),
    );
    const hideSub = Keyboard.addListener('keyboardWillHide', () => setKeyboardHeight(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const pan = useRef(
    PanResponder.create({
      // 아래로(세로 우세) 끌기 시작할 때만 응답을 가져간다 — 시트 안 스크롤/입력과 충돌하지 않게
      // 그랩바 영역에만 붙인다.
      onMoveShouldSetPanResponder: (_, g) => g.dy > 4 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_, g) => {
        if (g.dy > 0) translateY.setValue(g.dy);
      },
      onPanResponderRelease: (_, g) => {
        // dismissible=false(예: 저장 중)면 임계치와 무관하게 항상 제자리로 되돌린다 — 화면 밖으로
        // 밀어낸 뒤 no-op onClose로 언마운트되지 않아 시트가 박제되는 회귀를 막는다(리뷰 반영).
        if (dismissibleRef.current && (g.dy > 90 || g.vy > 1.2)) {
          Animated.timing(translateY, {
            toValue: 700,
            duration: 180,
            useNativeDriver: true,
          }).start(() => onCloseRef.current());
        } else {
          Animated.spring(translateY, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start();
        }
      },
    }),
  ).current;

  const body = (
    <View style={StyleSheet.absoluteFill}>
      <Pressable style={s.dim} onPress={onClose} />
      <Animated.View
        style={[
          s.panel,
          {
            bottom: keyboardHeight,
            paddingBottom: keyboardHeight > 0 ? T.space.lg : insets.bottom + 20,
            transform: [{ translateY }],
          },
        ]}
      >
        {/* 상단 그랩바 — 잡고 아래로 끌면 닫힌다(뒤로가기가 없는 시트의 명시적 닫기 수단) */}
        <View {...pan.panHandlers} style={s.grabArea} accessibilityLabel="아래로 끌어 닫기">
          <View style={s.grabber} />
        </View>
        {children}
      </Animated.View>
    </View>
  );

  // 기본값은 기존 렌더 그대로 — settings·focus 사용처가 트리 구조는 그대로다.
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
    paddingTop: T.space.sm,
    shadowColor: T.shadow,
    shadowOpacity: 0.22,
    shadowRadius: 40,
    shadowOffset: { width: 0, height: -14 },
    elevation: 20,
  },
  // 그랩바 — 상단 중앙 손잡이. 이 영역에만 PanResponder를 붙여 시트 내용과 충돌을 피한다.
  grabArea: { alignItems: 'center', paddingTop: 2, paddingBottom: T.space.md },
  grabber: { width: 40, height: 5, borderRadius: 3, backgroundColor: T.border },
});
