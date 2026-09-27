# GROMO-1976 신고·차단 구현 계획

기준: 2026-09-27 `origin/main` (`4f93dd91`)

## 목표

사용자가 친구 또는 받은 편지의 발신자를 신고·차단할 수 있고, 서버가 신고 대상의 원문과 열람 권한을 다시 확인한 뒤 `nappaegonoljima@gmail.com` 운영 메일함에 정형 신고를 남긴다. 차단은 양방향 직접 교류를 즉시 막고, 설정에서 목록 조회와 해제를 제공한다.

## 이번 단계

| 진입점 | 대상 | 동작 |
| --- | --- | --- |
| 친구 목록 `···` | 친구 프로필 | `신고하기`, `차단하기`, 기존 `친구 삭제` |
| 받은 편지 상세 `···` | 편지 원문과 발신자 | `편지 신고`, `발신자 차단` |
| 신고 시트 | 서버가 검증할 대상 ID | 사유, 선택 설명, 선택 답장 이메일, `이 사용자도 차단`(기본 꺼짐) |
| 설정 → 안전 | 내가 차단한 사용자 | 목록, 빈 상태, 해제 |

## 데이터 흐름

```text
앱 UserSafetySheet
  ├─ 차단 ──────────────> POST /blocks
  │                         └─ Data user_blocks
  └─ 신고(requestId) ───> POST /reports
                            ├─ Data report_deliveries에서 payload fingerprint·lease 선점
                            ├─ Data에서 친구/편지와 원문·권한 재검증 후 메일 snapshot 고정
                            ├─ 운영 메일 발송 + 사건 ID로 메일함 검색 확인
                            ├─ 선택 시 POST internal blocks
                            └─ 완료 receipt 저장·재시도 재생

Data 쓰기 경계
  친구 요청 생성 ─┐
  친구 요청 수락 ─┤
  편지 발송 ──────┴─> 같은 pair lock에서 양방향 user_blocks 존재 시 FORBIDDEN
```

클라이언트가 보낸 닉네임이나 편지 본문은 증거로 사용하지 않는다. 메일 본문은 Data 응답에서 확인한 값만 사용한다. `requestId`와 사건 ID는 재시도 시 같은 값을 사용하고 메일 헤더에 함께 남긴다.

## 메일 계약

- 수신: `nappaegonoljima@gmail.com`
- 발송: Gmail SMTP (`smtp.gmail.com:587`, STARTTLS)
- 확인: 같은 계정 IMAP (`imap.gmail.com:993`)에서 사건 ID 헤더를 검색한다.
- SMTP STARTTLS와 SMTP/IMAPS 서버 인증 검사를 필수로 강제하고, 확인 poll은 한 IMAP 연결을 재사용한다.
- 자격은 `REPORT_MAIL_USERNAME`, `REPORT_MAIL_APP_PASSWORD` 환경변수로만 주입한다.
- 자격이 없거나 메일함 검색 확인이 실패하면 API는 접수 성공을 반환하지 않는다.
- 테스트는 로컬 가짜 메일 게이트웨이로 원문/멱등/동시 차단을 검증하고, 자격이 있는 환경에서 별도 실발송 스모크 테스트를 수행한다.

## 서버 일관성

1. 차단 관계는 `(blocker, blocked)` 방향으로 저장하지만 직접 교류 판정은 양방향이다.
2. 친구 요청과 편지 발송은 활성 사용자 확인 뒤, 새 쓰기 직전에 양방향 차단을 확인한다.
3. 신고와 동시 차단은 메일함 확인 후 차단한다. 메일은 접수됐지만 차단이 실패한 재시도에서는 같은 사건 ID를 검색해 메일을 중복 생성하지 않고 차단만 다시 시도한다.
4. 같은 신고 키는 정규화 payload fingerprint에 결합한다. 동시 요청은 DB lease로 한 작업자만 발송하고, 다른 payload 재사용은 409로 거절한다.
5. 사용자별 신규 신고는 시간당 10건으로 제한한다.
6. 차단 목록이 초기 로딩 중이거나 실패하면 클라이언트는 친구·검색·편지·낙서를 fail-closed로 숨기고 재시도를 제공한다.
7. 메일 처리 중 lease를 주기적으로 갱신하고 IMAP 확인은 60초 이하로 제한한다. 접수 확인 즉시 메일 본문·회신 이메일 snapshot을 지우며, 24시간 중단 건과 탈퇴 연관 개인정보도 멱등 행을 보존한 채 정리한다.

