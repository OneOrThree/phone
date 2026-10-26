# release 브랜치 보호

정책은 `.github/release-protection.json`, 조회·계획·적용은 `.github/scripts/release-protection.py`가 관리한다. 코드 변경은 main에 먼저 통합하고 운영 승격은 `AGENTS.md`의 main → release 규칙을 따른다.

## 정책

| 설정 | 기준 |
|---|---|
| PR 요구 | 관리자 포함. 승인 인원 기본 0명이며 기존 더 강한 승인·코드오너 조건은 유지 |
| PR 우회 허용 | 사용자·팀·앱의 명시적 우회 허용 목록을 비움 |
| 대화 해결 | 필수 |
| force push·브랜치 삭제 | 금지 |
| 선형 이력 요구 | 사용하지 않음. main 부모를 남기는 merge commit을 허용해야 함 |
| required checks·push 제한 | 기존 값을 보존. 이번 변경으로 Android 검사나 release 전용 gate를 새로 필수 지정하지 않음 |

GitHub의 보호 설정 자체는 PR의 소스 브랜치를 main으로 제한하거나 해당 PR에만 merge 방식을 고정하지 않는다. 운영 승격의 head=main·base=release·merge commit 조건은 기존 `AGENTS.md`와 `.github/scripts/catus-version.py`의 검증을 함께 따른다. 일반 작업 PR의 squash merge 규약은 그대로다.

## 점검과 계획

기본 실행은 GitHub를 조회하고 변경 전 스냅샷·checksum·적용 payload를 저장한다. GitHub 설정은 변경하지 않는다.

```sh
python3 .github/scripts/release-protection.py --output /tmp/release-protection-plan.json
```

저장해 둔 스냅샷으로는 네트워크 없이 계획을 만들 수 있다. 스냅샷에는 `repository`, `branch`, `allow_merge_commit`, `protection`, `rules`가 필요하다. `protection`은 branch protection API 응답 또는 미보호일 때 null이고, `rules`는 현재 적용되는 ruleset 규칙 목록이다.

```sh
python3 .github/scripts/release-protection.py \
  --snapshot /tmp/release-protection-snapshot.json \
  --output /tmp/release-protection-plan.json
```

## 적용

검토한 계획만 `--apply`로 적용한다. 저장소 정책·변경 전 스냅샷 checksum·현재 GitHub 상태가 계획과 일치해야 한다. 활성 ruleset이 있으면 기존 규칙과의 합성 검토 없이 덮어쓰지 않고 중단한다. 적용 후 API를 다시 조회해 payload와 일치하는지 검증한다. 이 명령은 외부 설정을 실제 변경하므로 로컬 구현·테스트 과정에서는 실행하지 않는다.

```sh
python3 .github/scripts/release-protection.py \
  --apply /tmp/release-protection-plan.json \
  --output /tmp/release-protection-after.json
```

설정 적용은 앱 배포나 릴리스 발행을 시작하지 않는다. 적용 결과와 운영 승격 PR의 검증 결과는 Jira에 별도 기록한다.

## 근거

- `AGENTS.md` — main → release 운영 승격
- `docs/conventions/git-pr-conventions.md` — 일반 개발 PR·수동 머지 규칙
- `docs/prd/fishcat/server-separation/deployment.md` — Catus 운영 발행·배포와 승인 환경
- [GitHub branch protection REST API](https://docs.github.com/en/rest/branches/branch-protection#update-branch-protection) — payload·승인 수 0·관리자 적용·merge 이력 설정
