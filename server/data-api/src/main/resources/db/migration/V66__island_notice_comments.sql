-- ════════════════════════════════════════════════════════════════════
-- V66 — 섬 게시판 공지 댓글 + 목록 keyset 인덱스 + 공지 version 백필 (GROMO-1771 · island-board LLD §3·§4)
-- ════════════════════════════════════════════════════════════════════
-- 공지 자체는 legacy group_announcements 를 그대로 쓴다. 새 저장물은 댓글 하나다.
--
-- ── 댓글 FK 는 둘 다 «지우지 않는» 쪽이다 (BQ02 미결) ─────────────────
-- 댓글 삭제·공지 삭제 시 댓글 처리·탈퇴 후 원문 보존(BQ02)이 정해지지 않았다. 그래서 공지가 지워지면
-- notice_id 를, 작성자 행이 지워지면 author_id 를 비울 뿐 댓글 행은 남긴다(ON DELETE SET NULL).
-- CASCADE 로 시작했다가 «보존»으로 결정되면 이미 지워진 원문은 되살릴 수 없다 — 반대 방향은 새
-- 마이그레이션 하나로 좁히면 된다. 쓰기는 결정 전까지 island-board.writes-enabled=false 로 닫혀 있다.
CREATE TABLE group_announcement_comments (
    id         uuid PRIMARY KEY,
    notice_id  uuid REFERENCES group_announcements (id) ON DELETE SET NULL,
    author_id  uuid REFERENCES users (id) ON DELETE SET NULL,
    text       text NOT NULL,
    created_at timestamp(6) with time zone NOT NULL DEFAULT now()
);

COMMENT ON TABLE group_announcement_comments IS
    '섬 게시판 공지 댓글 — 불변. notice_id·author_id 는 BQ02 결정 전까지 ON DELETE SET NULL(행 보존). GROMO-1771';

-- 상세의 댓글 페이지 — (createdAt ASC, id ASC) keyset. 목록의 commentCount 도 이 인덱스로 센다.
CREATE INDEX ix_group_announcement_comments_notice_created
    ON group_announcement_comments (notice_id, created_at, id);

-- 게시판 목록 — (createdAt DESC, id DESC) keyset. 종전 조회는 그룹 전량을 읽어 인덱스가 없었다.
CREATE INDEX ix_group_announcements_group_created
    ON group_announcements (group_id, created_at, id);

-- ── 기존 공지의 시작 version ──────────────────────────────────────────
-- 공지 version 은 aggregate_versions(NOTICE, noticeId) 다. 이 마이그레이션 이전의 공지는 행이 없어 상세가
-- version 0 을 주게 되므로 1 로 시작점을 둔다(LLD §3 「기존 공지에는 시작 version 을 백필」). 이후의
-- 수정·댓글·삭제는 여기서 +1 씩 오른다.
INSERT INTO aggregate_versions (aggregate_type, aggregate_id, last_version, updated_at)
SELECT 'NOTICE', a.id::text, 1, now()
FROM group_announcements a
ON CONFLICT (aggregate_type, aggregate_id) DO NOTHING;
