# 고양이 일기 프롬프트 설계

> 상태: P0 초안(GROMO-2860). 프롬프트 원문은 [spec/system-prompt.v0.txt](spec/system-prompt.v0.txt), 예시는 [spec/examples.v0.json](spec/examples.v0.json) 이 정본이다. 이 문서는 구조와 이유를 적는다.

## 1. 요청 구조

- **요청 1번에 일기 1편**이다. 대화도 도구 호출도 없다.
- `system`: 고정 지시문 + 예시 3편. 모든 사용자에게 같은 바이트라 캐시되는 앞부분이다. 시각·사용자 정보 같은 바뀌는 값은 넣지 않는다.
- `user`: `<facts>` 블록 하나. 안에는 [spec/facts.schema.json](spec/facts.schema.json) 을 통과한 JSON 한 개만 있다.
- 사용자가 쓴 글은 어디에도 넣지 않는다. 그래서 프롬프트 주입 통로가 없다.
- 샘플링 값(temperature·top_p)은 보내지 않는다. Claude 최신 API 는 이를 거부하고, 다른 회사도 기본값으로 둔다.
- 생각(thinking·reasoning)은 각 모델이 허용하는 가장 낮은 단계로 둔다. 짧은 글이라 깊은 생각이 필요 없고, 생각 토큰은 출력 단가로 과금된다. 회사별 설정은 §8.
- `max_tokens` 는 2,000 이다. 본문 450자와 생각 토큰을 넉넉히 덮는다. 이 값에 걸려 잘린 응답은 실패다(가드 L1).

## 2. 수치 계약 `cat-diary-facts/1`

서버가 한 사용자의 한 주(KST 월 00:00 ~ 다음 월 00:00)로 만든다. **숫자는 전부 표시 문자열**이다. LLM 은 계산하지 않고 옮겨 적기만 한다.

```json
{
  "schema": "cat-diary-facts/1",
  "week_label": "11월 둘째 주",
  "is_first_diary": false,
  "focus": { "total": "7시간 20분", "days": "5일", "best_weekday": "목요일",
             "best_day_total": "2시간 10분", "trend": "up", "trend_amount": "1시간 40분" },
  "attendance": { "days": "6일" },
  "island": { "rank_band": "상위 20%", "fish_in": "320마리", "events": ["도서관이 완공됐다"] },
  "screen_time": null,
  "highlights": ["목요일에 이번 달 가장 오래 집중했다", "우리 섬이 상위 20%에 들었다"],
  "missing": ["screen_time"]
}
```

| 필드 | 서버가 만드는 법 | 없을 때 |
| --- | --- | --- |
| `week_label` | 그 주 월요일이 속한 달 + 그 달의 몇 번째 월요일인지. 예: 2026-11-09 → 「11월 둘째 주」 | 늘 있다 |
| `is_first_diary` | 그 사용자의 `cat_diaries` 에 앞선 행이 없으면 true | 늘 있다 |
| `focus.total` | 그 주에 끝난 집중의 ACTIVE 합. 도서관 내 일기장 주간 보기와 같은 계산(`IslandRecordsService.focus`, scope=me)을 쓴다. 분 단위로 내리고 「N시간 M분」으로 쓴다 | 1분 미만이면 `focus: null` |
| `focus.days` | 집중이 있었던 KST 날짜 수 | — |
| `focus.best_weekday` · `best_day_total` | 가장 많이 집중한 날과 그날 합. 같으면 앞선 요일 | — |
| `focus.trend` · `trend_amount` | 지난주 합과 비교. 지난주 기록이 없으면 `none`. 차이가 10분 미만이거나 지난주의 10% 이내면 `same`. 아니면 `up`·`down` 이고 `trend_amount` 는 차이의 절댓값 | `none`·`same` 이면 `trend_amount: null` |
| `attendance.days` | 출석 기록(GROMO-2855)의 그 주 출석일 수 | 출석 기능 전이거나 기록이 없으면 `null` + `missing` 에 `attendance` |
| `island.rank_band` | 같은 주 범위로 섬마다 「섬 집중 초 ÷ 지금 주민 수」를 내고(`FocusSessionDetailRepository.sumIslandActiveSeconds`, `GroupMemberRepository.countByGroupIdIn` — `island_focus_averages` 와 같은 모수), 살아 있는 전체 섬 중 위치를 상위 10·20·30·50% 구간으로 자른다 | 상위 50% 밖이면 `null`. 섬이 없으면 `island: null` |
| `island.fish_in` | 그 주 섬 통장에 들어온 물고기 합 | 0이면 `null` |
| `island.events` | 그 주에 완공된 건물, 처음 달성한 섬 퀘스트를 고정 문장으로. 최대 3개. 조사(이/가)는 서버가 건물 이름에 맞춘다 | 빈 배열 |
| `screen_time.daily_avg` · `trend` · `trend_amount` | 측정 앱 사용 시간의 하루 평균. 그 주에 측정된 날이 4일 이상일 때만 측정된 날로 평균을 낸다. 비교 규칙은 `focus.trend` 와 같다 | 측정된 날이 4일 미만이면 `null` + `missing` 에 `screen_time` |
| `highlights` | 아래 규칙을 위에서부터 보고 맞는 것을 최대 3개 고른다. 첫 항목이 일기의 중심이다 | 최소 1개 |

