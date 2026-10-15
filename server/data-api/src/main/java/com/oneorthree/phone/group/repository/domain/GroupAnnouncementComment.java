package com.oneorthree.phone.group.repository.domain;

import com.oneorthree.phone.common.id.GeneratedUuidV7;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;

import java.time.Instant;
import java.util.UUID;

/**
 * 섬 게시판 공지의 댓글 한 건 (GROMO-1771, island-board LLD §3). 불변이다 — 수정·삭제 API 가 없다.
 *
 * <p>두 참조가 모두 nullable 인 것은 <b>BQ02 미결</b> 때문이다. 댓글 삭제·공지 삭제 시 댓글 처리·탈퇴 후 원문
 * 보존이 정해지지 않았으므로 스키마는 «지우지 않는» 쪽을 골랐다: 공지가 지워지면 {@code notice_id}, 작성자
 * 행이 지워지면 {@code author_id} 가 DB 에서 {@code ON DELETE SET NULL} 된다(V66). 결정이 나면 새 마이그레이션으로
 * 좁힌다. 쓰기 자체는 그 결정 전까지 {@code island-board.writes-enabled=false} 로 닫혀 있다.
 *
 * <p>연관관계 대신 id 만 든다 — 댓글은 공지·사용자를 읽을 일이 없고, 표시 이름은 조회 쪽이 한 번에 모아
 * 읽는다(페이지당 한 번의 batch projection).
 */
@Entity
@Table(name = "group_announcement_comments")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class GroupAnnouncementComment {

    @Id
    @GeneratedUuidV7
    private UUID id;

    @Column(name = "notice_id")
    private UUID noticeId;

    @Column(name = "author_id")
    private UUID authorId;

    @Column(nullable = false, columnDefinition = "text")
    private String text;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    public GroupAnnouncementComment(UUID noticeId, UUID authorId, String text) {
        this.noticeId = noticeId;
        this.authorId = authorId;
        this.text = text;
    }
}
