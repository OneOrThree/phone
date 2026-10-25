# 집중 부하 실패와 실행 소유 복구 원장

GROMO-2420은 부하 하네스의 관측과 복구를 변경한다. 제품의 `409` 정책은 유지한다. 운영 8 cycles/s 시험의 최초 원인은 재현으로 확정되지 않았으므로 Cloudflare, 저장 유실, 제품 상태 전이를 원인으로 단정하지 않는다.

## 실행과 소유 범위

`aws-capacity.py`의 `--run-id`는 UUID다. 집중 시작마다 별도 journey UUID를 만들고 `subject=lt:<run UUID>:<journey UUID>`를 보낸다. 공개 원장에는 `fixture-1` 같은 순서 별칭을 사용한다. 선택된 집중 계정은 서로 다른 `userId`와 token, 유효한 사용자/섬 UUID가 필요하다.

전송 전에 기록한 start intent, run/journey/fixture 별칭, 전체 fixture의 순서·userId/token/islandId/role SHA-256, GET current의 정확한 marker·islandId·sessionId·version을 함께 확인한다. 이미 응답으로 확인한 sessionId가 있으면 같은 ID만 소유로 인정한다. fixture 파일의 내용이나 순서를 바꾼 채 복구를 이어가지 않는다. 지문은 자격 증명의 해시이며 원문 자격은 공개 산출물에 들어가지 않는다.

사전 정리는 GET만 한다. 기존 집중이 있으면 부하를 시작하지 않는다. 사후 정리도 다른 실행의 세션을 종료하지 않는다. 같은 run marker라도 start 원장이 없거나 소유 증거가 불완전하면 `UNKNOWN`으로 보존하고 정리 완료로 표시하지 않는다.

## 응답 유실과 재시도 계약

| 관측 | 후속 동작 | 결과 해석 |
|---|---|---|
| start 저장 후 응답 유실 | current에서 이번 run/journey의 세션 확인 후 종료 | 원래 cycle 실패, 종료 HTTP 확인은 별도 기록 |
| finish 전송 실패 또는 5xx, 같은 세션·버전 유지 | 원래 멱등키와 정확히 같은 본문을 최대 한 번 재전송 | 첫 실패를 지우지 않으며 새 키를 만들지 않음 |
| finish 저장 후 응답 유실, current=null | 추가 쓰기 없이 해당 VU 격리 | 정산 `UNKNOWN`, 서버 원장 대조 필요 |
| finish 4xx 또는 current 버전 변경 | 추가 종료 쓰기 없음 | 원인/정산 대조 필요 |
| current가 다른 세션/실행 | 해당 세션 보존, VU 격리 | 현재 cycle은 성공 아님 |

동일 키·본문 재생 계약은 `server/data-api/.../outbox/service/PublicCommandService.java`와 `FocusSessionLifecycleService.finish`를 따른다. 시작·휴식·재개 명령을 맹목적으로 재시도하지 않는다. finish 응답의 `recordId`가 확인한 세션 ID와 같을 때만 HTTP 종료 확인으로 기록한다. 이는 DB/보상/Outbox의 독립 대조를 대신하지 않는다.

자식 runner와 혼합 감독자는 사후 정리의 key/version/전송 여부 checkpoint를 공유한다. 감독자가 새 키로 같은 종료를 반복하지 않으며, timeout에도 이미 기록한 checkpoint를 보존한다. `focus-ledger-final.json`은 감독자 정리 결과까지 반영한다.

## 산출물과 판정

