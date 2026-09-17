# 우체통 편지방 정책

[색인](README.md) · [상세 설계](low-level-design.md)

## 유지 규칙과 기술 선택

| ID | 규칙 | 상태·근거 |
| --- | --- | --- |
| M01 | 섬 하나의 전체 편지방. 현재 주민·우체통 완공 필요, 방문자/1:1 수신자 없음 | 원본2계약 |
| M02 | 새 GET/POST /islands/{islandId}/messages는 Business 공개 ingress, 메시지 정본은 기존 gromo_chat | DB 공유/메시지 Data 복제 금지. realtime 개명과 DB이름 변경은 별개 |
| M03 | 기존 /api/v1/chat·/ws/chat와 STOMP SEND wire 유지 | 사용자 기존경로 보존. 새 POST가 이미 배포됐다는 뜻 아님 |
| M04 | clientMessageId는 UUID36자, v4/v7 생성 권고. actor+island+키로 저장1회 | 원본 local-1은 목업. 공통1750, DB UNIQUE 재사용 |
| M05 | 신규 같은키/같은 정규화text는 원 메시지 재생, 다른text409 IDEMPOTENCY_KEY_REUSED field=clientMessageId | legacy STOMP의 다른본문에도 원문 반환 동작은 별도 어댑터로 보존. 일반 receipt와 중복 권위 금지 |
| M06 | 최신 묶음부터 과거 방향 cursor; 화면은 한 묶음 안에서 오름차순 | 저장 UUID 순서가 안정 tie-breaker. sentAt만으로 전체 전송 순서 보장하지 않음 |
| M07 | 원본 신규 DTO/이벤트에 읽음/안읽음 없음. 기존 본인 unread 계산과 상대 읽음 영수증은 구별 | 기존 DB 삭제 여부는 MQ01. 새 read endpoint 추가 없음 |
| M08 | 기존 집중 중 chat 차단을 보존. 공통 realtime CONNECT에는 집중 가드를 붙이지 않음 | 집중/휴식 구독·emote를 함께 막지 않기 위한 분리. 신규 message 제한 세부는 MQ02 |
| M09 | 메시지 커밋 뒤 fanout, 재연결은 최신 history로 페이지 캐시를 재초기화. UUID/known ID를 커밋 완료 watermark나 완전 gap 복구 근거로 쓰지 않음 | 이벤트1754. DB/TCP 원자성·Redis 무손실·내구 outbox 이미 구현 주장 금지 |
| M10 | 텍스트 strip 후 비어 있음·NUL·2000 UTF-16 초과 거절 | 기존 ChatMessageService 동작 유지. 원본text에 매핑 |
| M11 | 과거 메시지 원문과 senderId는 기존 보존 의도 유지, 이름/외양 영구 사본을 새로 저장하지 않음 | 기존 ChatMessage 문서: 탈퇴 후 메시지 보존·표시는 알 수 없음. 계정파기/비노출 배선은 후속 구현 의존 |

## 결정 대기와 출시 조건

| ID | 미결 정책 | 권고·경계 |
| --- | --- | --- |
| MQ01 | 본인 unread 배지/위치 복원 유지 여부 | 상대 읽음 UI와 분리해서 결정. 신규 payload에는 읽음 없음을 유지하고 기존 cursor table/API를 임의 삭제하지 않음 |
| MQ02 | 새 우체통의 집중·휴식 중 목록/과거조회/발신/실시간 수신 각각의 허용, 이미 열린 화면 전환 | 기존 chat 차단 유지 결정만으로 REST/PAUSED까지 답을 만들어내지 않음. 답 전 새 우체통 ingress/채널 활성화 금지 |
| MQ03 | 탈퇴·섬 이탈 작성자의 프로필 표시와 원문 내 개인정보 대응 | 기존 탈퇴자 알 수 없음 표시는 유지 기준. 신규 nullable display와 실제 파기·차단 원칙은 LLD, 새 원문 보존 기간/자동 삭제 정책은 별도 승인 필요 |

본인 unread는 peer에게 보내는 읽음 영수증이 아니다. M07을 근거로 chat_read_cursors DROP이나 legacy unreadCount 제거를 수행하지 않는다. 인가·키·cursor·REST 어댑터는 독립 구현 가능하나 미답 정책을 우회해 신규 서비스를 열지는 않는다.

현재 history는 조회된 페이지 범위의 저장 이력을 복구한다. 모든 지연 커밋·누락 사건의 무손실 자동 복구는 별도 커밋 가시성 기반과 모든 writer·이벤트·앱 검증이 필요한 기술 gate다. 고정 overlap/단순 sequence로 완료를 주장하지 않는다.
