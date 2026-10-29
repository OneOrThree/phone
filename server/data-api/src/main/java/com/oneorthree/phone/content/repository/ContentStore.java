package com.oneorthree.phone.content.repository;

import com.oneorthree.phone.content.exception.ContentErrorCode;
import com.oneorthree.phone.content.exception.ContentException;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** 관리 게시의 불변 영수증과 비공개 검토 스냅샷. 쓰기는 호출자의 트랜잭션에 참여한다. */
@Repository
@RequiredArgsConstructor
public class ContentStore {
    private final JdbcTemplate jdbc;

    public void lock(UUID publicationId) {
        jdbc.queryForList("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))",
                "content-publication:" + publicationId);
    }

    public String replay(UUID id, String kind, String digest) {
        List<Receipt> rows = jdbc.query("SELECT kind, request_digest, result::text FROM content_publications"
                        + " WHERE publication_id = ?", (rs, number) -> new Receipt(rs.getString(1),
                        rs.getString(2), rs.getString(3)), id);
        if (rows.isEmpty()) {
            return null;
        }
        Receipt receipt = rows.get(0);
        if (!receipt.kind().equals(kind) || !receipt.digest().equals(digest)) {
            throw new ContentException(ContentErrorCode.CONTENT_PUBLICATION_CONFLICT);
        }
        return receipt.result();
    }

    public void record(UUID id, String kind, String digest, String result, String actor, Instant now) {
        jdbc.update("INSERT INTO content_publications(publication_id,kind,request_digest,result,actor,created_at)"
                        + " VALUES(?,?,?,?::jsonb,?,?)", id, kind, digest, result, actor, Timestamp.from(now));
    }

    public void snapshot(UUID id, String digest, String content, String actor, Instant now) {
        jdbc.update("INSERT INTO magazine_review_snapshots(snapshot_id,digest,content,actor,created_at)"
                        + " VALUES(?,?,?::jsonb,?,?)", id, digest, content, actor, Timestamp.from(now));
    }

    public String snapshot(UUID id, String digest) {
        List<String> rows = jdbc.query("SELECT content::text FROM magazine_review_snapshots"
                        + " WHERE snapshot_id=? AND digest=?", (rs, number) -> rs.getString(1), id, digest);
        if (rows.isEmpty()) {
            throw new ContentException(ContentErrorCode.CONTENT_REVIEW_STALE);
        }
        return rows.get(0);
    }

    /** 기존 자동 발행과 관리자 게시도 같은 테이블 잠금에서 호수·홍보 변경을 직렬화한다. */
    public void lockMagazine(List<UUID> islandIds) {
        islandIds.stream().distinct().sorted(java.util.Comparator.comparing(UUID::toString)).forEach(id ->
                jdbc.queryForList("SELECT id FROM islands WHERE id=? FOR SHARE", id));
        jdbc.execute("LOCK TABLE magazine_issues, island_promotions IN SHARE ROW EXCLUSIVE MODE");
    }

    private record Receipt(String kind, String digest, String result) { }
}
