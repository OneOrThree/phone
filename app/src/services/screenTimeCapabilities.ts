// 스크린타임 기능별 플랫폼 가용성 (GROMO-1592)
//
// 아래 술어들은 **구현이 붙은 플랫폼에서만** 열린다.
// 네이티브가 없는 쪽에서 호출하면 ScreenTimeModule의 각 함수가 null/false를 돌려주는데,
// **호출부는 그걸 '사용자 취소'로 읽고 조용히 끝낸다.** 그래서 버튼을 눌러도 화면이 안 바뀌고
// 에러도 없다 — 사용자에겐 그냥 고장이다.
// 진입점을 그릴지 말지는 호출 결과가 아니라 이 술어로 **미리** 판단한다.
//
// ⚠️ 화면에서 Platform.OS를 직접 비교하지 말 것 — 구현이 붙을 때 고쳐야 할 자리가 흩어져
//    하나를 빠뜨리면 그 화면만 계속 숨겨진다. 여기 한 줄만 바꾸면 전부 열리게 둔다.
//
// ⚠️ ScreenTimeModule이 아니라 별도 모듈인 이유: 이건 네이티브 왕복이 아니라 순수한 플랫폼
//    사실이다. 같은 파일에 두면 ScreenTimeModule을 통째로 jest.mock 하는 테스트들이 이 술어까지
//    함께 지워버려, 목에 빠뜨린 화면이 조용히 undefined를 호출하게 된다.

import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';

// 안드로이드 네이티브 모듈을 **여기서 직접** 찾는다 — ScreenTimeModule 에서 가져오지 않는다.
// 이 파일이 그 모듈과 분리돼 있는 이유가 그대로 적용된다(위 주석): 화면 테스트들이
// `jest.mock('@/services/ScreenTimeModule')` 로 그 모듈을 통째로 지우는데, 술어까지 같이
// 지워지면 목에 빠뜨린 화면이 조용히 undefined 를 호출하게 된다.
//
// ⚠️ 모듈 최상단 상수로 굳히지 않는다. 그러면 import 시점의 Platform.OS 가 박혀서, 테스트가
//    플랫폼을 바꿔도 판정이 따라오지 않는다(실제로 그렇게 짰다가 잡혔다). 조회 자체는
//    네이티브 레지스트리 룩업이라 매번 불러도 싸다.
const androidNativeHas = (method: string): boolean => {
  if (Platform.OS !== 'android') return false;
  const mod = requireOptionalNativeModule<Record<string, unknown>>('ScreenTimeModule');
  return typeof mod?.[method] === 'function';
};

/**
 * 측정 대상 앱 선택을 지원하는가.
 *
 * 양쪽 다 되지만 **가는 길이 다르다** — iOS는 네이티브 시스템 피커(presentAppPicker)를 띄우고,
 * 안드로이드는 RN 화면(SettingsAppPicker)으로 이동한다(GROMO-1593). 호출부는 이 술어로
 * '보여줄지'만 정하고, '어떻게 여는지'는 각 화면이 Platform으로 갈라 쓴다.
 */
export const supportsAppSelection = (): boolean => {
  if (Platform.OS === 'ios') return true;
  // ⚠️ 안드로이드는 **네이티브 메서드 존재**로 가른다(코드리뷰 반영). 이 JS 는 hot-updater 로
  //    M2 이전 바이너리에도 내려가는데, 거기엔 getInstalledApps·getSelectionPackages 가 없다:
  //      - 모듈은 있고 메서드만 없는 빌드 → 피커 진입 후 undefined 호출로 오류 화면
  //      - 모듈이 아예 없는 빌드 → 빈 목록이 '설치된 앱이 없다'처럼 보인다
  //    supportsUsageBreakdown() 과 같은 방식이다.
  return androidNativeHas('getInstalledApps') && androidNativeHas('getSelectionPackages');
};

/** 집중 중 **허용앱 목록을 고르고 관리**할 수 있는가. */
export const supportsFocusShield = (): boolean =>
  Platform.OS === 'ios' || Platform.OS === 'android';

/**
 * 고른 허용앱이 **실제로 차단에 쓰이는가**(집중 중 다른 앱이 잠기는가).
 *
 * 목록 관리(위)와 나눠 둔 이유는 구현이 붙은 뒤에도 유효하다 — 두 플랫폼의 차단 방식이
 * 근본적으로 다르기 때문이다.
 *   - iOS: OS에 위임(ManagedSettingsStore). 권한만 있으면 항상 걸린다.
 *   - Android: 우리가 폴링 + 가림막으로 직접 돌린다(GROMO-1604). '다른 앱 위에 표시' 권한이
 *     꺼져 있으면 가림막을 못 올려 **고를 수는 있는데 이번 세션엔 차단이 안 걸린** 상태가 된다.
 *
 * 그래서 이 술어는 "이 플랫폼이 차단을 **할 줄 아는가**"만 답한다. 이번 세션에 **실제로
 * 걸렸는지**는 `startFocusShield()`의 반환값이 정본이다 — 화면은 그 값으로 이탈 정책을 가른다.
 */
export const enforcesFocusShield = (): boolean =>
  Platform.OS === 'ios' || Platform.OS === 'android';

/**
 * 앱별 사용 시간 상세(어떤 앱을 얼마나)를 볼 수 있는가.
 *
 * 양쪽 다 되지만 **그리는 방식이 다르다** — iOS는 DeviceActivityReport 익스텐션이 그린
 * 네이티브 뷰를 통째로 임베드하고(수치 자체는 JS로 못 가져온다), 안드로이드는 UsageStats
 * 수치를 받아 RN이 그린다(GROMO-1608). 호출부는 이 술어로 '보여줄지'만 정하고, '어떻게
 * 그리는지'는 화면이 Platform으로 갈라 쓴다.
 */
export const supportsUsageBreakdown = (): boolean => {
  if (Platform.OS === 'ios') return true;
  // ⚠️ Platform.OS 만으로 열면 **구 바이너리에서 거짓말이 된다**(코드리뷰 반영). 이 JS 는
  //    hot-updater 로 옛 안드로이드 바이너리에도 그대로 내려간다:
  //      - 네이티브 모듈이 아예 없는 빌드 → 상세가 '0분 · 사용 기록이 없어요'로 뜬다
  //      - M1 모듈만 있는 빌드 → getUsageBreakdown 이 없어 호출 자체가 실패한다
  //    둘 다 '진입점은 열려 있는데 화면이 거짓을 말하는' 상태다 — 1592 가 없앤 바로 그것.
  return androidNativeHas('getUsageBreakdown');
};

/**
 * 앱 프로세스가 죽으면 **차단도 함께 풀리는가**.
 *
 * 위 셋과 달리 '무엇을 보여줄지'가 아니라 '무엇을 알려야 하는지'를 가른다.
 *   - iOS: `ManagedSettingsStore`로 OS에 위임한다 — 앱이 죽어도 차단은 그대로 남는다.
 *   - Android: 우리 포그라운드 서비스가 직접 돌린다 — 강제 종료되면 차단도 사라진다.
 *
 * 그래서 "집중 중이었는데 차단이 꺼져 있었어요" 같은 안내는 **안드로이드에서만 사실**이다.
 * iOS에서 같은 말을 하면 거짓이 된다.
 */
export const shieldDiesWithApp = (): boolean => Platform.OS === 'android';
