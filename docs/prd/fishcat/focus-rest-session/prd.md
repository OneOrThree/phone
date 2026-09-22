# 집중·휴식 세션 PRD

> GROMO-1763 · 2026-09-12 · 설계 초안 / 미결 정책은 [policy.md](policy.md) · [문서 안내](README.md)

## 목적과 범위

집중은 낚시, 휴식은 모닥불이다. 한 사용자가 여러 기기를 쓰더라도 진행 세션은 하나다.
앱 재실행 시 active이면 낚시, paused이면 휴식 화면을 복구한다. 네트워크 재시도와 종료 경합이
집중 기록·물고기 보상·초기 건설 기여를 중복시키지 않아야 한다.

모닥불을 구경하는 섬 홈 모달(GROMO-1850)은 이 화면 계약이 아니고, 서버가 휴식 주민으로 싣는 「세션 없는 공유 휴식」도 현재 정본에 없다 — planning-document 개정 뒤 별도 티켓으로 정한다. 집중 중 휴식 이동은 pause 성공 뒤에만 연출한다.
종료 확인창 취소·화면 닫기·회전은 finish 명령을 보내거나 돈을 쓰는 동작이 아니다.
목표 시간을 채웠다는 사실과 사용자의 종료 확정은 분리한다. 목표 도달만으로 자동 종료/보상하는 계약은 없다.

| 원본 ID | 채택 method/path | 구현 티켓 |
| --- | --- | --- |
| start | POST `/focus-sessions` | 1764 |
| session | GET `/focus-sessions/current` | 1764 |
| pause | POST `/focus-sessions/{sessionId}/pause` | 1764 |
| resume | POST `/focus-sessions/{sessionId}/resume` | 1764 |
| finish | POST `/focus-sessions/{sessionId}/finish` | 1764 |
| home-summary | GET `/me/focus-summary` | 1764 |
| focus-group | GET `/islands/{islandId}/focus-members` | 1765 |
| rest-members | GET `/islands/{islandId}/rest-members` | 1765 |
| emote | STOMP SEND `/app/islands/{islandId}/focus/emotes` | 1765 |

스냅샷 이후 `/topic/islands/{islandId}/focus`, `/rest`, `/emotes`를 구독한다. emote 목적지는
원본 POST `/v1/islands/{islandId}/emotes`를 사용자 결정으로 대체한 것이며 REST 우회 endpoint를 만들지 않는다.
시작·휴식·재개·종료는 영속 쓰기이므로 STOMP SEND로 옮기지 않는다.
GROMO-1998는 원본 9계약에 서버 크론 `rest-auto-close`와 결과 1회 제공 계약(`GET /focus-sessions/pending-result`, `POST /focus-sessions/{sessionId}/acknowledge`)을 더한다.

## 사용자에게 보이는 결과

- 혼자 만든 섬에서도 바로 집중한다. 친구 초대·2명 이상·회관/게시판 해금을 시작 조건으로 추가하지 않는다.
- 시작 시 본인이 현재 소속된 섬과 세션의 islandId를 고정한다. active/paused 중 현재 섬 이동을 금지한다.
- 서버의 activeSeconds와 serverNow를 기준으로 표시한다. active만 화면에서 시간을 이어 세고 paused는 고정한다.
- 오늘 요약은 종료 기록의 오늘 몫과 진행 세션의 오늘 몫을 한 번씩 더한다. 휴식은 어느 쪽에도 들어가지 않는다.
- 종료 결과의 earnedFish와 allocation은 서버가 확정한 값이다. 앱이 목업 비율로 계산해 지갑에 더하지 않는다. (allocation 의 배분은 2026-09-19 재영님 결정 D5-귀속-개정으로 **섬 통장 100%** 다 — `personalFishAdded` 는 0, `constructionFishAdded` 가 earnedFish 전부. ~~2026-09-18 D5-귀속의 개인 50% + 섬 통장 50%~~ 는 대체됐다. **2026-09-21 재화-단일로 이 배분은 영구 계약이다** — 재화는 섬 단위 하나이고 개인 물고기 지갑이 없어 조정할 비율 자체가 없다. `personal_share_percent` 를 올리는 경로를 두지 않는다. 두 필드는 호환으로 유지한다.)
- 집중 주민에게 보이는 필드는 이름·과목·누적 시간·고양이/배 외양이다. 타인의 물고기 수·지갑·토큰을 노출하지 않는다.
- 응원 5종(hello/cheer/sleepy/laugh/hearts)은 같은 섬에서 **집중 세션을 진행 중(active 또는 paused)인** 발신자와 수신자 사이에서만 흐른다 — 휴식 중에도 보내고 받는다(2026-09-20 결정: 휴식은 빠진 상태가 아니라 모닥불에 앉은 상태다). 표시 TTL은 3초다. 세션이 완료·포기된 뒤에는 흐르지 않고, 만료되거나 재접속한 응원을 재생하지 않는다.
- 휴식 중에도 채팅은 차단되고, STOMP CONNECT 전체는 막지 않는다.
- 휴식 시작 1시간 후에는 서버가 세션을 정상 완료하고 다음 접속에서 결과창을 한 번 제공한다(GROMO-1998).