- `*-http-diagnostics.jsonl`: step, run/journey/fixture 별칭, 요청 ID, HTTP/API/전송 오류 코드, 허용 형식 CF-Ray·응답 요청 ID. 응답 원문·전체 헤더·token·사용자 UUID·URL을 쓰지 않는다.
- `*-focus-ledger.json`: 단계별 시작/완료/성공 cycle, HTTP 성공, 종료 HTTP 확인, 최초 오류와 후속 409, 미확인 정산.
- `focus-cleanup-before.json`, `focus-cleanup-after.json`: 사전 읽기 확인, 실행 소유 사후 정리·잔류 ACTIVE·미확인 결과.
- `focus-ledger.json`, 혼합의 `focus-ledger-final.json`: 해당 실행 원장과 최종 정리 결과. `serverLedger.status=NOT_COLLECTED`이면 실 DB/Outbox를 검증한 결과가 아니다.

단계 판정은 원시 focus counter와 단계 원장의 시작/완료/성공/HTTP 수를 대조한다. 원장 누락, 미확인 정산, VU 격리, 종료 미확인은 PASS가 될 수 없다. 신호 중단은 PARTIAL로 남는다. 성공 cycle과 개별 HTTP 성공 수는 서로 다른 지표다.

기본 집중 SLO 확인은 `--journey-p95-limit 1000`, 한계 탐색은 명시적으로 `--journey-p95-limit 5000`을 사용한다. 공용 CLI 기본 지연값은 기존 500ms를 유지한다. 집중 결과의 `configuredVerdict`와 `baselineVerdict`(1초), `sloProfile`을 함께 읽는다. 5초 탐색 PASS를 1초 기본 SLO PASS로 표시하지 않는다.

## 서버 원장 대조

`scripts/focus-ledger-audit.sql`은 exact fixture UUID JSON과 run UUID를 입력하는 읽기 전용 PostgreSQL 템플릿이다. 운영에는 자동 실행하지 않는다. 최종 부하 종료·사후 정리 후 같은 실행 범위를 동결해 읽기 전용 DB 연결로 실행하고, 원장 수치와 함께 보관한다. 이 변경에서 실제 운영 DB/Outbox 대조와 5/8 cycles/s × 60초 × 각 3회 재시험은 수행하지 않았다.

| 하네스 근거 | 서버 대조 축 |
|---|---|
| `lt:<run>:<journey>`, fixture UUID | `focus_session_details.subject`, `user_id`, `session_id` |
| 종료 HTTP의 `recordId` | `focus_settlements.session_id`, 상세의 `COMPLETED` |
| 잔류 집중 | 상세 `ACTIVE`/`PAUSED`, 열린 `focus_session_intervals` |
| 보상 | `focus_reward_accruals.session_id`; 짧은 cycle의 0 보상도 정상일 수 있음 |
| 집중/휴식 투영 전달 | `event_outbox.params.sessionId` → session_id, `event_outbox_deliveries.outbox_id` → outbox.id |

`FocusMemberEvents`의 subject_id는 **섬 ID**이고 aggregate는 `(섬, 사용자)`다. 이를 집중 세션 ID로 조인하지 않는다. 종료 투영의 `params.status=completed`는 포기 등에서도 발생할 수 있으므로 정산 성공은 `focus_settlements`와 상세 lifecycle을 함께 확인한다. 템플릿은 집중/휴식 투영 사건만 집계하며 다른 보상 사건 전체의 전달을 증명하지 않는다. 보상 중복은 원장 키·금액 및 시간 적립 정책을 추가 대조해야 한다.

## 로컬 검증

저장소 루트에서 실행한다. HTTP 시험은 `127.0.0.1` 임시 서버만 사용하고 실제 k6/Node가 필요하다.

```sh
node --test loadtest/tests/test_focus_journey.mjs loadtest/tests/test_ws_evidence.mjs
python3 -m unittest discover -s loadtest/tests -p 'test_*.py' -v
```

응답 유실 3경로, current null/foreign, 저장 직후 SIGINT, 같은 키·본문 재생 상한, 다른 실행 보존, fixture 변경, 진단 유실, 감독자 timeout/자식 실패 및 정상 혼합 공통창을 확인한다. 로컬 서버의 정산·Outbox 모형 검증을 실제 서비스 DB 검증으로 해석하지 않는다.
