# 집중·휴식 세션 PRD

> GROMO-1763 · 2026-09-12 · 설계 초안 / 미결 정책은 [policy.md](policy.md) · [문서 안내](README.md)

## 목적과 범위

집중은 낚시, 휴식은 모닥불이다. 한 사용자가 여러 기기를 쓰더라도 진행 세션은 하나다.
앱 재실행 시 active이면 낚시, paused이면 휴식 화면을 복구한다. 네트워크 재시도와 종료 경합이
집중 기록·물고기 보상·초기 건설 기여를 중복시키지 않아야 한다.

모닥불을 구경하는 로컬 화면에는 세션이 필요 없다. 집중 중 휴식 이동은 pause 성공 뒤에만 연출한다.
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

## 사용자에게 보이는 결과

- 혼자 만든 섬에서도 바로 집중한다. 친구 초대·2명 이상·회관/게시판 해금을 시작 조건으로 추가하지 않는다.
- 시작 시 본인이 현재 소속된 섬과 세션의 islandId를 고정한다. active/paused 중 현재 섬 이동을 금지한다.
- 서버의 activeSeconds와 serverNow를 기준으로 표시한다. active만 화면에서 시간을 이어 세고 paused는 고정한다.
- 오늘 요약은 종료 기록의 오늘 몫과 진행 세션의 오늘 몫을 한 번씩 더한다. 휴식은 어느 쪽에도 들어가지 않는다.
- 종료 결과의 earnedFish와 allocation은 서버가 확정한 값이다. 앱이 목업 비율로 계산해 지갑에 더하지 않는다.
- 집중 주민에게 보이는 필드는 이름·과목·누적 시간·고양이/배 외양이다. 타인의 물고기 수·지갑·토큰을 노출하지 않는다.
- 응원 5종은 같은 섬에서 active 집중 중인 발신자와 수신자 사이에서만 흐른다. 만료되거나 재접속한 응원을 재생하지 않는다.

## 완료 조건

| 영역 | 구현 검증 기준 |
| --- | --- |
| 9계약 | 원본 예시 보존, 새 UUID 타입·오류·스냅샷 확장은 LLD에 구분 |
| 수명주기 | 동시 2기기 start 한 번, pause/resume/finish의 상태·버전 경합 명확 |
| 순수 시간 | 정확한 ACTIVE 구간 합, KST 자정 분할, paused·미래 시간·중복 합산 차단 |
| 정산 | 세션 종료·날짜 기록·원장·건설/퀘스트 반영·receipt·outbox 동일 Data TX |
| 재시도 | 같은 키/같은 본문 원 성공 재생, 다른 본문409, 다른 키의 완료 finish도 도메인 정산 중복 없음 |
| 실시간 | snapshot/subscription race·역순·재연결·권한 철회·개별 projection version 검증 |
| 호환 | 기존 `/api/v1/focus-session*` 경로/업로드 의미 유지, 구 writers가 새 세션을 종료·재지급하지 못함 |
| live 조회 호환 | 기존 랭킹/표시 reader가 신규 ACTIVE 구간을 인식. pause 동안 불변·resume 후 증가·finish 전후 순수 초 동일·진행/완료 이중 계상 없음 |
| 배포·롤백 | 신규 비활성 호환본 전량 배포 → 실제 rollback 최소 호환 baseline 이동·구 이미지 차단 검증 → 신규 활성화. active/paused 상세를 유지하는 호환 rollback 검증 |
| 출시 정책 | FR-D01~06의 필요한 결정과 설정 검증. 미정인 산식을 300초로 채워 출시하지 않음 |

완료하지 않는 것: 13개 BFF 엔드포인트, 퀘스트/시설/지갑의 독립 제품 정책, 기존 코인→물고기 승계,
클라이언트 화면 구현, 비공개 파일 지원. 화면 집계는 재료 구현 뒤 GROMO-1784~1787에서 연결한다.
