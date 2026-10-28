<!--
제목: [TYPE] GROMO-#### 한 줄 요약   (TYPE ∈ FEAT / FIX / CHORE / REFACTOR)
  예) [FEAT] GROMO-206 인게임 재화 관리 기능 구현
      [FIX] GROMO-232 TAG 삭제 시 FocusSession cascade 삭제
담당자 = 본인, 라벨 정확히 1개(FEAT→enhancement · FIX→bug · REFACTOR→refactoring · CHORE→documentation|workflow|test), draft 금지.
구현 티켓만 GROMO-#### 전체 키, 참조 티켓은 「티켓 455」처럼 번호만.
정본: docs/conventions/git-pr-conventions.md
-->

## Jira
- [GROMO-####](https://romance.atlassian.net/browse/GROMO-####)

## 변경 유형
<!-- FEAT / FIX / CHORE / REFACTOR 중 하나 -->

## Summary
<!-- 무엇을 왜 바꿨는지 2~3줄 -->

## 커밋 목록
<!-- git log origin/main..HEAD --oneline -->
-

## Changes
<!-- 변경 내용. 판단이 갈렸던 지점은 「왜」를 적는다 -->

## 빌드/배포 영향
<!-- app/** 변경 시만. 해당 항목만 남기고 나머지 삭제. app 변경 없으면 섹션 삭제 -->
- [ ] 네이티브 변경(ios/ · 새 플러그인/모듈) → `pod install` + 새 TestFlight 빌드 필요
- [ ] JS만 변경 → OTA 가능(네이티브 빌드 불필요)
- [ ] 새 의존성 추가 → `npm install` 필요
- [ ] 새 환경변수(EXPO_PUBLIC_*) → .env / .env.example / CI / EAS 반영 필요: `____`
- [ ] 권한·entitlements 변경(App Groups 등) → 프로비저닝 재발급 필요

## DB 변경 (백엔드)
<!-- 스키마 변경 시만 — 마이그레이션 파일(V<N>__desc.sql)과 schema.dbml 반영을 적는다. 없으면 섹션 삭제 -->

## 주의사항
<!-- 마이그레이션 순서, 사이드 이펙트, 리뷰어가 알아야 할 것. 없으면 섹션 삭제 -->
