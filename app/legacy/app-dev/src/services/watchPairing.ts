// 워치 페어링 보급률 계측 (GROMO-1598 · docs/prd/apple-watch/ R12, policy D3-ⓒ)
// 앱 기동 시 WCSession.isPaired를 읽어 GA4 사용자 속성 watch_paired로 1회 보고한다.
// 워치 앱 출시 전에 보급률(분모)을 먼저 쌓는 것이 목적 — isPaired는 「페어링된 적 있는
// 워치 존재」의 상한 근사치일 뿐, 워치 앱 설치·watchOS 버전·도달성을 뜻하지 않는다(PRD §5).
import { NativeModules, Platform } from 'react-native';

import { setIdentityProps } from '@/services/analyticsEvents';

interface WatchPairingStatus {
  supported: boolean;
  paired: boolean;
  watchAppInstalled: boolean;
}

interface WatchSessionModuleSpec {
  getPairingStatus(): Promise<WatchPairingStatus>;
}

export async function reportWatchPairing(): Promise<void> {
  // WCSession은 iOS 전용. Android는 「미측정」으로 두고 속성을 만들지 않는다 — Wear OS
  // 보급률은 별도 계측이 필요한 다른 질문이다.
  if (Platform.OS !== 'ios') return;
  const native = NativeModules.WatchSessionModule as WatchSessionModuleSpec | undefined;
  if (!native) return;
  try {
    const status = await native.getPairingStatus();
    // 미지원 기기(iPad 등)는 false로 분모에 포함한다 — 보급률 = paired / 전체 iOS 사용자.
    setIdentityProps({ watch_paired: status.supported && status.paired });
  } catch {
    // 타임아웃·활성화 실패는 「모름」이다 — false로 기록하면 보급률이 실제보다 낮게 오염되므로
    // 속성을 건드리지 않는다. 다음 기동에서 재시도된다.
  }
}
