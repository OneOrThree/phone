# 친구·편지 API 설계

GROMO-1893. **설계 문서이며 구현·배포 완료가 아니다.**

친구는 이미 구현돼 있다 — `server/data-api`의 `friend` 패키지(`FriendController` 7종 + `PinController`
3종, `FriendService`, `Friendship`/`PinnedUser` 엔티티, 전용 `FriendErrorCode`)와 `friendships`·
`pinned_users` 테이블이 `V1__baseline.sql`부터 존재한다. 이 문서의 친구 부분은 **새로 설계하지
않는다** — `/api/v1` 접두 제거(B16)와 화면 조합용 이름 재확인, 그리고 기존에 없던 **요청 취소** 1종
추가가 전부다. **편지(1:1 letter)는 코드·스키마·문서 어디에도 없는 신규 도메인**이라 이 문서가
정식 설계를 처음 남긴다.

| 문서 | 역할 |
| --- | --- |
| [HLD](high-level-design.md) | 기존 친구 구현 매핑표, 편지 데이터 모델, 화면 연결, 알림·실시간 |
| [LLD](low-level-design.md) | 계약별 상세(요청/응답/에러코드), Flyway 마이그레이션 계획, 탈퇴 처리 |

## 범위

- **친구**: 기존 10개 엔드포인트를 무접두 경로로 재노출(B25·B26 이름 규칙). 동작은 바꾸지 않는다.
  신규는 보낸 요청 취소(`friend-cancel`) 1종뿐.
- **편지**: 1:1 편지 전송·목록(편지함)·상세 조회. 데이터 모델·상태 전이·커서 규칙·알림 경로를
  신규 설계한다. 친구 관계가 있는 상대에게만 보낼 수 있다(§2).
- **화면 연결**: `/screens/friends`(친구 목록·요청)와 `/screens/mailbox`(편지함 조각. 우체통의
  실시간 공개 메시지는 [island-mailbox](../island-mailbox/)가 이미 설계했고 이 문서의 범위가 아니다)가
  부르는 내부 GET을 확정한다.

## 정본 위치

- 화면 조합 정책은 [`docs/prd/bff-screens/policy.md`](../bff-screens/policy.md) B15~B26이 정본이다.
  이 문서는 그 정책 아래에서 **BG10의 친구·편지 부분**(`mailbox`·`friends` 전체, `raft`의 친구 요청
  수)을 해소한다 — BG10의 가입 대기 신청 목록·공동 가계부·물고기 장 조회는 다른 도메인 몫이라 이
  문서가 다루지 않는다.
- 친구 도메인 정본 코드는 `server/data-api/src/main/java/com/oneorthree/phone/friend/`.
- 편지 도메인은 이 설계가 정본이며, 구현 시 `server/data-api/src/main/java/com/oneorthree/phone/letter/`
  패키지(신설)로 들어갈 것을 전제로 경로·클래스명을 적었다.

## 관련 문서

- [친구 화면 조각](../bff-screens/implementation-business-api.md) §4 `friends`·`raft`·`mailbox` 행
- [편지함이 쓰는 내부 GET](../bff-screens/implementation-data-api.md) §2·§4 (BG10 재료 표)
- [우체통 실시간 공개 메시지 LLD](../island-mailbox/low-level-design.md) — 편지와는 다른 도메인(§0 참고)
- [실시간 토픽 7종](../realtime-events/low-level-design.md) §3.1 — 편지는 새 토픽을 쓰지 않는다(HLD §4)
