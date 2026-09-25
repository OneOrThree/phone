# GROMO-2057 가로 시트 실기기 캡처 검증

## 결과

요청된 검증 기기에서 실제 iOS Simulator 화면으로 32 boat, 33 profile, 34 settings 시트를 확인했다. 세 iPhone은 모두 가로에서 하단 경계 바깥으로 다음 카드 콘텐츠가 노출되지 않았고, 세 시트 모두 스크롤 마지막 항목을 Maestro assert 및 접근성 hierarchy로 확인했다. iPad에서는 세 시트의 카드형 경계 캡처와 hierarchy를 확인했다.

임시 QA 모드는 기본 boat 진입과 testID 선택 버튼만 제공했으며, 완료 후 `app/app-dev/src/App.tsx`에서 원복했다. `project.pbxproj` 및 `Podfile.lock`도 `git restore`했고, 검증 종료 시 부팅된 simulator가 없었다.

## iPhone 가로 캡처

| 기기 | 해상도 | Boat | Profile | Settings |
|---|---:|---|---|---|
| iPhone SE 3 | 1334×750 | [기본](SE3-boat-landscape.png) · [마지막 항목](SE3-boat-scroll-tail.png) | [기본](SE3-profile-landscape.png) · [마지막 항목](SE3-profile-scroll-tail.png) | [기본](SE3-settings-landscape.png) · [마지막 항목](SE3-settings-scroll-tail.png) |
| iPhone 17 | 2622×1206 | [기본](iPhone17-boat-landscape.png) · [마지막 항목](iPhone17-boat-scroll-tail.png) | [기본](iPhone17-profile-landscape.png) · [마지막 항목](iPhone17-profile-scroll-tail.png) | [기본](iPhone17-settings-landscape.png) · [마지막 항목](iPhone17-settings-scroll-tail.png) |
| iPhone Pro Max | 2868×1320 | [기본](ProMax-boat-landscape.png) · [마지막 항목](ProMax-boat-scroll-tail.png) | [기본](ProMax-profile-landscape.png) · [마지막 항목](ProMax-profile-scroll-tail.png) | [기본](ProMax-settings-landscape.png) · [마지막 항목](ProMax-settings-scroll-tail.png) |

각 기본 화면은 Maestro에서 route 제목을 assert하고 `setOrientation: LANDSCAPE_LEFT` 후 별도 `simctl screenshot`으로 기록했다. 각 tail 흐름은 시트 콘텐츠를 네 차례 swipe한 뒤 마지막 접근성 텍스트를 assert했다.

| 시트 | 마지막 항목 확인 |
|---|---|
| boat | `내 정보, 닉네임 · 털색 · 계정` |
| profile | `회원 탈퇴` |
| settings | `이용약관 · 개인정보` |

계층 정보의 `island-sheet-content-clip` 경계 및 마지막 항목 위치:

- SE: clip `[129,64][667,375]`; tail 항목 모두 clip 내부, 마지막 콘텐츠 y 최대 351.
- iPhone 17: clip `[274,64][874,402]`; boat tail `[298,250][788,314]`, profile tail `[493,336][592,380]`, settings tail `[298,320][788,378]`.
- Pro Max: clip `[356,64][956,440]`; boat tail `[380,288][870,352]`, profile tail `[575,374][674,418]`, settings tail `[380,358][870,416]`.

모든 마지막 항목의 경계가 각 clip 영역 안에 있어 스크롤 마지막까지 접근 가능함을 확인했다.

## iPad 카드형 시트

| 시트 | 캡처 |
|---|---|
| boat | [iPad boat](iPad-boat-card-sheet.png) |
| profile | [iPad profile](iPad-profile-card-sheet.png) |
| settings | [iPad settings](iPad-settings-card-sheet.png) |

iPad 캡처는 1668×2420 세로이며 세 시트 제목을 assert했다. hierarchy에서 sheet card bounds `[137,163][697,1083]`, clip bounds `[139,237][695,1081]`을 확인했다.

캡처에는 임시 route 전환용 `QA` 버튼이 시트 밖 배경 가장자리에 작게 보인다. 캡처 도구는 Maestro 2.6.1, 앱은 app-dev Debug simulator build다.

## 검사와 작업 트리

- Maestro route 및 scroll-tail flows: iPhone SE 3, iPhone 17, Pro Max, iPad에서 성공.
- app lint/typecheck/Jest: 앞선 코드 작업에서 lint 오류 0(경고 1540), typecheck 통과, 65 suites / 807 tests 통과. `IslandSheet.test.tsx`는 6 tests 통과.
- 이번 실캡처 전에 `pod install`로 Pods sandbox lock을 맞춰 iOS Debug simulator build에 성공했다.
- 임시 `App.tsx` QA route 모드와 iOS 프로젝트/lockfile 변경을 원복했다. `git status --short`에는 요청된 캡처 및 REPORT artifacts만 남았고, `app/app-dev/ios/Pods` 경로는 status에 나타나지 않았다.
- 종료 시 `xcrun simctl list devices booted` 출력은 비어 있다.

기존 PR: [#1000](https://github.com/OneOrThree/phone/pull/1000).
