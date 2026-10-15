// Toast.tsx
// 성공 통보용 경량 배너. `Alert`가 하던 "읽고 흘려도 되는 성공 통보"를 대체한다(정책 D8).
// 큐잉·자동 해제·마운트 지점은 store/ToastContext가 관리하고, 이 파일은 **한 장을 어떻게
// 그리고 어떻게 읽히게 할지**만 책임진다.
//
// ⚠️ 접근성 — 플랫폼당 공지 경로가 **하나여야 한다** (정책 D8).
//    Alert는 스크린리더가 자동으로 읽지만 토스트는 아니다. 그래서 명시적 공지가 필요한데,
//    두 경로를 동시에 걸면 안드로이드에서 같은 문구가 두 번 읽힌다(라이브 리전이 큐에 넣은 걸
//    announceForAccessibility가 한 번 더 넣는다).
//      Android → 여기서 accessibilityLiveRegion="polite" (이 prop은 **안드로이드 전용**이다)
//      iOS     → ToastContext에서 AccessibilityInfo.announceForAccessibility()
//    한쪽만 바꾸면 나머지 플랫폼이 조용히 벙어리가 된다. 두 파일을 같이 고칠 것.
//
// ⚠️ 배치 — 상단이다. 하단이 아니다.
//    Provider는 루트(SafeAreaProvider 바로 안)에 있어 **탭바·FAB·키보드가 지금 떠 있는지 모른다.**
//    하단에 두면 탭바 높이·홈 인디케이터·키보드를 전부 추측해야 하지만, 상단은 safe-area top
//    인셋 하나로 확정된다. 헤더 뒤로가기 버튼을 2.2초 가리는 대신(탭하면 즉시 사라진다)
//    가림 사고가 없는 쪽을 골랐다. iOS 알림 배너와 같은 관행이기도 하다.
//
// ⚠️ RN `Modal`(SheetShell asModal·ConfirmCardModal 등)은 별도 네이티브 윈도에 뜨므로
//    이 배너가 그 **아래**에 깔린다. 시트 안에서 성공을 알려야 하면 시트를 닫은 **뒤** show()를
//    부를 것. (토스트를 Modal로 감싸는 안은 배제했다 — 모달 위에 모달을 얹는 iOS 프레젠테이션
//    경합으로 배너가 안 뜨거나 투명 모달이 남아 터치를 먹는 실패 모드가 더 나쁘다.)

import { useContext, useEffect } from 'react';
import { Platform, Pressable, StyleSheet, Text } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { M } from '@/constants/motion';
import { T } from '@/constants/theme';
import { t } from '@/i18n';
import { useMotion } from '@/hooks/useMotion';

export type ToastTone = 'success' | 'error';

/** useToast().show()가 받는 인자. */
export interface ToastOptions {
  message: string;
  /** 기본 'success'. 'error'는 조치가 필요 없는 단순 실패 통보 전용(확인이 필요하면 Alert를 유지한다). */
  tone?: ToastTone;
  /** 문구 앞에 붙는 이모지 한 글자. 아이콘 폰트가 아니라 텍스트다. */
  icon?: string;
}

export function Toast({
  message,
  tone = 'success',
  icon,
  /** false로 바뀌면 퇴장 애니메이션을 시작한다. 언마운트는 ToastContext가 한다. */
  visible,
  onDismiss,
}: ToastOptions & { visible: boolean; onDismiss: () => void }) {
  const m = useMotion();
  // useSafeAreaInsets()가 아니라 컨텍스트를 직접 읽는다 — 그쪽은 Provider가 없으면 **throw**해서
  // ToastProvider를 감싸는 모든 화면 테스트가 safe-area 목을 강제당한다. 여기선 없으면 0이면 된다.
  const insets = useContext(SafeAreaInsetsContext);
  const progress = useSharedValue(0);

  // 등장은 M.spring.snappy, 퇴장은 M.dur.quick.
  // ⚠️ deps의 `m`이 곧 `m.reduce` 의존이다 — useMotion은 reduce 하나로 useMemo돼 있어
  //    설정이 재생 도중 켜지면 이 이펙트가 다시 돌고 즉시 대입으로 바뀐다(중간 상태 고착 방지).
  useEffect(() => {
    progress.value = visible
      ? m.spring(1, M.spring.snappy)
      : m.timing(0, { duration: M.dur.quick, easing: M.curve.standard.fn });
  }, [visible, m, progress]);

  const animStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * -12 }],
  }));

  // 안드로이드 전용 prop. iOS에선 undefined로 두고 ToastContext의 announce 경로만 쓴다.
  const liveRegion = Platform.OS === 'android' ? ('polite' as const) : undefined;

  return (
    <Animated.View
      // 배너 바깥(헤더·화면 본문)의 터치는 그대로 통과시킨다.
      pointerEvents="box-none"
      style={[s.host, { top: (insets?.top ?? 0) + T.space.sm }, animStyle]}
    >
      {/* testID는 위치잡이 호스트가 아니라 **카드**에 붙인다 — 탭 해제 대상이자
          라이브 리전을 다는 요소가 여기라 셀렉터가 가리키는 곳과 같아야 한다. */}
      <Pressable
        testID="toast"
        onPress={onDismiss}
        accessibilityRole="button"
        accessibilityLabel={message}
        accessibilityHint={t('components.toast.dismissHint')}
        accessibilityLiveRegion={liveRegion}
        style={[s.card, tone === 'error' ? s.cardError : s.cardSuccess]}
      >
        {icon ? <Text style={s.icon}>{icon}</Text> : null}
        <Text testID="toast.message" style={s.message} numberOfLines={2}>
          {message}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  host: {
    position: 'absolute',
    left: T.space.lg,
    right: T.space.lg,
    alignItems: 'center',
    // 형제(화면 본문)보다 확실히 위. 안드로이드는 elevation이 따로 필요하다.
    zIndex: 100,
    elevation: 24,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space.sm,
    maxWidth: '100%',
    paddingVertical: T.space.md,
    paddingHorizontal: T.space.lg,
    borderRadius: 14,
    shadowColor: T.shadow,
    shadowOpacity: 0.24,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
  },
  cardSuccess: { backgroundColor: T.dark },
  cardError: { backgroundColor: T.dangerInk },
  icon: { fontSize: 17 },
  // 흰 글자 고정 — 두 톤 다 어두운 배경이다.
  message: { ...T.text.label, color: T.white, flexShrink: 1 },
});
