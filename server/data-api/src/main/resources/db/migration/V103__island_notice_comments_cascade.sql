-- ════════════════════════════════════════════════════════════════════
-- V103 — 섬 게시판 공지 댓글: notice_id FK 를 SET NULL → CASCADE 로 전환 (GROMO-2136, 2026-09-25 결정)
-- ════════════════════════════════════════════════════════════════════
-- V66 은 BQ02(댓글 삭제·공지 삭제 시 댓글 처리)가 미결이라 「지우지 않는」 쪽을 골라 notice_id 를
-- ON DELETE SET NULL 로 만들었다. 2026-09-25 결정으로 BQ02 가 확정됐다 — 공지가 지워지면 그 댓글도
-- 함께 지운다. author_id 의 ON DELETE SET NULL 은 그대로 둔다(탈퇴자 댓글 삭제는 애플리케이션이
-- GroupAnnouncementCommentRepository.deleteAllOfUser 로 먼저 처리하고, users 는 소프트 삭제라 이 FK 가
-- 애초에 발동하지 않는다).
--
-- V66 이 제약명을 명시하지 않아(인라인 REFERENCES) 신선 체인 기준 자동명은
-- group_announcement_comments_notice_id_fkey 이지만, 이름에 의존하지 않도록 notice_id 를 참조하는
-- FK 를 찾아 드롭한다(V20 의 이름-무관 전환 관행과 같다).
DO $$
DECLARE
    con record;
BEGIN
    FOR con IN
        SELECT c.conname
        FROM pg_constraint c
        WHERE c.conrelid = 'public.group_announcement_comments'::regclass
          AND c.contype = 'f'
          AND EXISTS (SELECT 1
                      FROM pg_attribute a
                      WHERE a.attrelid = c.conrelid
                        AND a.attname = 'notice_id'
                        AND a.attnum = ANY (c.conkey))
    LOOP
        EXECUTE format('ALTER TABLE public.group_announcement_comments DROP CONSTRAINT %I', con.conname);
    END LOOP;
END $$;

ALTER TABLE public.group_announcement_comments
    ADD CONSTRAINT group_announcement_comments_notice_id_fkey
        FOREIGN KEY (notice_id) REFERENCES public.group_announcements (id) ON DELETE CASCADE;

COMMENT ON COLUMN group_announcement_comments.notice_id IS
    '공지 삭제 시 댓글도 함께 삭제된다(ON DELETE CASCADE, 2026-09-25 결정 GROMO-2136 — BQ02 확정). GROMO-1771';

COMMENT ON TABLE group_announcement_comments IS
    '섬 게시판 공지 댓글 — 불변. notice_id 는 공지 삭제 시 CASCADE(V103), author_id 는 탈퇴자 댓글을'
    ' 애플리케이션이 먼저 delete 하므로 SET NULL 이 발동하지 않는다(2026-09-25 결정 GROMO-2136). GROMO-1771';
