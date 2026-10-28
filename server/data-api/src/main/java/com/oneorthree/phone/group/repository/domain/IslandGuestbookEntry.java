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
import java.time.LocalDate;
import java.util.UUID;

/**
 * 섬 방명록 한 건 (GROMO-2262, V113). 방문 1회 = 유저·섬·KST 하루(결정 N6) 라서
 * {@code (island_id, author_id, written_on)} 이 유일하다. 개수 제한 없이 보관하고 섬장이 지운 글만
 * {@code deleted_at} 으로 숨긴다. 연관관계 대신 id 만 든다 — 작성자 이름은 조회 쪽이 모아 읽는다.
 */
@Entity
@Table(name = "island_guestbook_entries")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class IslandGuestbookEntry {

    @Id
    @GeneratedUuidV7
    private UUID id;

    @Column(name = "island_id", nullable = false)
    private UUID islandId;

    @Column(name = "author_id", nullable = false)
    private UUID authorId;

    @Column(nullable = false, length = 80)
    private String content;

    /** KST 날짜. */
    @Column(name = "written_on", nullable = false)
    private LocalDate writtenOn;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "deleted_at")
    private Instant deletedAt;

    public IslandGuestbookEntry(UUID islandId, UUID authorId, String content, LocalDate writtenOn) {
        this.islandId = islandId;
        this.authorId = authorId;
        this.content = content;
        this.writtenOn = writtenOn;
    }

    public void delete(Instant now) {
        this.deletedAt = now;
    }
}
