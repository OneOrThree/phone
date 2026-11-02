---
description: Run the backend local CI gate (Checkstyle + SpotBugs + tests) and summarize only failures
argument-hint: "[선택: 테스트 필터, 예: --tests '*CurrencyServiceTest']"
allowed-tools: Bash, Read, Grep
---

CI 가 돌리는 검사를 로컬에서 같은 순서로 돌려, 푸시 전에 CI 가 거절할 것을 먼저 잡는다.
CI 는 `.github/workflows/data-api-ci.dev-v2.yml` 이 `be-gradle.yml` 을 불러
`SPRING_PROFILES_ACTIVE=ci` 로 Gradle `build`(Checkstyle · SpotBugs · test · bootJar)를 돈다.

순서:
1. 저장소 루트에서 `server/data-api/norm.sh $ARGUMENTS` 를 실행한다.
   - Checkstyle → SpotBugs → test + bootJar 순으로 돌고, 한 단계가 실패하면 그 종료 코드로 멈춘다. 뒤 단계는 돌지 않는다.
   - 검사 태스크마다 `--rerun` 이 붙는다. 로컬은 `build/` 가 남아 있어 소스가 그대로면 Gradle 이 UP-TO-DATE 로 건너뛴다.
     도커·Testcontainers 가 고장 나도 입력 해시는 같아 아무 검사도 안 돈 채 초록이 되므로,
     `./gradlew checkstyleMain spotbugsMain test` 를 직접 부르지 않는다.
   - 테스트는 Testcontainers 로 PostgreSQL 을 직접 띄운다. Docker 가 꺼져 있으면 `norm.sh` 가 먼저 멈춘다 —
     Docker 를 켜라고 알리고 끝낸다. 데이터소스는 일부러 죽은 포트로 고정돼 있어, 호스트 DB 에 기대는 테스트가 여기서 먼저 드러난다.
   - 인자는 `test` 태스크의 필터로만 간다. 필터를 준 실행은 전체 게이트가 아니다 — 푸시 전에는 인자 없이 다시 돌린다.
   - data-api 밖을 바꿨으면 `server/<service>/norm.sh`(business-api · realtime · notification)를, 전부는 `server/norm.sh` 를 쓴다.
2. **실패한 것만** 묶어서 보고한다. 멈춘 단계와, 그 때문에 돌지 않은 단계를 먼저 적는다.
   - **Checkstyle**: 위반마다 `file:line — rule — message`. 리포트는 `server/data-api/build/reports/checkstyle/main.html` (+ `main.xml`).
   - **SpotBugs** (effort=max, HIGH 만): 발견마다 클래스/메서드와 버그 패턴. 리포트는 `server/data-api/build/reports/spotbugs/main.html`.
   - **Tests**: 실패한 테스트마다 단정/예외. 리포트는 `server/data-api/build/reports/tests/test/`,
     JUnit XML 은 `server/data-api/build/test-results/test/`.
3. 실패마다 한 줄짜리 구체적 수정안을 준다.
4. 전부 통과하면 초록이라고만 말하고 끝낸다 — 더 설명하지 않는다.

커밋·푸시·수정은 하지 않는다. 읽기·검증 전용이다.
