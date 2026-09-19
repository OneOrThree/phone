package com.oneorthree.phone.group.repository.domain;

import com.oneorthree.phone.common.id.GeneratedUuidV7;
import com.oneorthree.phone.user.repository.domain.User;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;

import java.time.Instant;
import java.util.UUID;

/**
 * 섬 가입 요청 (LLD §4 JoinRequest) — {@code island_join_requests}.
 *
 * <h2>전이는 요청 행 잠금 아래서만</h2>
 * 신청자 취소·승인/거절·섬 종결이 경합할 수 있는 곳은 전부 이 행 하나다. 서비스는 반드시
 * {@code findByIdAndApplicantIdForUpdate} 계열로 배타 잠금한 뒤 {@link #getStatus()} 가
 * {@code PENDING} 인지 확인하고 전이한다 — 선조회 후 수정은 승인과 취소를 동시에 성공시킨다.
 *
 * <h2>초대 근거는 식별자만</h2>
 * {@link #inviteLinkId} 는 invitelink(6) 가 group(5) 보다 위 도메인이라 {@code @ManyToOne} 대신
 * 식별자만 둔다 — 그룹이 초대링크 엔티티를 참조하면 도메인 방향이 거꾸로 선다.
 */
@Entity
@Table(name = "island_join_requests")
@Getter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class IslandJoinRequest {

    @Id
    @GeneratedUuidV7
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "island_id", nullable = false)
    private Group island;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "applicant_id", nullable = false)
    private User applicant;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    @Builder.Default
    private IslandJoinRequestStatus status = IslandJoinRequestStatus.PENDING;

    @Enumerated(EnumType.STRING)
    @Column(name = "terminal_reason", length = 30)
    private IslandJoinRequestTerminalReason terminalReason;

    /** 이 요청을 가능하게 한 초대 코드 행 — 없으면 일반 신청이다. */
    @Column(name = "invite_link_id")
    private UUID inviteLinkId;

    @Version
    @Column(nullable = false)
    @Builder.Default
    private Long version = 0L;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private Instant createdAt;

    @Column(name = "resolved_at")
    private Instant resolvedAt;

    /** 새 승인 대기 요청 — 초대로 들어온 신청이면 그 링크 행을 근거로 붙인다. */
    public static IslandJoinRequest pending(Group island, User applicant, UUID inviteLinkId) {
        return IslandJoinRequest.builder()
                .island(island)
                .applicant(applicant)
                .inviteLinkId(inviteLinkId)
                .build();
    }

    public boolean isPending() {
        return status == IslandJoinRequestStatus.PENDING;
    }

    /** 신청자 본인 철회 — PENDING 확인과 잠금은 호출측 책임이다. */
    public void cancel() {
        this.status = IslandJoinRequestStatus.CANCELLED;
        this.terminalReason = IslandJoinRequestTerminalReason.APPLICANT_CANCELLED;
        this.resolvedAt = Instant.now();
    }

    /** 섬 종결에 의한 강제 종료 — 신청이 무효가 된 것이지 신청자가 철회한 것이 아니다. */
    public void closeByIsland() {
        this.status = IslandJoinRequestStatus.CANCELLED;
        this.terminalReason = IslandJoinRequestTerminalReason.ISLAND_CLOSED;
        this.resolvedAt = Instant.now();
    }
}
