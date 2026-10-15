# 2.0 스크린타임 사용량 리포트

1.x 리포트 4종을 2.0 앱으로 이식했다. 사용량은 확장 내부에서만 표시하고,
퀘스트 판정과 날짜별 기록은 기존 `DeviceActivityMonitor` 버킷 경로를 유지한다.

- Bundle ID: `com.oneorthree.focuscat.screentimereport`
- App Group: `group.com.oneorthree.focuscat`
- Xcode 제품 유형: ExtensionKit extension
- 앱 번들 위치: `GROMO.app/Extensions/screentimereport.appex`
- 서명: `dev-cat-screentimereport` / `distribution-cat-screentimereport` (Manual)
- 연결 화면: `Library.tsx` 내 일기장 스크린타임 페이지, `Screens.tsx` 기존 기록 화면
- 색상 정본: `src/design-system/tokens.ts` → `npm run gen:report-palette`

## 집계 기준

활성 측정 선택(`gromo:goal:selection`)만 사용한다. 다음 날 적용될 대기 선택은 읽지 않는다.
카테고리를 선택했다면 웹 도메인을 별도 합산하지 않는 기존 Monitor 규칙을 따른다.
자기 앱(`com.oneorthree.focuscat`)의 사용 시간은 제외한다. iPhone의 로컬 날짜를 기준으로
오늘 자정부터 현재까지 조회하며 과거 날짜는 하루 전체를 조회한다.

리포트 데이터가 아직 없거나 권한·측정 대상이 없으면 0분을 표시하지 않는다.
확장은 App Group에서 선택과 목표만 읽고 사용량을 JS나 공유 저장소로 내보내지 않는다.
`Remaining Activity`와 `Home Usage`의 목표 미설정은 -1, 0초 목표는 0이다.

## 갱신과 검증

화면 부착, RN props 변경, 앱 활성화, 시스템 시간 변경 및 표시 중 60초 간격으로 갱신한다.
해제 시 타이머와 자식 hosting controller를 정리한다.

- `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test -- --runInBand`
- `npm run gen:report-palette:check`
- iOS Debug/Release 빌드에서 확장 포함과 서명 entitlement를 확인한다.
- 실기기에서 같은 날짜·기기의 선택 앱 사용 시간을 iOS 설정과 비교한다.
  전체 기기 합계에는 미선택 앱과 자기 앱이 포함되므로 직접 동등 비교하지 않는다.
- 권한 철회/재승인, 측정 대상 변경 후 다음 날 승격, 앱 복귀, 자정 경과,
  0분/데이터 미수신, 큰 글자, 내 일기장/이웃 일기장, 가로 화면을 점검한다.
- 실기기에서 확인한 수치·기기/iOS·비교 시각·선택 범위·차이를 티켓에 기록한다.
