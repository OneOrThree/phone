---
name: pr-loop
description: PR 을 열 때, 리뷰 지적을 처리할 때, 머지해도 되는지 판단할 때 쓴다. @claude 리뷰 요청·감시 절차와 머지 4조건 판정 스크립트가 있다.
---

# pr-loop — PR 리뷰 루프

규칙(브랜치·제목·본문·라벨·리뷰·머지 조건·지적 처리 표)의 정본은 [git-pr-conventions.md](../../../docs/conventions/git-pr-conventions.md)다. 이 스킬은 그 규칙을 돌리는 절차와 판정 도구만 담는다. 같은 저장소의 main → release 승격 PR 은 이 루프를 쓰지 않는다. 사람이 `/prod-release` 로 진행한다.

## 도구

둘 다 조회만 한다. 저장소는 이 체크아웃의 `gh` 기본 저장소다.

- `python3 .claude/skills/pr-loop/scripts/pr_state.py <번호>` — 머지 4조건을 head 커밋 하나에서 판정한다. 네 줄이 모두 `OK` 면 exit 0, 하나라도 `NO` 거나 조회가 실패하면 exit 1. 요약 줄에 head 전체 SHA 가 있다.
- `python3 .claude/skills/pr-loop/scripts/pr_state.py --watch <목록 파일>` — 목록의 PR 을 90초마다 보고, 상태가 바뀐 PR 만 한 줄 낸다. 머지·닫힘은 한 번 알리고 목록에서 뺀다. 목록이 비면 끝난다.

## 절차

1. **연다.** 정본 「메타데이터」 절의 `gh pr create` 한 줄로 연다. 완료 조건: `gh pr view <번호> --json isDraft,assignees,labels` 가 draft 아님·담당자 본인·정본 표와 맞는 라벨을 보인다.
2. **같은 턴에 `@claude` 리뷰를 요청한다.** 이 PR 의 위험 지점 3~5개를 번호로 적은 댓글 하나를 단다. `@claude` 는 리뷰를 요청하는 댓글에만 쓴다. 답글에 쓰면 워크플로가 다시 돈다. 완료 조건: `claude[bot]` 댓글이 생겼다.
3. **같은 턴에 감시를 건다.** 저장소 밖 임시 파일(세션 스크래치패드 등)에 번호를 한 줄 적는다. Monitor 로 `python3 .claude/skills/pr-loop/scripts/pr_state.py --watch <그 파일>` 을 `timeout_ms` 1800000 으로 돌린다. 만료 알림이 오면 같은 명령으로 다시 건다. 완료 조건: 그 PR 의 첫 상태 줄이 왔다.
4. **라운드를 처리한다.** 상태 줄이 바뀌면 지적을 읽는다. 인라인 지적은 `gh api --paginate repos/{owner}/{repo}/pulls/<번호>/comments`, claude 는 `**Claude finished` 댓글의 산문이다. 처리는 정본 「리뷰 루프」의 표를 따른다. 지적마다 그 스레드에 답글을 단다 — 고쳤으면 고친 커밋을, 고치지 않으면 판단을 적는다. 고친 것은 push 한다(새 라운드가 돈다). 완료 조건: 상태 줄의 ① 이 `OK(0건)` 이다.
5. **판정한다.** `pr_state.py <번호>` 를 돌린다. ② 가 claude 완료로만 OK 면 그 댓글 산문에 남은 지적이 없는지 읽는다. 스크립트는 산문을 판정하지 않는다. 완료 조건: exit 0 이고, 출력 다섯 줄을 보고에 붙였다.
6. **머지는 정본 「머지 조건」이 정한 사람이 한다.** 에이전트가 머지할 때는 5의 head 로 고정한다: `gh pr merge <번호> --squash --match-head-commit <요약 줄의 head SHA>`. 운영에 닿는 PR 이면 `.claude/prod-impact.py` 가 확인창을 띄운다. 완료 조건: 감시 줄이 `MERGED … — 목록에서 뺐다` 를 냈다.

## 판정 읽는 법

| 리뷰어 | 판정 | 판정이 아닌 것 |
| --- | --- | --- |
| codex | 요약 댓글(`<!-- codex-pull-request-review-summary -->`)의 `codex-review-state` 가 head SHA 를 `status: completed`·`has_any_findings: false` 로 끝냈다 | 상태의 커밋이 head 가 아니다(재리뷰 전). `status: failed`(사용 한도 초과 등). 지적은 인라인 댓글로 온다 |
| claude | `**Claude finished` 로 시작하는 댓글 | `**Claude encountered an error after Ns`. 댓글 수와 `updated_at` 은 실패에도 바뀌므로 첫머리로 가른다 |

- 판정은 최신 head 커밋에 대한 것만 센다. 스크립트는 codex 를 커밋 SHA 로, claude 를 head 커밋 시각으로 가른다.
- PR 본문의 codex 👍 는 요약 상태가 없는 PR 에서만 판정이다(정본 「머지 조건」). 상태 줄에는 개수만 보인다.
- push 뒤 codex 재리뷰는 보장되지 않는다. 상태 줄에 `codex 옛 커밋` 이 남으면 `@claude` 요청 댓글을 새로 하나 단다. codex 는 손으로 부르지 않는다(정본 「리뷰 루프」).

## claude 가 0초에 실패할 때

- 신호는 상태 줄의 `마지막 오류 0s(인증 거절 의심)` 이다.
- 확인: 그 댓글의 「View job」 실행 번호로 `gh run view <id> --log` 를 열고 `"type": "result"` 블록을 본다. `total_cost_usd: 0`·`modelUsage: {}` 면 인증 단계에서 거절됐다. 토큰 만료가 흔하다.
- 복구는 저장소 관리자가 한다: `claude setup-token` 으로 토큰을 만들고 `gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo OneOrThree/phone` 으로 넣는다. 그 뒤 `@claude` 요청 댓글을 새로 단다.
- 복구 전에도 codex 판정만으로 ② 는 OK 가 된다.

## 함정

- 네 조건은 같은 커밋에서 동시에 성립해야 한다. push 하면 ②·③ 을 다시 판정한다.
- `gh api` 목록은 30건에서 잘린다. 댓글·지적은 `--paginate` 로 읽는다. 스크립트는 그렇게 읽는다.
- ④ `UNKNOWN` 은 GitHub 가 병합 가능성을 계산하는 중에도 나온다. 열린 PR 이면 잠시 뒤 다시 본다. 머지된 PR 은 늘 `UNKNOWN` 이다.
- base 가 main 이 아닌 PR(에픽 피처 브랜치 등)에서는 서버·앱 CI 가 돌지 않는다. 그 PR 의 ③ 은 상시 검사만 본다([PR 대상에 따른 서버 CI 정책](../../../docs/engineering/pr-ci-policy.md)).
- 스크립트 한계: 리뷰 스레드와 CI 검사는 100개까지 본다. 넘으면 NO 로 알린다. claude 는 head 커밋 시각과 비교하므로, 오래전에 만든 커밋을 나중에 push 하면 그 사이의 옛 판정이 섞인다.
