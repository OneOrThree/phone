// androidAppPicker.ts
// 안드로이드 앱 선택 피커 브릿지(GROMO-995).
//
// iOS는 presentAppPicker 계열이 네이티브 모달(FamilyActivityPicker)을 띄우고 선택 결과로
// promise를 resolve한다. 안드로이드는 피커가 RN 화면(AndroidAppPickerHost — App.tsx에 상시
// 마운트)이므로, 그 계약을 이 모듈이 중개한다: ScreenTimeModule.ts의 안드로이드 분기가
// presentAndroidAppPicker를 부르면 호스트가 모달을 띄우고 선택 결과(개수)로 resolve한다.
// 덕분에 호출부(화면 코드)는 플랫폼을 모른 채 기존 흐름 그대로 동작한다.

import type { AppSelectionCounts } from '@/services/ScreenTimeModule';

// 피커 모드 — measurement: 측정 대상(pending 저장 → 호출부의 promoteSelection으로 승격, 2단계),
// allowed: 집중 허용앱(즉시 저장, 1단계). iOS의 측정/허용 피커 구분과 1:1.
export type AndroidAppPickerMode = 'measurement' | 'allowed';

type Presenter = (mode: AndroidAppPickerMode) => Promise<AppSelectionCounts | null>;

let presenter: Presenter | null = null;

// 호스트(AndroidAppPickerHost)가 마운트 시 등록한다. 반환된 함수로 해제.
export function registerAndroidAppPickerHost(fn: Presenter): () => void {
  presenter = fn;
  return () => {
    if (presenter === fn) presenter = null;
  };
}

// 피커 표시 — 호스트 미마운트면(앱 루트에 상시 마운트라 이론상 없음) iOS의 '표시할 화면
// 없음'처럼 취소(null) 취급해 호출부 흐름을 깨지 않는다.
export function presentAndroidAppPicker(
  mode: AndroidAppPickerMode,
): Promise<AppSelectionCounts | null> {
  if (!presenter) return Promise.resolve(null);
  return presenter(mode);
}
