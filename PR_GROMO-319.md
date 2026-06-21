# [FEAT] GROMO-319 그룹 설정탭 전면 구현 (설정·공지·탈퇴/위임·챌린지·멤버 캘린더)

## Jira
- [GROMO-319]() — 그룹 설정탭
- [GROMO-320]() — 초대 코드 권한별 노출·공유 / 설정 OWNER 전용 조회 API 연동
- [GROMO-379]() — 공지 작성 권한 부여 및 수정/삭제
- [GROMO-380]() — 그룹 탈퇴 flow
- [GROMO-381]() — 방장 위임

## 변경 유형
FEAT

## Summary
그룹 상세 화면의 설정탭을 전면 구현하고, 백엔드 신규 API(설정 조회/수정, 공지 권한, 탈퇴, 위임, 챌린지 시간 포맷·생성·삭제)에 맞춰 프론트를 연동했습니다.
또한 멤버 카드를 눌렀을 때 뜨는 멤버 캘린더 뷰를 드래그 가능한 바텀시트로 새로 구현하고, 챌린지 시간창을 그룹 타임존 기준으로 처리하도록 글로벌 대응했습니다.

## Changes

### 그룹 설정탭 (GROMO-319)
- 설정탭 진입 시 하단 탭바 숨김 및 헤더 UI 개선, 설정 항목 순서 정리
- 그룹 채팅 비활성화 시 하단 탭바에서 채팅 탭 숨김
- 그룹 이름·한줄소개 변경 시 UI 즉시 반영
- 그룹 채팅 설정 및 하위 옵션(1인당 채팅 횟수 제한 등) 토글 연동
- group room refresh 기능 추가

### 설정/권한 API 연동 (GROMO-320)
- 설정값을 OWNER 전용 `GET /api/v1/groups/{groupId}/settings`에서 로드하도록 연결 (비방장은 group 상세 폴백 유지)
- `PATCH /settings`로 chatEnabled·chatLimitPerPerson·noticePermission·invitePermission·noticeGrantedUserIds 변경
- 초대 코드 권한(invitePermission)별 노출 및 공유 기능 구현
- 초대 코드 만료 시 "만료됨" 표시 및 재발급 버튼 추가 (`POST /api/v1/groups/{groupId}/code`)

### 공지 권한·수정/삭제 (GROMO-379)
- 공지 등록 API 연동
- 공지 수정/삭제 기능
- 공지 작성 권한 부여(멤버 선택 모달) 연동

### 그룹 탈퇴 / 방장 위임 (GROMO-380, GROMO-381)
- 위험 구역 "그룹 탈퇴" → `DELETE /api/v1/groups/{groupId}/members/me`
- OWNER 탈퇴 시: 마지막 1인이면 그룹 닫힘 안내, 멤버가 있으면 위임 멤버 선택 후 탈퇴
- 권한 설정에 "방장 위임하기" 추가 → `PATCH /members/{memberId}/owner` (멤버 1명일 땐 숨김)
- `isOwner` 판정을 초대코드 노출 여부가 아닌 `members[].role === 'OWNER'` 기준으로 교정

### 챌린지 (시간 포맷·생성·삭제·타임존)
- 챌린지 응답 `windowStart`/`windowEnd`가 `"HH:mm:ss"` 문자열로 변경된 것에 대응
- 그룹 타임존 기준 진행중/예정 판정 및 시간 라벨 표시 (`utils/challengeTime.js` 추가)
- 챌린지 생성 API 연동 (`POST /challenges`, `timeZone` 포함, OWNER 전용)
- 챌린지 삭제 UI 및 API 연동 (`DELETE /challenges/{id}`, OWNER 전용)

### 멤버 캘린더 뷰
- 멤버 카드 탭 시 뜨는 멤버 캘린더 뷰 생성 (월별 집중시간·챌린지 달성 히트맵)
- RN `Modal` 기반 드래그 바텀시트로 구현 — 끌어올리면 전체화면, 끝까지 내리면 닫힘
- 날짜 칸 정사각형화, 상단 요약을 "이달 집중 / 연속 챌린지 달성"으로 정리
- 날짜 칸 탭 시 해당 날짜 집중 시간 하단 표시

## DB 변경
없음 (프론트엔드 전용 변경)

## 주의사항
- 챌린지 시간창은 **그룹 타임존 고정** 정책으로 처리됩니다. 표시·판정 모두 그룹 타임존 기준이며, `Intl` 미지원 환경에서는 기기 로컬로 폴백합니다.
- "연속 챌린지 달성" 요약은 현재 표시 중인 달 내 최장 연속 일수 기준입니다. (전체 기간 연속 기록은 백엔드 미제공으로 추후 연동 예정)
