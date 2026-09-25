# 게시판 정책

[색인](README.md) · [상세 설계](low-level-design.md)

## 유지 규칙과 기술 선택

| ID | 규칙 | 상태·근거 |
| --- | --- | --- |
| B01 | 읽기(공지 목록·상세·댓글)는 방문자·가입 대기자도 읽기 전용으로 허용, 댓글·공지 쓰기는 주민만. 둘 다 게시판 완공 후 접근(미완공은 방문자에게도 BOARD_LOCKED) | 원본6계약. **2026-09-19 결정 V-읽기(GROMO-1904·1937)**로 방문자 거절에서 바뀜. 시설 정본은 Data |
| B02 | 기존 공지는 OWNER 또는 announcement_permission=ALLOW가 작성·수정·삭제 가능하고 타인 공지도 대상 | main GroupAnnouncementService/GroupMember. legacy 실제 동작 보존 — **이 새 API 에는 더 적용되지 않는다(B03 참조)** |
| B03 | ~~신규 공지 권한은 B02 그대로~~ → **재확정(2026-09-25 재영님 결정 GROMO-2136, D9 를 이 새 API 한정으로 대체)**: 공지 작성·수정·삭제는 **방장(OWNER)만**. `announcement_permission=ALLOW` 주민도 이 새 API 에서는 거절된다. legacy `/api/v1` 공지는 D9 그대로(방장 + ALLOW 주민, 타인 공지도 대상) — 두 API 가 같은 저장소를 다른 규칙으로 쓴다 | [권한 행렬](../island-management/permissions.md) 「공지 작성/수정/삭제」 행. `IslandNoticeService.requireHost` 구현 |
| B04 | 공지 작성자 user는 nullable이며 탈퇴 후 공지 보존이라는 기존 의도를 유지 | 실제 nullify/지연 UPDATE 차단은 계정1756/1757과 함께 구현해야 함 |
| B05 | 공개 body는 기존 content에 매핑. 제목 상한100 UTF-16 단위와 공백 거절 유지 | 기존 CreateAnnouncementRequest. 본문/댓글 신규 상한은 BQ03 |
| B06 | 신규 PATCH는 title/body 중 하나 이상 제출, 생략은 유지·null/빈값 거절. 둘 다 보내는 원본도 허용 | 부분 변경의 기술 선택. legacy PUT의 두 필드 필수는 보존 |
| B07 | 4개 쓰기에는 UUID Idempotency-Key 필수. 동일 키/의미 본문은 원 결과, 다른 본문409 | 공통1750. 공지PATCH에 expectedVersion을 새 필수로 추가하지 않음 |
| B08 | 공지 자체와 댓글 변화가 같은 notice.version을 증가. 댓글 저장/count/버전/outbox/receipt 같은 TX | 이벤트1754의 무효화 key와 일치. 삭제 사건 버전도 내구화 |
| B09 | 목록은 createdAt DESC,id DESC, 댓글 페이지는 createdAt ASC,id ASC | 안정적인 동률 정렬의 기술 선택. 커서 actor/island/notice/filter 결박 |
| B10 | 현재 인가 없는 원 결과 재생 금지. 비활성 계정은404 USER_NOT_FOUND | 공통 제한 재생 예외를 이 도메인에 임의 확대하지 않음 |
| B11 | 댓글 삭제는 **작성자 본인 또는 방장**만 — **확정(2026-09-25 재영님 결정 GROMO-2136, BQ02 §① M-2)** | [댓글 결정표](../island-management/permissions-open-questions.md) §4.5. `IslandNoticeService.requireCommentDeletable` 구현 |

## 결정 완료 (2026-09-25 재영님 결정 GROMO-2136)

| ID | 확정 값 |
| --- | --- |
| BQ01 | ~~공지 신규 권한 행렬~~ → B03 참조(D9 는 이 새 API 한정으로 **방장만**으로 재확정) |
| BQ02 | ① 삭제 주체 = 작성자 본인 또는 방장(B11) ② 공지 삭제 시 댓글 = **함께 삭제**(DB `ON DELETE CASCADE`, V103) ③ 탈퇴 후 댓글 원문 = **보존하지 않음**(삭제, `GroupAnnouncementCommentRepository.deleteAllOfUser`) — 공지 자체(작성자만 detach)와는 다르다 ④ 댓글 DELETE endpoint = **이번 범위에 포함**(GROMO-2137) |
| BQ03 | 제목 100 UTF-16, 본문 5000 UTF-16, 댓글 500 UTF-16 — `island-board.notice-body-max-length`·`island-board.comment-max-length` |

정책 미답을 빈 댓글/가짜 commentCount0 또는 임의 권한으로 숨기지 않는다. 기술 수치인 페이지 기본30/최대100은 정책상의 게시물 제한이 아니며 성능 검증으로 조정 가능하다. 쓰기 스위치(`island-board.writes-enabled`) 기본값은 결정 완료 뒤에도 OFF 로 남는다 — prod 개방은 별도 릴리스 결정이고, dev 는 `ISLAND_BOARD_WRITES_ENABLED` 로 켠다.
