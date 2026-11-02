---
name: prod-release
description: 운영 V2 서버 출시 — 사전 점검, main → release 승격, 발행, 배포·승인, 확인, 롤백.
disable-model-invocation: true
---

# prod-release — 운영 V2 서버 출시

사람이 부르는 절차다. 운영을 바꾸는 명령은 사람이 실행하거나 확인창에서 승인한다. 정본:

- [prod V2 파이프라인](../../../docs/engineering/prod-v2-pipeline.md) — 발행·배포·복구
- [서비스 배포와 V0 동시 전환](../../../docs/prd/fishcat/server-separation/deployment.md) 「DB 전환이 든 V2 배포」 — 마이그레이션이 든 배포
- [AGENTS.md](../../../AGENTS.md) 「main → release 운영 승격」 — 승격 PR 의 변경 요약

## 1. 사전 점검

1. 받는다: `git fetch origin main release --tags`
2. 승격될 변경의 운영 영향을 요약한다:
   ```sh
   git diff --name-only --no-renames origin/release...origin/main | python3 .claude/prod-impact.py --files --base-ref release
   ```
3. 요약에 「DB 전환이 든 운영 배포」 줄이 있으면 배포에 `allow_migration=true` 와 RDS 스냅샷이 필요하다. 그 문서의 1번(파일별 호환 검토)을 승격 PR 머지 전에 끝낸다. 없이 배포하면 CD 가 `Schema compatibility requires explicit migration plan` 으로 멈춘다.
4. Infra 고정값을 Infra main 과 비교한다. 고정값은 발행 때 릴리스에 들어가므로 바꿀 거면 승격 PR 머지 전에 바꾼다.
   ```sh
   gh variable get CATUS_PROD_INFRA_REVISION_V2
   gh api repos/OneOrThree/cattus-infra/compare/<고정값>...main --jq '.status, .ahead_by'
   ```
   `identical` 이면 고정값이 Infra main 과 같다. `ahead` 면 고정값에 없는 Infra 변경이 있다.

완료 조건: 영향 요약, DB 전환 여부, Infra 비교 결과를 적었다.

## 2. 승격 PR

1. 같은 저장소의 head `main` → base `release` 로 연다. 제목은 최근 승격 PR 과 같은 형식이다: `[CHORE] GROMO-#### 최신 main을 prod-v2 운영 배포 대상으로 승격`. 라벨은 정본 git-pr-conventions 「메타데이터」 절을 따른다(최근 승격 PR: `workflow`·`release:patch`). `@claude` 리뷰는 요청하지 않는다.
2. codex 가 AGENTS.md 규칙대로 「운영 승격 변경 요약」 댓글 하나를 단다. 그 댓글의 기준 SHA 가 지금 head 와 같은지 본다.
3. 사람이 GitHub 에서 **Create a merge commit** 으로 머지한다(CLI 는 `gh pr merge <번호> --merge`). release 보호 때문에 해결 안 된 대화가 하나라도 있으면 머지되지 않는다.

완료 조건: `gh pr view <번호> --json state,mergeCommit` 이 `MERGED` 와 merge 커밋을 보인다.

## 3. 발행

1. release push 에서 `prod-ci-V2` 가 서버 4종을 발행하고 `catus-vX.Y.Z-V2`(patch + 1) 태그를 단다. 확인: `gh run list --workflow prod-ci-V2.yml --branch release -L 1`, `git ls-remote --tags origin 'catus-v*-V2'`.
2. Kafka·Redis 는 자기 워크플로의 `on.push.paths`(설정 묶음 `server/scripts/v2/prod/kafka*`·`redis*` 등)가 바뀔 때만 자동 발행된다. Infra 고정값만 바뀌었으면 자동 발행이 없다. release 에서 직접 돌린다(확인창이 뜬다):
   ```sh
   gh workflow run kafka-ci.prod-V2.yml --ref release
   gh workflow run redis-ci.prod-V2.yml --ref release
   ```
3. 배포할 태그의 `manifest.infra_revision` 이 1-4 에서 정한 Infra 커밋인지 본다. 발행 실행의 산출물에 있다(`catus-app-release-V2`·`catus-kafka-release-V2`·`catus-redis-release-V2`). S3 `versions/<태그>.json` 에도 있다.
   ```sh
   gh run download <발행 실행 id> -n catus-app-release-V2 -D <임시 폴더>
   python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["manifest"]["infra_revision"])' <임시 폴더>/release-V2.json
   ```
4. Kafka·Redis 를 배포하기 전에 호스트에서 도는 이미지 digest 와 레지스트리 digest 를 비교해, 배포가 브로커를 실제로 바꾸는지 본다.

완료 조건: 배포할 태그(서버, 필요하면 Kafka·Redis)와 각 태그의 `infra_revision` 을 적었다.

## 4. 배포

1. 배포할 때만 실행한다. 실행하면 확인창이 뜬다:
   ```sh
   gh workflow run prod-cd-V2.yml --ref release -f version=<서버 태그>
   ```
   DB 전환이 들면 RDS 스냅샷을 만든 뒤 `-f allow_migration=true` 를 더한다(정본 「DB 전환이 든 V2 배포」 3·4번).
2. 실행을 걸었으면 바로 승인한다. 실행 페이지의 Review deployments 에서 환경 `catus-production-V2` 를 승인한다(승인자 중 1명). `app-server-gate.py` 는 release 의 최근 `prod-cd-V2` 실행이 `completed`·`success` 일 때만 통과한다. 승인 대기·거부·실패·취소가 최신이면 다음 성공 실행까지 앱 출시가 막힌다. 거부로는 풀리지 않는다 — 승인해 성공으로 끝낸다.
3. Kafka·Redis 는 `kafka-cd.prod-V2.yml`·`redis-cd.prod-V2.yml` 을 같은 방식으로 `-f version=<태그>` 로 돌리고 승인한다. Redis 비밀번호를 바꿨으면 Redis 를 서버보다 먼저 배포한다.
4. 시크릿만 바뀌었으면 같은 버전으로 다시 실행한다. 서버 env 는 배포할 때 시크릿에서 만든다.

완료 조건: 각 CD 실행이 `completed`·`success` 다(`gh run list --workflow prod-cd-V2.yml --branch release -L 1`).

## 5. 확인

- 승격에 든 PR 하나를 `python3 .claude/skills/deploy-status/scripts/where_is.py <번호>` 로 본다. 운영 서버 줄이 「반영됨」이다.
- `deployment-status` 브랜치의 `prod-V2/app.json` `message` 가 새 태그다.
- Datadog 모니터 `23468982`·`23469020`·`23469271` 이 조용하다(prod-logs 스킬).

완료 조건: 세 가지를 확인했다.

## 6. 롤백

- 이전 태그로 되돌린다. 실행 뒤 4-2 처럼 바로 승인한다:
  ```sh
  gh workflow run prod-cd-V2.yml --ref release -f version=<이전 태그> -f rollback=true
  ```
- 마이그레이션 지문이 지금 성공 기록과 다르면 롤백은 거부된다. 스키마 복구는 정본 「DB 전환이 든 V2 배포」의 실패 항목을 따른다.
- 배포는 성공했는데 `record` 잡만 실패했으면 다시 배포하지 않는다. 그 실행의 `record` 잡만 다시 돌린다(`gh run rerun` 에 확인창이 뜬다).

완료 조건: 롤백 실행이 `completed`·`success` 이고 `prod-V2/app.json` 이 이전 태그다.
