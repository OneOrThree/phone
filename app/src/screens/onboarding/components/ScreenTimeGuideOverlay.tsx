import { useCallback, useRef } from 'react';
import { Modal, View, Text, TouchableOpacity, Animated, StyleSheet } from 'react-native';
import { T, withAlpha } from '@/constants/theme';
import type { SystemColorScheme } from '@/services/ScreenTimeModule';

// 시스템 스크린타임 권한창 리허설 오버레이 (GROMO-934)
// iOS 권한창은 승인('계속')이 왼쪽, 파란 강조 버튼이 오른쪽('허용 안 함')이라 일반 다이얼로그
// 습관대로 파란 버튼을 눌러 거부되는 사고가 잦다. 요청 직전에 실제 창과 같은 위치·외형의
// 복제본을 먼저 보여주고 왼쪽이 승인임을 안내한다. 복제본의 '계속' 탭 = onConfirm(실제 요청
// 트리거) — 진짜 창이 같은 자리에 떠서 손가락 위치 그대로 진짜 '계속'을 누르게 된다.
// '허용 안 함' 쪽 탭은 진행 없이 흔들림으로 "이쪽 아님"만 표현한다.
// 위치·비율은 실기기 스크린샷 실측 — 좌우 여백 각 10%, 카드 상단 = 화면 높이 38% 지점.

// 복제창 외형 — 시스템 창을 그대로 흉내내는 색이라 앱 팔레트(T)를 따르지 않는다.
// scheme은 기기 설정 기준(getSystemColorScheme) — 앱은 라이트 고정이지만 시스템 창은
// 기기 다크모드를 따르므로 복제본도 같은 기준으로 분기한다.
const ALERT_COLORS = {
  dark: {
    card: '#3A3A3E',
    title: '#FFFFFF',
    body: '#AEAEB4',
    continueBg: '#58585D',
    continueText: '#FFFFFF',
    denyBg: '#4BA1FF',
    ring: T.accentLight, // 어두운 카드 위에서 보이는 밝은 인디고
    okLabel: T.accentLight,
    noLabel: '#FF9C8A',
  },
  light: {
    card: '#F2F2F7',
    title: '#000000',
    body: '#6C6C70',
    continueBg: '#E9E9EB',
    continueText: '#000000',
    denyBg: '#007AFF',
    ring: T.accent,
    okLabel: T.accentDeep,
    noLabel: T.dangerInk,
  },
} as const;

// 모달 '해제 완료'를 기다리는 훅 — setVisible(false)는 해제를 예약할 뿐이라, 곧바로 네이티브
// picker를 띄우면 해제 중인 모달 위에서 present돼 picker가 유실될 수 있다(코드리뷰 P1).
// hideAndWait()는 Modal onDismiss까지 대기하고, 콜백이 안 오는 이상 상황엔 800ms 폴백으로
// 풀어 온보딩이 멈추지 않게 한다. onDismissed는 오버레이의 onDismissed prop에 연결한다.
export function useGuideDismissal(setVisible: (visible: boolean) => void) {
  const resolverRef = useRef<(() => void) | null>(null);
  const onDismissed = useCallback(() => {
    resolverRef.current?.();
    resolverRef.current = null;
  }, []);
  const hideAndWait = useCallback(
    () =>
      new Promise<void>((resolve) => {
        resolverRef.current = resolve;
        setVisible(false);
        setTimeout(() => {
          if (resolverRef.current === resolve) {
            resolverRef.current = null;
            resolve();
          }
        }, 800);
      }),
    [setVisible],
  );
  return { onDismissed, hideAndWait };
}

interface Props {
  visible: boolean;
  scheme: SystemColorScheme;
  // 실제 권한 요청 진행 중 — 시스템 창이 같은 자리에 뜨므로 복제본·안내를 숨기고 딤만 유지.
  requesting: boolean;
  // 복제본 '계속' 탭 — 실제 권한 요청을 이어간다.
  onConfirm: () => void;
  // Modal 해제 완료 콜백(iOS) — useGuideDismissal의 onDismissed를 연결.
  onDismissed?: () => void;
}

