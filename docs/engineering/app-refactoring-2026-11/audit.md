# 조사 결과와 처리 근거

## 범위와 소유 영역

`file-ownership.json`은 활성 앱의 추적 파일과 신규 파일 1,675개를 경로별 소유 영역에 매핑한다. `src`는 TS 의존 그래프·진입점·자산 사용, `modules`는 네이티브 소비자와 생명주기 관련 테스트, `ios`·`android`는 등록 리소스·빌드 설정·Release 산출물, 앱 설정·scripts는 플랫폼 분기·생성물·OTA 계약을 조사했다. 네이티브 SDK 내부 전체 소스나 서버·백오피스·동결 1.x 앱은 리팩토링 범위 밖이다. 모든 경로에 같은 깊이의 수동 코드 리뷰를 했다는 의미는 아니다.

후보별 배정은 미사용 코드 T03, 동일 계약 유틸 T04, 건물 내부 T05, 화면 모음 T06, 루트·모델·타입 T07, 자산 T08, 렌더 T09, 수명 T10, 의존성 T11이다. 각 후보의 채택/보류 이유는 아래와 `architecture.md`, `assets.md`, `rendering.md`, `lifecycle.md`에 있다. 기존 지도·걷기·루트 시계 최적화는 재계측만 하고 새 구현 효과로 합산하지 않는다.

## 삭제와 재사용

정적 참조가 없다는 사실만으로 지우지 않았다. `index.native.ts`, `index.web.ts`, 검토실 진입, 네이티브 설정, 생성 스크립트, 테스트의 소비자를 함께 확인했다.

| 후보                                                         | 판단·처리                                                                                                   |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| 이전 `VerificationSetup`                                     | 현행 경로는 `VerificationSpike`다. 독립된 이전 화면과 전용 테스트 제거                                      |
| `App`의 `Bubble`, `openFacility`, `send`                     | 선언 외 소비자 없음. 내부 상태·메일 ref까지 제거                                                            |
| `App`의 `boatTravel`                                         | 뷰에 연결되지 않았는데 여행·도착 때 애니메이션을 시작함. 값·effect 제거. 현행 항해 장면 애니메이션은 유지   |
| 이전 `IslandDiscovery`, `FocusSea`                           | 앱의 사용하지 않는 import만 남아 있었음. 진입점·네이티브·스크립트 소비자 없음. 제거                         |
| `Cosmetics`의 `BoatPortrait`, `IslandDecor`, `IslandPreview` | 위 이전 화면을 제외하면 제품 소비자 없음. 제거하고 망원경에서 쓰는 `Flag`만 별도 파일로 유지                |
| 제거한 옛 화면의 테스트                                      | 해당 구현만 검증하던 테스트만 제거. 현재 `FishingIsland` 테스트 파일에서는 `FishingBoat` 테스트 하나만 제거 |
| `gowun-dodum-board.ttf`                                      | 코드·설정·네이티브 등록·생성 스크립트에서 소비자 없음. 제거. 본문 `gowun-dodum.ttf`와 Android 리소스는 유지 |
| `App`, 각 Preview·Gallery, `sentry.ts`                       | src 내부에서는 참조가 없어도 외부 엔트리에서 선택·초기화하므로 유지                                         |
| `afterForegroundMs` 두 구현                                  | 본문·계약이 동일함을 확인해 하나로 통합. 포그라운드 누적 시간과 취소 동작을 검증                            |

## 보이지 않는 화면과 자원

- 게시판 상세 뒤 목록의 opacity=0은 목록 스크롤 위치 복원을 위한 의도적인 마운트다. 포인터·접근성 트리 차단도 있다. 목록을 무조건 unmount하지 않았다.
- `backgroundHome` 같은 JSX 값을 만드는 것과 실제 마운트·그리기는 다르다. 반환하지 않는 React 요소 생성만으로 숨은 장면이 렌더된다고 집계하지 않았다.
- `useNow`와 앱의 표시용 벽시계는 배경에서도 timeout/interval이 살아 있었다. `subscribeForegroundClock`으로 배경 진입 시 예약을 해제하고 복귀 시 현재 시각을 즉시 반영한다. 초 경계 정렬, 중복 active, 배경 마운트, 10회 반복 해제, 콜백 안 해제를 테스트한다.
- 건물 내부의 짧은 Animated 모션과 앱 화면 전환은 unmount 시 중지한다. 토스트 타이머도 정리한다.
- 기존 스프라이트·걷기·집중 타이머 최적화는 이번 변경의 성과로 다시 집계하지 않는다. 기존 렌더 횟수 테스트를 회귀 검증에 포함한다.

## 미디어와 네이티브 의존성

- 압축 채택 PNG 262개는 크기·RGBA 픽셀·부가 청크가 동일하다. 파일별 전후 SHA와 바이트는 `png-compression.json`에 있다. 소스 절감은 3,190,831바이트이며 decoded 메모리는 같음.
- `scripts/optimize-png.py`는 기본 조사 모드이고 `--apply`에서만 수정한다. Git 추적 PNG만 처리하며 생성 아틀라스·바다 원화·CDN 계약 경로는 제외한다. Pillow와 별도 pngcrush가 필요하다.
- 생성물 검사는 기존 스크립트의 PNG 픽셀 동등성 기준을 따른다. CDN manifest의 내용 해시·버전 계약과 네이티브 서명·entitlement는 바꾸지 않는다.
- 영상은 기존 MP4를 유지한다. 손실 재인코딩·프레임 축소는 무손실 PNG 압축과 달라 이번에 시각 품질 저하를 감수하지 않는다.
- 본문 글꼴은 임의 사용자 이름·한국어·영어를 표시하므로 현재 화면에 나온 글자만으로 subset하지 않는다. 네이티브 사전 등록과 웹 로드는 이미 분리되어 있다.
- `dependencies.json`은 직접 문자열 참조 조사 자료다. 직접 참조 0을 삭제 가능 판정으로 사용하지 않는다.
- `expo-device`, `@posthog/react-native-plugin`은 PostHog가 내부 optional loader로 읽는다. `react-native-nitro-image/modules`는 Vision Camera·TFLite의 peer이고 `vision-camera-worklets`는 frame output 경로가 읽는다. `react-dom`은 Expo 웹 렌더러, Reanimated는 Skia·Expo 변환 경로까지 확인하여 유지했다.
- SDK 업그레이드·lockfile 변경은 하지 않았다. 네이티브 최소 구성은 실제 iOS/Android Release 빌드와 실행으로 검증한다. 빌드 성공과 실행 성공은 별도로 기록한다.
