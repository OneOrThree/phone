# AI 넛지 — 구현 학습 노트

> "이걸 만들면 뭐가 어떻게 굴러가는가"를 모듈 단위로 이해하기 위한 문서.
> 기획의 정본은 [`../prd.md`](../prd.md) — 여기서는 **어떻게**만 다룬다.

## 읽는 순서

| # | 문서 | 한 줄 |
| --- | --- | --- |
| 1 | [01-big-picture.md](01-big-picture.md) | 전체 파이프라인 5단계 — **새로 만드는 건 사실상 한 칸뿐이다** |
| 2 | [02-data-pipeline.md](02-data-pipeline.md) | 사용 시간이 아이폰에서 서버까지 오는 길 — 그리고 못 넘어오는 것들 |
| 3 | [03-rule-engine.md](03-rule-engine.md) | 판정 엔진 — 9개 게이트를 순서대로 통과해야 알림 1건 |
| 4 | [04-delivery.md](04-delivery.md) | 발송 — 판정을 통과해도 3개 필터가 더 남아 있다 |
| 5 | [05-ai-basics.md](05-ai-basics.md) | AI 기초 — 모델 학습·LLM·RAG가 실제로 뭘 하는 물건인지 |
| 6 | [06-phase2.md](06-phase2.md) | 2차 설계 — AI가 파이프라인 어디에 끼는지, 뭐부터 만들면 되는지 |
| 7 | [07-llm-api-benchmark.md](07-llm-api-benchmark.md) | LLM은 API로 쓴다 — **채점지를 먼저 만드는** 개발 루프 (시험지·벤치마크·임팩트 측정) |

1~4가 **1차(규칙 기반)** 의 전부다. 5~7은 2차를 위한 예습이다.

읽다가 "실제로 어떻게 도는지" 보고 싶으면 [`../ui.html`](../ui.html) — 판정 규칙이
실제로 돌아가는 시뮬레이터다. 알림이 잠금화면에 뜨는 모습은 [`../screens/`](../screens/)에
PNG로 있다.

## 다이어그램

각 문서에 박힌 그림은 `diagrams/*.svg`(GitHub 렌더용)이고, 같은 이름의
`*.drawio`가 편집 원본이다. [draw.io](https://app.diagrams.net)에서 열어 고친 뒤
SVG를 다시 내보내면 된다.
