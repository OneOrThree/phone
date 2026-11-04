# 의존성과 번들 구성

직접 의존성 44개를 앱 코드·설정·네이티브 소비자와 대조했다. `dependencies.json`에는 직접 문자열 참조 목록이 있다. 참조 0이 미사용을 뜻하지 않으므로 자동으로 패키지를 제거하지 않았다. 이번에 package.json·lockfile·Pods·Gradle 의존 목록·네이티브 서명·entitlement를 바꾸지 않았다.

| 직접 참조가 약한 후보                                    | 실제 소비 경로                                 | 판단                                    |
| -------------------------------------------------------- | ---------------------------------------------- | --------------------------------------- |
| `@posthog/react-native-plugin`, `expo-device`            | PostHog 내부 optional loader                   | 유지                                    |
| `react-native-nitro-image`, `react-native-nitro-modules` | Vision Camera·TFLite의 peer·네이티브 자동 연결 | 유지                                    |
| `react-native-vision-camera-worklets`                    | 카메라 frame output 경로                       | 유지                                    |
| `react-dom`                                              | Expo 웹 렌더러                                 | 유지                                    |
| `react-native-reanimated`                                | Skia의 선택적 연결·Expo 변환 경로              | 유지                                    |
| `expo-camera`                                            | 현행 VerificationSpike와 Expo 플러그인         | 이전 VerificationSetup 삭제 후에도 유지 |
| 본문 글꼴·위젯 리소스 복사본                             | 웹 로드와 네이티브 사전 등록·별도 번들         | 유지                                    |

미사용이라고 확정한 독립 글꼴은 제거했지만 네이티브 패키지 제거는 채택하지 않았다. SDK를 올리거나 전체 prebuild로 의존 관계를 다시 생성하지 않았다. 새 환경변수·배포 단계도 추가하지 않았다.

## 산출물

`bundle-comparison.json`에 iOS/Android export의 Hermes·gzip·포함 자산, 웹 JS, iOS Simulator 앱, Android APK 전체와 카테고리별 압축/논리 바이트를 기록했다. 숫자와 변화율은 `comparison.md`에서 비교한다. Metro가 동일 내용 해시를 한 번 포함하는 기존 동작을 이번 수동 삭제의 효과로 세지 않는다.

Android APK의 nativeLibraries는 약 53.35MB로 사실상 유지됐다. 리소스 압축 바이트는 218,189,927→218,112,009, assets는 8,888,512→8,898,284다. 네이티브 코드를 대량 삭제해 바이너리가 줄었다고 주장하지 않는다. iOS Simulator 앱 논리 파일 합계와 Android APK의 압축 해제 합계를 스토어 다운로드·사용자 설치 크기와 구분한다.

최종 iOS Release 빌드는 Xcode 26.6에서 기존 workspace의 앱·확장 대상과 함께 성공했고 Android arm64 Release APK도 성공했다. 양쪽 전용 기기에 산출물을 설치해 첫 화면·재실행·주요 화면 왕복을 검증했다. 실제 서명·푸시·앱 차단·스토어 배포 검증은 범위 밖이다. 재실행 조건은 `baseline.md`에 있다.