`highlights` 규칙(위가 먼저):

1. 첫 일기 → 「처음으로 한 주를 함께 보냈다」
2. `focus: null` → 「이번 주에는 낚시섬을 쉬어 갔다」
3. `island: null` → 「섬 없이 바다에서 집중했다」
4. 그 주 최장일이 이번 달 최장일 → 「{요일}에 이번 달 가장 오래 집중했다」
5. `focus.trend` 가 `down` → 「바쁜 주에도 {focus.days} 낚시섬에 왔다」
6. `rank_band` 가 상위 10%·20% → 「우리 섬이 {rank_band}에 들었다」
7. 출석 7일 → 「일주일 내내 섬에 들렀다」
8. `island.events` 의 첫 문장
9. 아무것도 없으면 → 「{요일}에 가장 오래 집중했다」

`highlights`·`events` 문장에 숫자를 쓸 때도 표시 문자열을 쓴다. 한글 수사(「세 번」)는 쓰지 않는다. 쓰면 LLM 이 그 말을 옮기다 가드 G2 에 걸린다.

## 3. 시스템 프롬프트 v0

원문: [spec/system-prompt.v0.txt](spec/system-prompt.v0.txt). 규칙마다 막으려는 것은 이렇다.

| 블록·규칙 | 막으려는 것 | 기계 검사 |
| --- | --- | --- |
| 목소리 | 존댓말, 해설자 말투, 이모지, 옛 용어 | G3·G5·G6 |
| 1 숫자 그대로 | 반올림·단위 변환·계산 실수 | G2 |
| 2 사용자에 대해 지어내지 않기 | 시간대·과목·횟수·기분 같은 거짓 사실 | 심판 R2 |
| 3 missing 은 말하지 않기 | 「출석 0일」처럼 결측을 0으로 말하기 | G4 |
| 4 비교 금지, rank_band 만 | 주민 비교, 낮은 순위 노출 | G3·G4 |
| 5 꾸짖지 않기 | 줄어든 주의 압박 | G3, 심판 R3 |
| 6 진단·약속 금지 | 건강 조언, 앱 기능·결제 약속 | G3, 심판 R4 |
| 7 highlights 첫 항목 | 어느 주에나 붙는 덕담 | 심판 R1 |
| 8~11 섬 없음·집중 없음·스크린타임 방향·첫 일기 | 상황에 안 맞는 문장 | G4, 심판 R7·R9 |
| 형식 | 너무 짧거나 긴 글, 마지막 바람 누락 | G1, 심판 R8 |

## 4. 예시 넣는 방식

`{{EXAMPLES}}` 자리에 예시 3편을 이 모양으로 넣는다. 예시의 수치는 시험지와 겹치지 않는다.

```
<facts>{ facts JSON 한 줄 }</facts>
<diary>{ output JSON 한 줄 }</diary>
```

예시 3편: 좋은 주(EX-1), 줄어든 주(EX-2), 첫 일기(EX-3). 모델은 예시의 말투와 길이를 따라 한다. 그래서 예시를 바꾸면 회귀 시험을 다시 돌린다. 예시를 그대로 베낀 글은 가드 G7 이 잡는다.

