import { useRef, type ReactNode } from 'react';
import { StyleSheet, View, type GestureResponderEvent } from 'react-native';
import { navigationRef } from '@/navigation/navigationRef';
import { logRageTapDetected } from '@/services/analyticsEvents';

// 빡침 연타 감지(GROMO-782) — 앱 전역 터치를 관찰해 같은 지점 연타(좌절 신호)를 계측한다.
// 판정: 같은 지점(반경 40pt)을 1초 이내 간격으로 연타해 4회째 탭이 되는 순간
// rage_tap_detected를 발행하고, 이후 5초 쿨다운으로 재발행을 억제한다.
// 스크롤/드래그 오탐 방지 — 300ms 안에 10pt 미만 이동으로 끝난 터치만 '탭'으로 센다.
// onTouchStart/End는 버블링 관찰이라 버튼·스크롤 등 기존 터치 동작에 영향이 없다.
// 한계: react-native Modal 내부 터치는 별도 네이티브 윈도우라 여기까지 버블링되지 않는다.

const TAP_MAX_MS = 300; // 이 시간 안에 떼야 탭(길면 롱프레스/드래그)
const TAP_MOVE_PT = 10; // 시작→끝 이동 허용치 — 넘으면 스크롤/드래그
const CHAIN_GAP_MS = 1000; // 연타로 인정하는 탭 사이 간격
const CHAIN_RADIUS_PT = 40; // 같은 지점으로 보는 반경
const FIRE_COUNT = 4; // 이 횟수째 탭에서 발행
const COOLDOWN_MS = 5000; // 발행 후 재발행 억제 시간

export function RageTapDetector({ children }: { children: ReactNode }) {
  // 진행 중인 터치의 시작점 — 탭/드래그 판별용
  const start = useRef<{ x: number; y: number; t: number } | null>(null);
  // 연타 스트릭 — 마지막 탭의 위치·시각·누적 횟수
  const chain = useRef<{ x: number; y: number; t: number; count: number } | null>(null);
  const cooldownUntil = useRef(0);

  const onTouchStart = (e: GestureResponderEvent) => {
    const { pageX, pageY, timestamp } = e.nativeEvent;
    start.current = { x: pageX, y: pageY, t: timestamp };
  };

  const onTouchEnd = (e: GestureResponderEvent) => {
    const s = start.current;
    start.current = null;
    if (!s) return;
    const { pageX, pageY, timestamp } = e.nativeEvent;
    const isTap =
      timestamp - s.t <= TAP_MAX_MS && Math.hypot(pageX - s.x, pageY - s.y) <= TAP_MOVE_PT;
    if (!isTap) {
      chain.current = null; // 드래그가 끼면 스트릭이 끊긴다
      return;
    }
    const prev = chain.current;
    const linked =
      prev !== null &&
      s.t - prev.t <= CHAIN_GAP_MS &&
      Math.hypot(s.x - prev.x, s.y - prev.y) <= CHAIN_RADIUS_PT;
    chain.current = { x: s.x, y: s.y, t: s.t, count: linked ? prev.count + 1 : 1 };
    if (chain.current.count >= FIRE_COUNT && timestamp >= cooldownUntil.current) {
      cooldownUntil.current = timestamp + COOLDOWN_MS;
      chain.current = null; // 쿨다운 뒤에도 연타가 이어지면 새 스트릭으로 다시 센다
      logRageTapDetected({
        // 내비게이터 준비 전(로그인·온보딩 게이트)은 라우트가 없어 구간 이름으로 대신한다
        screen_name: navigationRef.isReady()
          ? (navigationRef.getCurrentRoute()?.name ?? 'unknown')
          : 'onboarding_or_login',
      });
    }
  };

  return (
    <View style={s.flex1} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      {children}
    </View>
  );
}

const s = StyleSheet.create({ flex1: { flex: 1 } });
