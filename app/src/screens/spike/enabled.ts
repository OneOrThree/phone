// 스파이크(오브젝트 캐릭터) 노출 스위치 — 프로드 빌드 차단이 기본이고, 실기기 QA용 Release
// 빌드만 EXPO_PUBLIC_ENABLE_SPIKE=1로 열어준다(spike-device.command가 켠다 — 번들 시점에
// 인라인되는 값이라 런타임 주입은 불가).
//
// 진입점(MenuScreen)과 라우트 등록(RootNavigator)이 같은 값을 보게 해서, 꺼진 빌드에서는
// 스파이크 화면 모듈 자체가 평가되지 않도록 한다 — 네이티브 미링크 바이너리(구 바이너리에
// 얹힌 OTA 번들 등)에서 부팅 크래시가 나지 않게 하는 안전판.
// 검증이 끝나면 이 파일과 screens/spike/ 폴더째 제거한다.
export const SPIKE_ENABLED = __DEV__ || process.env.EXPO_PUBLIC_ENABLE_SPIKE === '1';
