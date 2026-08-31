# AGENTS.md — 앱(프론트엔드)

Codex(및 기타 코딩 에이전트)용 `app/app-dev/` 하위 규칙. 저장소 전역 규칙은 루트 `AGENTS.md`,
코드 컨벤션 상세는 `.claude/CLAUDE.md` 참고.

## 빌드 · 배포

앱을 빌드하거나 배포(TestFlight · 안드로이드 릴리즈 · OTA)하기 전에
**`.claude/DevRunbook.md` 를 먼저 읽는다.** 환경 세팅, `ios/testflight.sh`,
`scripts/android-release.sh`, hot-updater OTA 절차와 과거 사고 사례가 전부 거기에 있다.

- 새 머신에 필요한 비추적 파일(`.env*`, Firebase plist, 서명 자산) 목록 →
  DevRunbook "새 팀원 인수인계 체크리스트" 절.
- 릴리즈 번들에는 빌드 시점의 `EXPO_PUBLIC_*` 가 그대로 인라인된다. `testflight.sh` 는 셸 export
  로 서버·환경 축을 강제하지만 **OTA 배포에는 그 보정이 없다** — 배포 전 `.env.local` 을 확인할 것.