## 완료 조건

| 영역 | 구현 검증 기준 |
| --- | --- |
| 원본 9계약 + 1998 추가 3표면 | 원본 예시 보존, 새 UUID 타입·오류·스냅샷 확장은 LLD에 구분. `rest-auto-close`·`pending-result`·`acknowledge`는 GROMO-1998 계약 |
| 수명주기 | 동시 2기기 start 한 번, pause/resume/finish의 상태·버전 경합 명확 |
| 순수 시간 | 정확한 ACTIVE 구간 합, KST 자정 분할, paused·미래 시간·중복 합산 차단 |
| 적립·정산 | **적립은 진행 중 매분 틱**이 섬 통장·적립 원장에 넣고(2026-09-20 결정 D5-적립), 종료 TX 는 날짜 기록·정산 행·receipt·outbox 만 같은 Data TX 로 묶는다 — finish 추가 지급 없음 |
| 재시도 | 같은 키/같은 본문 원 성공 재생, 다른 본문409, 다른 키의 완료 finish도 도메인 정산 중복 없음 |
| 실시간 | snapshot/subscription race·역순·재연결·권한 철회·개별 projection version 검증 |
| 호환 | 기존 `/api/v1/focus-session*` 경로/업로드 의미 유지, 구 writers가 새 세션을 종료·재지급하지 못함 |
| live 조회 호환 | 기존 랭킹/표시 reader가 신규 ACTIVE 구간을 인식. pause 동안 불변·resume 후 증가·finish 전후 순수 초 동일·진행/완료 이중 계상 없음 |
| 완료 조회·앱 호환 | 완료 목록의 순수 합계·주간값·논리 최장 세션·시간표/복원이 ACTIVE만 사용. 최소 호환 앱과 다기기/다운그레이드 접근 경계 또는 검증된 projection 준비 전 신규 활성화 금지. REST를 방해 초로 대체하지 않음 |
| 배포·롤백 | 신규 비활성 호환본 전량 배포 → 실제 rollback 최소 호환 baseline 이동·구 이미지 차단 검증 → 신규 활성화. active/paused 상세를 유지하는 호환 rollback 검증 |
| 출시 정책 | 남은 FR-D06 결정과 설정 검증. 산식은 1830 확정(60초당 1마리 — 2026-09-18 D5 승격)이며 설정 revision 으로 주입한다. 보상 귀속(D5-귀속-개정 섬 통장 100%)·강퇴(FR-D03·FR-D03-기지급)·휴식 채팅 차단(FR-D04)·응원 TTL/빈도(FR-D05)·지급 시점과 하루 경계(2026-09-20 D5-적립 — 분당 적립·UTC 창)는 **확정**됐고 지급 경로가 열려 있다. FR-D02 는 D6 로 폐기 — [결정 로그](../decision-log.md) |

완료하지 않는 것: BFF 화면 계약, 퀘스트/시설/지갑의 독립 제품 정책, 기존 코인→물고기 승계,
클라이언트 화면 구현, 비공개 파일 지원, 세션 없는 공유 휴식의 서버 상태/API. 화면 집계는 재료 구현 뒤 GROMO-1784~1787에서 연결한다.