export default function ScreenTimeGuideOverlay({
  visible,
  scheme,
  requesting,
  onConfirm,
  onDismissed,
}: Props) {
  const c = ALERT_COLORS[scheme];
  // '허용 안 함'(오답) 탭 → 좌우 흔들림 (진행 없음)
  const shakeX = useRef(new Animated.Value(0)).current;
  const shakeDeny = () => {
    shakeX.setValue(0);
    Animated.sequence(
      [8, -8, 6, -6, 3, 0].map((to) =>
        Animated.timing(shakeX, { toValue: to, duration: 50, useNativeDriver: true }),
      ),
    ).start();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => {}}
      onDismiss={onDismissed}
    >
      <View style={s.dim}>
        {requesting ? null : (
          <>
            <View style={s.guide}>
              <Text style={s.guideTitle}>잠깐! 승인 버튼은 왼쪽이에요</Text>
              <Text style={s.guideSub}>
                파란 버튼은 '허용 안 함'이에요.{'\n'}아래 미리보기의 '계속'을 눌러 주세요.
              </Text>
            </View>
            <View style={[s.card, { backgroundColor: c.card }]}>
              <Text style={[s.cardTitle, { color: c.title }]}>
                ‘gromo’ 앱이 스크린 타임에 접근하려고 함
              </Text>
              <Text style={[s.cardBody, { color: c.body }]}>
                ‘gromo’에 스크린 타임 접근을 허용하면, 이 앱이 사용자의 활동 데이터를 보고, 콘텐츠를
                제한하며, 앱 및 웹사이트의 사용을 제한할 수도 있습니다.
              </Text>
              <View style={s.btnRow}>
                <TouchableOpacity
                  // Maestro E2E — 오버레이가 실제 권한창보다 먼저 뜨므로 대본이 이 버튼을 눌러 진행
                  testID="onboarding.screentime.guide.continue"
                  activeOpacity={0.8}
                  onPress={onConfirm}
                  style={[
                    s.pill,
                    s.pillRing,
                    { backgroundColor: c.continueBg, borderColor: c.ring },
                  ]}
                >
                  <Text style={[s.pillText, { color: c.continueText }]}>계속</Text>
                </TouchableOpacity>
                <Animated.View style={[s.flex1, { transform: [{ translateX: shakeX }] }]}>
                  <TouchableOpacity
                    activeOpacity={0.9}
                    onPress={shakeDeny}
                    style={[s.pill, { backgroundColor: c.denyBg }]}
                  >
                    <Text style={[s.pillText, s.denyText]}>허용 안 함</Text>
                  </TouchableOpacity>
                </Animated.View>
                <View style={s.bubbleWrap} pointerEvents="none">
                  <View style={s.bubble}>
                    <Text style={s.bubbleText}>이 버튼이 승인이에요</Text>
                  </View>
                  <View style={s.bubbleArrow} />
                </View>
              </View>
              <View style={s.btnLabels}>
                <Text style={[s.btnLabel, { color: c.okLabel }]}>승인돼요</Text>
                <Text style={[s.btnLabel, { color: c.noLabel }]}>이쪽은 거부예요</Text>
              </View>
            </View>
          </>
        )}
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  dim: { flex: 1, backgroundColor: withAlpha(T.dark, 0.82) },
  // 안내 텍스트 — 복제 카드(상단 38% 지점) 바로 위 공간에 배치
  guide: {
    position: 'absolute',
    left: T.space.xxl,
    right: T.space.xxl,
    bottom: '62%',
    paddingBottom: 28,
    alignItems: 'center',
  },
  guideTitle: { ...T.text.stat, color: T.white },
  guideSub: {
    ...T.text.label,
    color: withAlpha(T.white, 0.9),
    marginTop: T.space.sm,
    textAlign: 'center',
    lineHeight: 23,
  },
  // 복제 카드 — 실기기 실측 위치(좌우 10% 여백 · 상단 38%). 글꼴은 시스템 기본(SF) 그대로.
  card: {
    position: 'absolute',
    top: '38%',
    left: '10%',
    right: '10%',
    borderRadius: 22,
    paddingHorizontal: 26,
    paddingTop: 24,
    paddingBottom: T.space.lg,
  },
  cardTitle: { fontSize: 20, fontWeight: '700', letterSpacing: -0.3, lineHeight: 27 },
  cardBody: { marginTop: T.space.sm, fontSize: 14, lineHeight: 21 },
  btnRow: { flexDirection: 'row', gap: 20, marginTop: T.space.xl },
  flex1: { flex: 1 },
  // borderRadius를 999로 두는 이유 — 높이가 배율 따라 자라도 알약 모양이 유지된다
  // (23은 height 46의 절반이라 높이가 늘면 모서리만 각져 보인다).
  pill: {
    flex: 1,
    minHeight: 46,
    paddingVertical: T.space.xs,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillRing: { borderWidth: 3 },
  pillText: { fontSize: 16, fontWeight: '600' },
  denyText: { color: T.white },
  btnLabels: { flexDirection: 'row', gap: 20, marginTop: T.space.sm },
  btnLabel: { flex: 1, textAlign: 'center', ...T.text.caption },
  // 왼쪽 '계속' 위 말풍선 — 버튼 행 기준 절대 배치(행 높이 46 + 간격 14)
  bubbleWrap: {
    position: 'absolute',
    left: 0,
    right: '50%',
    marginRight: T.space.sm + 2,
    bottom: 60,
    alignItems: 'center',
  },
  bubble: {
    alignSelf: 'stretch',
    backgroundColor: T.accent,
    borderRadius: 12,
    paddingVertical: 11,
    alignItems: 'center',
  },
  bubbleArrow: {
    width: 0,
    height: 0,
    borderLeftWidth: 8,
    borderRightWidth: 8,
    borderTopWidth: 8,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: T.accent,
  },
  bubbleText: { fontSize: 14, fontWeight: '700', color: T.white },
});