## 5. 출력 계약

- JSON `{ "title", "body", "mood" }` 하나. 스키마: [spec/output.schema.json](spec/output.schema.json).
- 3사의 구조화 출력(JSON Schema 강제)을 켠다. 회사가 지원하지 않는 키워드(`minLength`·`maxLength` 등)는 보낼 때 빼고, 가드 G1 이 다시 본다.
- 스키마는 모양만 보장한다. 내용은 가드와 심판이 본다.
- LLM 의 mood 는 `happy`·`proud`·`calm`·`sleepy` 넷이다. `missing` 은 활동 없는 주의 고정 문구 전용이다.

## 6. 언어

- v1 은 한국어만이다. 앱 언어가 영어인 사용자는 영어 고정 문구 일기를 받는다. 영어 고정 문구는 GROMO-2863 에서 쓴다.
- 영어 LLM 일기는 영어 시험지로 출시 관문을 따로 통과한 뒤에 연다.

## 7. 재작성 요청

가드에 걸리면 한 번만 다시 쓰게 한다. 같은 `system` 과 같은 `<facts>` 뒤에 `<retry>` 한 줄을 붙여 **새 요청**을 동기로 보낸다. 앞선 답은 넣지 않고, 어긴 규칙과 문제가 된 조각만 알린다. 실패 코드마다 붙이는 줄은 정해져 있다.

```
<retry>지난 답은 규칙 1을 어겼다: 「440분」은 facts 에 없다. 규칙을 지켜 처음부터 다시 써라.</retry>
```

| 코드 | 붙이는 줄 |
| --- | --- |
| G1_* | 형식 규칙: 제목 20자 이내, 본문 250~450자, 2~4문단 |
| G2_NUMBER_NOT_IN_FACTS | 규칙 1: 「{조각}」은 facts 에 없다 |
| G2_KOREAN_NUMERAL | 규칙 1: 숫자를 한글로 풀어 썼다 |
| G3_* | 해당 규칙(5·6·4·목소리): 「{낱말}」은 쓰지 않는다 |
| G4_* | 규칙 3·4·8: 「{낱말}」은 이번 facts 에서 말할 수 없다 |
| G5_* · G6_* | 목소리 규칙: 반말·1인칭 「나」, 이모지 없음, 느낌표 1개까지 |
| G7_* | 형식 규칙: 예시나 지난 일기를 베끼지 않는다 |

## 8. 회사별 호출 설정

정확한 파라미터 이름은 P1(GROMO-2861) 에서 각 회사 공식 문서와 공식 SDK 로 확인하고 이 표를 고친다.

| 회사 | 생각 | 구조화 출력 | Batch | 그 밖 |
| --- | --- | --- | --- | --- |
| Claude | Opus 5.5 는 생각을 끌 수 없어 effort `low`. Sonnet 5.5 는 `thinking: between_tools`, Haiku 5.5 는 `disabled` | `output_config.format` | Message Batches(Claude API, Claude Platform on AWS. Bedrock 은 없음) | 거절(`stop_reason: refusal`)을 확인한다. Opus 5.5·Sonnet 5.5 는 서버 쪽 대체 모델(`fallbacks`)을 켠다 |
| OpenAI | 가장 낮은 reasoning effort | JSON Schema 응답 형식 | Batch API | codex 모델은 쓰지 않는다 |
| Gemini | 가장 낮은 thinking 단계 | 응답 스키마 | Batch Mode | 유료 등급만 쓴다 |

## 9. 버전 관리

- 프롬프트·스키마·가드 규칙·예시·고정 문구는 저장소의 파일이다. DB 나 백오피스에서 즉석으로 고치지 않는다.
- `prompt_version` = 「v{번호}+{spec 파일 묶음 해시 앞 8자}」. 일기 행마다 이 값을 적는다. 고정 문구 대체율이 튀면 어느 버전부터인지 바로 찾는다.
- 프롬프트·예시·모델을 바꾸려면 PR 을 열고 [eval.md](eval.md) §4 회귀 시험을 통과해야 한다.
- 모델 ID 는 고정된 이름을 쓴다. 회사가 같은 이름의 모델을 바꾸면 회귀 시험을 다시 돌린다.
