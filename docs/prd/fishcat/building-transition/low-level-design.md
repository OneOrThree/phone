# 건물 진입 공통 전환 설계

## 대상과 경로

전환 계약은 회관(`hall`), 게시판(`board`), 전망대(`tower`), 상점(`shop`), 화톳불 휴식(`fire` → `rest`), 도서관(`library`) 여섯 경로를 다룬다. 우체통(`mail`)과 축음기(`gram` → `sound`)는 별도 경로이므로 이 전환에 포함하지 않는다.

## 동작

- 진입은 섬 장면에서 선택한 건물 좌표를 확대 원점으로 삼아 620ms 동안 `cubic-in-out`으로 화면 덮개를 확장하고 목적지 route를 연다.
- 목적지 초기 화면이 표시되는 전환 구간은 덮개 아래에 둔다. 건물별 일러스트는 이 계약의 입력이 아니며, 후속 작업은 동일한 `BuildingTransitionTarget`과 좌표 계약을 사용한다.
- `reduceMotion`에서는 애니메이션 대기 없이 route를 연다.
- 동시에 하나의 전환만 허용한다. 앱 뒤로가기는 진행 중 확대를 우선 취소하고 예약된 route 변경을 폐기한다.
- route 로딩 덮개는 전환별 소유자와 만료 타이머를 가지며 구독자를 통해 React 화면에 만료를 전달한다. 비활성 controller 정리가 다른 전환이나 덮개 상태를 지우지 않는다.
- 내부 route에서 홈 섬으로 뒤로가기/홈 이동할 때 같은 duration/easing으로 역방향 전환한다. 화톳불은 `rest`↔`focus`, 나머지 다섯 route는 홈 복귀에 연결한다.

## 코드 계약

- 경로 및 모션 상수: `app/app-dev/src/services/buildingTransition.ts`
- 장면 덮개: `app/app-dev/src/screens/island/BuildingTransitionOverlay.tsx`
- 활성 섬 진입점: `app/app-dev/src/screens/island/WorldMap.tsx`
- 뒤로가기 취소 연결: `app/app-dev/src/App.tsx`

전환 직렬화, 취소, reduce motion, 여섯 진입/복귀 매핑은 `buildingTransition.test.ts`에서 검증한다.
