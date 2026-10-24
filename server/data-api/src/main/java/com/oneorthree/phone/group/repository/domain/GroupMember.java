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
import jakarta.persistence.UniqueConstraint;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.DynamicUpdate;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.Instant;
import java.util.UUID;

/**
 * 유저와 섬의 멤버십. 이탈한 행도 보존하며 재가입할 때 같은 행과 새로운 세대를 사용한다.
 *
 * <p>역할·설정 변경은 멤버십 전이를 덮어쓰지 않도록 변경된 컬럼만 저장한다.
 * 멤버십 전이는 호출 서비스의 행 잠금으로 직렬화한다.
 */
@Entity
@Table(
        name = "group_members",
        uniqueConstraints = @UniqueConstraint(columnNames = {"user_id", "group_id"})
)
@DynamicUpdate
@Getter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class GroupMember {

    @Id
    @GeneratedUuidV7
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "group_id", nullable = false)
    private Group group;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 10)
    @Builder.Default
    private GroupMemberRole role = GroupMemberRole.MEMBER;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    @Builder.Default
    private GroupMemberStatus status = GroupMemberStatus.INACTIVE;

    /** 과거 개별 공지 권한 보존값. 현재 공지 쓰기는 방장만 허용하며 이 값은 무시한다. */
    @Getter(AccessLevel.NONE)
    @Enumerated(EnumType.STRING)
    @Column(name = "announcement_permission", nullable = false)
    @Builder.Default
    private GroupAnnouncementGrant announcementPermission = GroupAnnouncementGrant.DISALLOW;

    @Column(nullable = false)
    @Builder.Default
    private boolean notificationEnabled = true;

    @Column(name = "is_left", nullable = false)
    @Builder.Default
    private boolean isLeft = false;

    /**
     * A-0 소프트삭제 사유 — 활성 멤버는 null, 탈퇴/강퇴 시 세팅. KICKED 의 재가입은 섬장 승인을 거친다(GROMO-2315).
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "left_reason", length = 10)
    private GroupLeaveReason leftReason;

    /** 탈퇴·강퇴·재가입마다 증가하며 이전 세대에 발급한 초대 코드를 무효화한다. */
    @Column(name = "membership_epoch", nullable = false,
            columnDefinition = "bigint not null default 1")
    @Builder.Default
    private long membershipEpoch = 1L;

    /**
     * <b>행이 생긴 시각</b>이다 — 「이 멤버십이 시작된 시각」이 아니다.
     *
     * <p>{@link #rejoin(Instant)} 은 이 값을 갱신하지 <b>않는다</b>. 주민 목록 keyset 페이지네이션
     * ({@code GroupMemberRepository.findActivePageByGroupId})의 정렬 축이 이 값이기 때문이다 — 재가입이
     * 여기를 덮으면 주민 목록의 커서 순서가 조용히 바뀐다. (메인 섬 도출·이전은 GROMO-2054 이후 이 컬럼이
     * 아니라 «멤버십 시작 시각» — {@link #membershipStartedAt()} 축으로 정렬한다.)
     *
     * <p>그래서 «멤버십 시작 시각»은 {@link #rejoinedAt} 이 덧씌운다 — {@link #membershipStartedAt()}.
     */
    @CreationTimestamp
    private Instant createdAt;

    /**
     * <b>이탈의 증거가 아니다</b> — {@code @UpdateTimestamp} 라 알림 토글·역할 변경 같은 아무 변경에도
     * 갱신된다. 이탈 시각은 {@link #leftAt} 이다 (GROMO-2050).
     */
    @UpdateTimestamp
    private Instant updatedAt;

    /**
     * 이탈 시각 — <b>자진 탈퇴·강퇴·계정 탈퇴 세 경로가 모두</b> 여기 찍는다 (GROMO-2050).
     *
     * <p>세 경로 모두 {@link #leave(Instant)}·{@link #kick(Instant)} 을 지나므로 이 한 자리면 전수다.
     * {@link #rejoin(Instant)} 이 다시 비우니 {@code isLeft = false} 인 행은 언제나 null 이다.
     *
     * <p><b>{@code @UpdateTimestamp} 로 채우지 않는 이유.</b> Hibernate 의 시각 애너테이션은 주입
     * {@link java.time.Clock} 빈을 타지 않고 실제 벽시계를 찍는다 — 시계를 제어하는 테스트에서 경계 판정이
     * 통째로 무력화된다(GROMO-1997 이 그 함정에 걸려 JDBC 로 값을 옮겨야 했다). 그래서 호출부가 주입
     * {@code Clock} 으로 읽은 시각을 <b>인자로</b> 넘긴다.
     *
     * <p>V97 이전에 이탈한 행은 근거가 없어 null 이다 — 지어내지 않는다.
     */
    @Column(name = "left_at")
    private Instant leftAt;

    /**
     * 재가입으로 <b>멤버십이 다시 시작된</b> 시각 (GROMO-2050). null 이면 최초 가입 그대로다.
     *
     * <p>{@link #createdAt} 을 갱신하는 대신 이 컬럼을 덧씌우는 근거는 {@link #createdAt} Javadoc 에 있다.
     */
    @Column(name = "rejoined_at")
    private Instant rejoinedAt;

    /** 자진 탈퇴 — 행을 보존하고 이탈 마킹(재참여 허용). (A-0) */
    public void leave(Instant at) {
        this.isLeft = true;
        this.leftReason = GroupLeaveReason.LEFT;
        this.leftAt = at;
    }

    /** 강퇴 — 이탈 마킹 + 사유 KICKED. 섬 가입 경로에서 재가입은 승인 대기 신청이 된다(GROMO-2315). (A-0/A-3) */
    public void kick(Instant at) {
        this.isLeft = true;
        this.leftReason = GroupLeaveReason.KICKED;
        this.leftAt = at;
    }

    /** 탈퇴·강퇴 후 재참여 — 기존 행을 되살린다(unique(user,group) 때문에 재삽입 불가). (A-0) */
    public void rejoin(Instant at) {
        this.isLeft = false;
        this.leftReason = null;
        // 멤버십이 «여기서» 다시 시작한다 — 안 비우면 되살아난 행이 옛 이탈 시각을 들고 다니고,
        // 안 찍으면 최초 가입 시각으로 과거 소속이 판정된다(둘 다 분모를 틀리게 만든다).
        this.leftAt = null;
        this.rejoinedAt = at;
        this.role = GroupMemberRole.MEMBER;
        this.status = GroupMemberStatus.INACTIVE;
        this.announcementPermission = GroupAnnouncementGrant.DISALLOW;
        this.notificationEnabled = true;
    }

    /**
     * 이 멤버십이 시작된 시각 — 재가입했으면 되살린 시각, 아니면 행이 생긴 시각 (GROMO-2050).
     *
     * <p>SQL 쪽 짝은 {@code COALESCE(rejoined_at, created_at)} 이다
     * ({@code IslandWeeklyMemberCountRepository.ACTIVE_AT_BOUNDARY_SQL} · 메인 섬 도출
     * {@code GroupMemberRepository.findActiveIslandsJoinedDesc}/{@code countActiveJoinedAfter}).
     */
    public Instant membershipStartedAt() {
        return rejoinedAt != null ? rejoinedAt : createdAt;
    }

    /** 활성 멤버십의 전이가 일어난 트랜잭션에서만 세대를 올린다. */
    public long advanceMembershipEpoch() {
        return ++membershipEpoch;
    }

    /**
     * 강퇴돼 지금 나가 있는 상태인지 — 재가입이 승인 대기로 가는 근거다(GROMO-2315, 종전 A-0 재가입 차단).
     *
     * @return 이탈 마킹 <b>과</b> 사유 KICKED 가 함께일 때만 true — 강퇴 후 방장이 다시 넣어
     *     {@code isLeft} 가 풀린 행은 false 다(지금 나가 있는 사람에게만 건다)
     */
    public boolean isKicked() {
        return this.isLeft && this.leftReason == GroupLeaveReason.KICKED;
    }

    /** 방장 → 일반 멤버 강등. 방장 위임은 이 호출과 {@link #promoteToOwner()} 를 같은 트랜잭션에서 짝지어야 한다. */
    public void demoteToMember() {
        this.role = GroupMemberRole.MEMBER;
    }

    /**
     * 일반 멤버 → 방장 승격. 기존 방장을 강등하는 일은 하지 않으므로, 짝을 빠뜨리면 방장이 둘이 된다.
     */
    public void promoteToOwner() {
        this.role = GroupMemberRole.OWNER;
    }

}
