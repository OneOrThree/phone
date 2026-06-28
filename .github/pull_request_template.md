# PR 제목 형식
  [{유형}] GROMO-{번호} {변경 내용 한 줄 요약}

  유형: FEAT / FIX / CHORE / REFACTOR

  예시)
  [FEAT] GROMO-206 인게임 재화 관리 기능 구현
  [FIX] GROMO-232 TAG 삭제 시 FocusSession cascade 삭제
  [CHORE] GROMO-203 디렉토리 구조 변경
  [REFACTOR] GROMO-210 FocusService 로직 분리

얘는 제목 하고 날리기
  ---

밑에 항목은 앵간 하면 다 채우고, AI가 써주니까 조금 더 자세하게 본인 업무에 맞춰서 쓰기

  ## Jira
  - [GROMO-{티켓번호}]()

  ## 변경 유형
  <!-- FEAT / FIX / CHORE / REFACTOR 중 선택 -->

  ## Summary
  <!-- 무엇을 왜 바꿨는지 2-3줄로 -->

  ## 커밋 목록
  <!-- 이 PR에 포함된 커밋 제목들 (git log main..HEAD --oneline) -->
  -

  ## Changes
  <!-- 변경된 내용을 자유롭게 작성 -->

  ## 빌드/배포 영향
  <!-- app 변경 시. 해당되는 것만 남기고 나머지 삭제 -->
  - [ ] 네이티브 변경(ios/·새 플러그인/모듈) → `pod install` + 새 TestFlight 빌드 필요
  - [ ] JS만 변경 → OTA 가능(네이티브 빌드 불필요)
  - [ ] 새 의존성 추가 → `npm install` 필요
  - [ ] 새 환경변수(EXPO_PUBLIC_*) → .env/.env.example/CI/EAS 반영 필요: `____`
  - [ ] 권한·entitlements 변경(App Groups 등) → 프로비저닝 재발급 필요

  ## DB 변경 (백엔드)
  <!-- back 스키마 변경 있으면 작성, 없으면 삭제 -->

  ## 주의사항
  <!-- 마이그레이션, 사이드 이펙트, 리뷰어가 알아야 할 것. 없으면 삭제 -->