## 테스트

```text
서버
  ├─ 친구 요청: A→B / B→A 차단 각각 거절, 무차단 성공
  ├─ 편지 발송: A→B / B→A 차단 각각 거절, 행 미생성
  ├─ 신고: 인증, 입력 검증, 서버 원문 사용, 사건 ID, 메일 확인 실패
  └─ 신고+차단: 기본 off, 선택 on, 재시도 중복 메일 방지

앱
  ├─ blocks/reports API 요청 계약
  ├─ 신고 시트: 기본값, 기타 사유 설명 필수, 연타 방지, 오류 복구
  ├─ 친구 메뉴: 신고/차단/삭제 연결
  ├─ 편지 상세: 신고/차단 연결
  └─ 차단 목록: 로딩/빈 상태/오류/해제 후 재조회
```

## 후속 단계

채팅·공지·댓글·닉네임·섬 이름/소개·공개 퀘스트 제목은 `email-intake-contract.md`가 요구하는 작성자/수정자, 필드별 리비전, 불변 스냅샷 토큰이 서버 응답에 먼저 생긴 뒤 같은 `UserSafetySheet`에 연결한다. 실시간 fanout과 푸시의 전달 직전 차단 fence도 별도 서버 계약으로 연결한다.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | 미실행 |
| Outside Review | — | Independent 2nd opinion | 0 | — | 미실행 |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR | 서버 원문 검증, 양방향 직접 교류 차단, 메일함 확인, 단계 분리 반영 |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | 미실행 |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | 미실행 |

**VERDICT:** ENG CLEARED — 이번 단계 구현 가능

NO UNRESOLVED DECISIONS

## 구현·검증 현황 (2026-09-27)

- 구현 완료: 친구/받은 편지 `···`, 공통 신고·차단 시트, 차단 목록·해제, `/reports`, 서버 원문 재검증, 영속 신고 intent/lease/receipt, Gmail SMTP 발송 후 IMAP 확인, 양방향 친구 요청 생성·수락·편지 발송 차단, nginx·배포 시크릿 전달.
- 클라이언트 필터 완료: 세션별 차단 ID snapshot을 공용으로 적재하고, 차단/해제 성공 즉시 친구·요청·검색·받은/보낸 편지·열린 편지·섬 우체통 메시지·우체통 친구 캐시를 재조회 전부터 숨긴다. 늦은 목록 GET이 새 차단을 덮지 못하도록 mutation revision fence를 두고, 최초 목록 실패 때는 민감 데이터를 fail-closed로 숨긴다.
- 검증: Business 전체 build와 신고 계약 테스트, Data 신고 workflow·친구·편지 PostgreSQL 통합 테스트, 컴파일·Checkstyle·SpotBugs, 앱 전체 85 suites/953 tests와 타입·포맷 검사가 통과했다.
- UI 증거: `.gstack/browse-reports/2026-09-27-gromo-1976/screenshots/`에 설정 진입 → 차단 목록 → 친구 `···` → 신고 메뉴 → 신고 접수 직전 5단계 모바일 캡처를 저장했다. 브라우저 콘솔 오류는 0건이다.
- 실메일: `REPORT_MAIL_USERNAME`/`REPORT_MAIL_APP_PASSWORD`가 현재 환경에 없어 운영 메일함 실발송은 실행하지 않았다. `REPORT_MAIL_LIVE_TEST=true`와 두 자격을 주입하면 `GmailReportMailGatewayLiveTest`가 `nappaegonoljima@gmail.com` 발송과 IMAP 검색을 한 번에 확인한다.
- 범위: 채팅·공지·댓글·닉네임·섬 텍스트·퀘스트와 realtime/push fence는 위 「후속 단계」대로 아직 포함하지 않는다.
