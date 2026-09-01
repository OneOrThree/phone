package com.oneorthree.phone.group.repository.domain;

import com.oneorthree.phone.common.id.GeneratedUuidV7;
import com.oneorthree.phone.user.repository.domain.User;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.Instant;
import java.util.UUID;

/**
 * 그룹 공지 한 건. 작성자({@code user})는 nullable 이다 — 유저가 탈퇴해도 공지는 남기 때문이고,
 * 그래서 화면은 작성자를 필수로 기대하면 안 된다.
 *
 * <p>{@code deletedAt} 컬럼이 있지만 삭제는 하드 딜리트로 돌고 있어 채워지지 않는다 — 조회도 이 컬럼을
 * 보지 않는다. 소프트 삭제로 바꾸려면 조회 쪽 필터를 함께 넣어야 한다.
 */
@Entity
@Table(name = "group_announcements")
@Getter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class GroupAnnouncement {

    @Id
    @GeneratedUuidV7
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "group_id", nullable = false)
    private Group group;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id")
    private User user;

    @Column(nullable = false, length = 100)
    private String title;

    @Column(nullable = false, columnDefinition = "text")
    private String content;

    @CreationTimestamp
    @Column(nullable = false, updatable = false)
    private Instant createdAt;

    @UpdateTimestamp
    private Instant updatedAt;

    @Column(name = "deleted_at")
    private Instant deletedAt;

    /**
     * 공지 부분 수정 — <b>null 은 "안 바꿈"</b>이다. 두 컬럼 모두 NOT NULL 이라 null 을 그대로 덮어쓰면
     * 안 되기 때문이고, 덕분에 제목만·본문만 고치는 요청이 그대로 통한다.
     *
     * @param title 새 제목(100자 이내). null 이면 기존 제목 유지 — 제목을 비우는 방법은 없다
     * @param content 새 본문. null 이면 기존 본문 유지
     */
    public void updateContent(String title, String content) {
        if (title != null) {
            this.title = title;
        }
        if (content != null) {
            this.content = content;
        }
    }
}
