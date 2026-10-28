# 2.0 앱 성능 측정 — 최적화 전후 (GROMO-2370)

에픽 「[공통] 2.0 앱 최적화」(GROMO-2369) 작업의 효과를 숫자로 남긴다. 같은 조건에서 최적화 전(`f042d75a4`, main)과
후(브랜치 `arefactor/GROMO-2369-app-optimization` 끝)를 Release 빌드로 쟀다.

## 1. 결과 요약

| 항목 | 전 | 후 | 변화 |
| --- | ---: | ---: | ---: |
| 콜드 스타트 → 홈 섬 표시 (중앙값, 5회) | 3.32초 | 1.73초 | −48% |
| 홈 섬 메모리 phys_footprint (중앙값, 5회) | 249 MB | 97 MB | −61% |
| 홈 섬 대기 CPU (10초 평균, 중앙값) | 5.7% | 4.3% | −25% |
| 조작 CPU 시간 (걷기 1번 + 지도 끌기 4번) | 4.06초 | 1.63초 | −60% |
| 조작 뒤 메모리 | 263 MB | 145 MB | −45% |
| 앱 크기 (시뮬레이터 .app) | 425.7 MB | 355.2 MB | −17% |
| 크래시 소크 (12분, 조작 22~24회) | — | 0건 | |

5회 원값

| | 전 | 후 |
| --- | --- | --- |
| 콜드 스타트(초) | 3.40 · 3.41 · 3.19 · 3.32 · 2.99 | 1.83 · 1.80 · 1.72 · 1.73 · 1.72 |
| 메모리(MB) | 249 · 245 · 241 · 250 · 249 | 96 · 96 · 97 · 97 · 97 |
| 대기 CPU(%) | 5.1 · 5.7 · 5.7 · 6.6 · 5.0 | 4.3 · 4.3 · 3.7 · 3.9 · 5.0 |

## 2. 측정 조건

- 빌드: iOS Release, `CODE_SIGNING_ALLOWED=NO`, Xcode 26.6, `-sdk iphonesimulator`.
- 기기: iPhone 17 시뮬레이터(iOS 26.5), 호스트 Mac17,9(macOS 26.7.1). **실기기가 아니다** — CPU·GPU 는 맥 것이라
  절대값보다 전후 비율로 읽는다.
- 환경변수: `EXPO_PUBLIC_DEMO=1`(목업 모드 — 서버를 부르지 않고 데모 섬으로 홈을 연다), `EXPO_PUBLIC_TERMS_VERSION=2026-09`,
  `GROMO_IOS_AUDIENCE=dev` + dev API 주소(빌드 검문 통과용, 목업이라 호출 없음). Datadog·PostHog 토큰은 넣지 않았다(외부 전송 없음).
- 콜드 스타트: 앱 종료 → `simctl launch` 직후부터 화면을 연속 캡처해 「집중 시작」 버튼(분홍)과 퀘스트 카드(종이색)가 둘 다
  보이는 첫 캡처까지. 캡처 간격(약 0.15초)만큼 오차가 있다.
- 메모리: 홈이 뜨고 5초 뒤 `footprint <pid>` 의 phys_footprint.
- 대기 CPU: 그 뒤 10초 동안 `ps -o time` 증가량 ÷ 10초.
- 조작: maestro 로 풀밭 탭(걷기) 1번 + 지도 끌기 4번(각 0.8초) 동안 앱 프로세스 CPU 시간.
- 소크: 12분 동안 위 조작과 10초 대기를 반복하며 프로세스가 살아 있는지 본다.

## 3. 측정에 잡히지 않은 것

- **서버 요청 병렬화(GROMO-2377)**: 목업 모드는 서버를 부르지 않는다. 대신 jest 로 첫 화면 전 서버 왕복 3단계 → 2단계,
  `/me` 2번 → 1번을 고정했다(`App.bootConcurrency.test.tsx`).
- **Datadog 터치 추적 끄기·PostHog 플래그 미리 받기 끄기(GROMO-2376 일부)**: 토큰이 없어 SDK 가 꺼진 채로 쟀다.
  실제 빌드에서는 효과가 더 있다.
- **실기기 프레임(FPS)·끊긴 프레임 수**: 아직 재지 않았다. Release 빌드를 실기기(iPhone 15)에 올려 Xcode Instruments
  「Animation Hitches」 로 홈 걷기·지도 끌기·확대 3장면을 재고 이 문서에 표를 더한다.

## 4. 렌더 횟수 (jest)

React 가 화면을 다시 계산하는 횟수다. 테스트로 고정해 되돌아가면 실패한다.

| 장면 | 전 | 후 | 테스트 |
| --- | ---: | ---: | --- |
| 고양이가 건물까지 걷는 동안 지도 전체 렌더 | 32 | 1 이하 | `WorldMap.renderCount.test.tsx` |
| 홈에서 5초 대기 동안 지도 전체 렌더 | 5 | 0 | `App.clock.test.tsx` |
| 지도 끌기 이동 30번 동안 지도 전체 렌더 | 30 | 0 (손 뗄 때 1) | `WorldMap.renderCount.test.tsx` |
| 집중섬 끌기 이동 30번 동안 지도 전체 렌더 | 29 | 0 (손 뗄 때 1) | `FishingIsland.renderCount.test.tsx` |
| 고양이 스프라이트 7프레임 동안 React 커밋 | 7 | 0 | `CatSprite.test.tsx` |

## 5. 크기

| 항목 | 전 | 후 |
| --- | ---: | ---: |
| 음원 4개 | 23.0 MB (WAV) | 2.9 MB (AAC m4a) |
| 불투명 배경 PNG 16개 | 37.6 MB | 10.2 MB (JPG) |
| 황금 물고기 컷신 영상 2개 | 5.8 MB | 1.5 MB (720p) |
| 타일 섬 꺼진 빌드의 타일셋 2장 | 13.9 MB | 0 (플래그 켤 때만 포함) |
| Gaegu 글꼴 2벌 | 5.85 MB | 0 |
| 홈 화면 건물·지형 그림 디코드 메모리 | 53.8 MiB | 7.7 MiB |

## 6. 참고 — 측정 중 발견한 크래시

중간 빌드에서 고양이 스프라이트를 Reanimated 로 돌렸을 때 iOS 에서 대기 중 SIGSEGV 가 났다
(`ReanimatedModuleProxy::commitUpdates → cloneShadowTreeWithNewProps → folly::dynamic::hash`, 메인 스레드가 shadow tree 를
복제하는 동안 JS 스레드가 같은 노드를 해제). 업스트림 미해결 이슈(react-native-reanimated #10543)라 Reanimated 를 빼고
React Native `Animated` 네이티브 드라이버로 바꿨다. 위 「후」 수치와 소크는 그 뒤 빌드다.
