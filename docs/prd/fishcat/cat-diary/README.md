# 고양이 일기

매주 월요일 내 고양이가 지난주를 돌아보는 짧은 일기를 1인칭 반말로 써 준다. 글은 LLM 이 쓰고, 재료(집중·출석·섬 비교)는 서버가 계산한다. 유료 기능이고 무료 체험권을 준다.

- 에픽: GROMO-2859 「[공통] 고양이 일기 v1 — LLM 주간 회고 출시까지」
- 이 폴더의 현재 상태: P0 명세 초안(GROMO-2860). 예시 일기·고정 문구·시험지 씨앗·채점 기준은 Claude 초안이며 재영님 검토 전이다.
- 1.x 때 같은 주제를 설계한 연구가 [`../../gromo/weekly-review/study/`](../../gromo/weekly-review/study/) 에 있다. 원칙 셋(LLM 은 계산하지 않는다, 결측은 0이 아니다, LLM 은 마지막에 붙여도 되는 구조)과 검증 그물·평가 루프를 이어받았다.

## 문서

| 파일 | 내용 |
| --- | --- |
| [prd.md](prd.md) | 무엇을 왜 만드는가, 사용자 장면, 범위, 흐름, 의존, 단계 |
| [policy.md](policy.md) | 고양이의 목소리, 쓰는 것과 쓰지 않는 것, 결측, 개인정보, 보관, 반응·신고 |
| [prompt.md](prompt.md) | 요청 구조, 수치 계약(facts), 시스템 프롬프트, 출력 계약, 버전 관리 |
| [guardrails.md](guardrails.md) | 입력·호출·출력 검사 층, 실패 코드, 재작성과 고정 문구, 규칙 파일 하나를 두 구현이 읽는 법 |
| [eval.md](eval.md) | 시험지, 실행기, 지표와 출시·회귀 관문, 심판 보정, 운영 감시, 제품 지표 |
| [cost.md](cost.md) | 3사 가격, 일기 1편 비용, 체험권 정책별 월 비용, 구독 수익 |

## 계약 파일 (`spec/`)

서버(Java)와 평가 실행기(Python)가 이 파일들을 그대로 읽는다. P3(GROMO-2867)에서 `server/data-api/src/main/resources/cat-diary/` 로 옮기고 이 자리에는 링크만 남긴다.

| 파일 | 내용 |
| --- | --- |
| [spec/facts.schema.json](spec/facts.schema.json) | LLM 입력 수치 계약 `cat-diary-facts/1` (JSON Schema 2020-12) |
| [spec/output.schema.json](spec/output.schema.json) | LLM 출력 계약 `cat-diary-output/1` |
| [spec/system-prompt.v0.txt](spec/system-prompt.v0.txt) | 시스템 프롬프트 v0. `{{EXAMPLES}}` 자리에 예시가 들어간다 |
| [spec/examples.v0.json](spec/examples.v0.json) | few-shot 예시 3쌍(좋은 주·줄어든 주·첫 일기) |
| [spec/templates.v0.json](spec/templates.v0.json) | 고정 문구 12개(활동 있는 주 8, 활동 없는 주 4)와 고르는 규칙 |
| [spec/guard-rules.json](spec/guard-rules.json) | 출력 가드 규칙 G1~G7 과 실패 코드 24개 |
| [spec/guard-golden.jsonl](spec/guard-golden.jsonl) | 가드 기준 출력 40건(통과 10, 실패 30)과 기대 판정 |
| [spec/golden-facts.json](spec/golden-facts.json) | 기준 출력 세트가 가리키는 수치 5건 |

## 평가 (`eval/`)

| 파일 | 내용 |
| --- | --- |
| [eval/cases/](eval/cases/) | 시험지. 지금은 씨앗 5건(seed-01~05). P1 에서 40건으로 늘린다 |
| [eval/rubric.md](eval/rubric.md) | 심판·사람 공통 채점 항목 R1~R9 와 사람 평가 1~5점 기준 |

## 단계와 티켓

| 단계 | 티켓 | 내용 | 넘어가는 관문 |
| --- | --- | --- | --- |
| P0 | GROMO-2860 | 이 폴더의 명세 | 재영님이 시험지·채점 기준·예시를 읽고 승인 |
| P1 | GROMO-2861 · 2862 | 평가 실행기·가드 판정기, 3사 8개 모델 비교 → 모델·프롬프트 v1 | 하네스 자체 검사 통과, 심판-사람 일치 90% 이상 |
| P2 | GROMO-2863 · 2864 · 2865 · 2866 | 서버·앱 뼈대(고정 문구 일기만으로 끝까지 동작). P0·P1 과 병행 | dev 에서 고정 문구 일기가 푸시 → 열람까지 동작 |
| P3 | GROMO-2867 · 2868 | LLM 어댑터·Java 가드·Batch·예산 가드, API 키 | [eval.md](eval.md) §3 출시 관문 |
| P4 | GROMO-2869 · 2870 · 2871 | 운영 감시, 개인정보 처리방침, 허용 목록 2주 → 체험권 공개 | 첫 2주 운영 지표 정상 |

구독 결제(IAP)는 이 에픽 밖이다. 결제가 생기기 전에는 허용 목록과 체험권으로만 운영한다.
