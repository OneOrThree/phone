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
 * 그룹 멤버십 한 건 — 유저×그룹 unique 라 <b>한 유저는 같은 그룹에 행이 하나뿐</b>이다.
 *
 * <p>이탈은 삭제가 아니라 마킹이다(A-0 소프트삭제): {@code isLeft} 가 이탈 여부, {@code leftReason} 이
 * 사유를 든다. 행이 남아 있기 때문에 <b>"멤버인가"를 행 존재로 판단하면 안 된다</b> — 탈퇴자까지 현원에
 * 섞이고 정원 축소가 유령 자리에 막힌다(GROMO-1220). 활성 조회는 {@code isLeft = false} 를 함께 건다.
 *
 * <p>재참여도 행 재삽입이 아니라 {@link #rejoin()} 으로 기존 행을 되살린다 — unique 제약 때문에 새로 넣을
 * 수 없다.
 *
 * <h2>{@code @DynamicUpdate} 가 붙어 있는 이유 (GROMO-1659)</h2>
 * 이 행에는 <b>서로 다른 축</b>이 함께 산다 — 역할·공지 권한·알림 on/off 는 «요청자가 고치는 값»이고,
 * {@code membership_epoch}·{@code transition_seq}·{@code snapshot_version} 은 «다른 트랜잭션이
 * 잠금 아래 전진시키는 값»이다({@link #applyDisplaySnapshot(long)} 은 컬럼 하나짜리 조건부 UPDATE 로도
 * 올라간다 — {@code GroupMemberRepository.advanceSnapshotVersion}).
 *
 * <p>기본 더티 체킹은 <b>전 컬럼 UPDATE</b> 를 낸다. 그래서 잠금 없이 로드한 엔티티(예:
 * {@code transferOwner}·{@code updateGroupSettings} 의 {@code findByUserAndGroup})가 역할 하나만
 * 고쳐도, 그 사이 커밋된 표시 스냅샷 전진이 <b>옛 값으로 되돌아간다</b> — 링크 서버에는 새 버전이
 * 이미 나갔는데 코어의 원장만 뒤로 감기는 셈이다(늦게 온 relay 가 최신 이름을 덮는 길이 열린다).
 * {@code @DynamicUpdate} 는 <b>정말 바뀐 컬럼만</b> 싣게 해 그 덮어쓰기를 막는다. 전이가 실제로
 * 일어난 쓰기({@link #leave()}·{@link #kick()}·{@link #rejoin()}·
 * {@link #applyMembershipTransition(long)}) 는 그 컬럼들이 더티가 되므로 그대로 나간다.
 *
 * <p><b>이것은 낙관락이 아니다.</b> 「안 바꾼 컬럼을 덮지 않는다」까지만 보장한다 — 두 트랜잭션이
 * <b>같은 컬럼</b>을 읽고-고쳐-쓰면 여전히 뒤엣것이 이긴다. 그래서 멤버십 축을 바꾸는 경로는
 * 지금처럼 행 잠금({@code findActiveByUserIdAndGroupIdForUpdate}·{@code lockActiveMembershipId})
 * 을 계속 걸어야 하고, 표시 축은 컬럼 단위 조건부 UPDATE 를 계속 쓴다.
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

    /**
     * GROMO-676: 멤버 단위 공지 작성 권한 — 방장(OWNER)은 컬럼과 무관하게 항상 가능
     */
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
     * A-0 소프트삭제 사유 — 활성 멤버는 null, 탈퇴/강퇴 시 세팅. KICKED 는 재참여 차단 대상.
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "left_reason", length = 10)
    private GroupLeaveReason leftReason;

    /**
     * 멤버십 세대 (A22 ⓚ · ⓑ″ · ㋑) — <b>탈퇴·강퇴·재가입에만</b> 오른다.
     *
     * <p>일반 낙관락 {@code version} 과 <b>분리된 값</b>이다. 낙관락을 쓰면 첫 수신자의 가입이
     * 초대자 행의 version 을 올려 <b>재사용 링크의 이후 수신자가 전부 실패</b>한다 — 공유 active slug
     * 가 일반 row 변경 하나에 죽는 셈이다.
     *
     * <p>링크 서버는 이 값으로 ① 오래된 발급·확정을 거부하고 ② 폐기 대상을 「정확히 일치」로 고른다.
     * 폐기 명령은 <b>대상 {@code linkVersion}(옛 세대)</b> 과 <b>전이 후 {@code membershipEpoch}</b> 를
     * 함께 싣는다(ⓑ″) — 한쪽만 실으면 못 지우거나 지연 발급을 못 막는다.
     */
    @Column(name = "membership_epoch", nullable = false,
            columnDefinition = "bigint not null default 1")
    @Builder.Default
    private long membershipEpoch = 1L;

    /**
     * {@code (groupId, inviterId)} 축의 <b>커밋 순서</b> (A22 ㋥).
     *
     * <p>같은 outbox 라도 HTTP 적용 순서는 보장되지 않는다. V51 의 직렬화는 같은 {@code userId} 단위인데
     * claim 사용자와 발급자는 서로 다른 유저라, 유저 축만으로는 이 순서를 표현할 수 없다. 그래서
     * 링크 멤버십 aggregate 행을 잠근 채 발급받은 단조값을 여기 박아 두고 명령에 실어 보낸다.
     */
    @Column(name = "transition_seq", nullable = false,
            columnDefinition = "bigint not null default 0")
    @Builder.Default
    private long transitionSeq = 0L;

    /**
     * 표시정보(그룹명·발급자 닉네임) 스냅샷의 버전 (A22 ㋡).
     *
     * <p>현행 {@code resolveLanding} 은 랜딩을 <b>열 때마다</b> 현재 이름을 조회한다. 링크가 분리되면
     * 그 조회가 불가능해 스냅샷을 실어 보내야 하는데, 갱신 경로가 없으면 공유된 slug 가 만료까지
     * 옛 이름을 노출한다. 늦게 온 이름 변경 relay 가 최신 이름을 덮지 않도록 대조에 쓴다.
     */
    @Column(name = "snapshot_version", nullable = false,
            columnDefinition = "bigint not null default 0")
    @Builder.Default
    private long snapshotVersion = 0L;

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

    /** 강퇴 — 이탈 마킹 + 재참여 차단 사유. (A-0/A-3) */
    public void kick(Instant at) {
        this.isLeft = true;
        this.leftReason = GroupLeaveReason.KICKED;
        this.leftAt = at;
    }

    /** 자진 탈퇴 후 재참여 — 기존 행을 되살린다(unique(user,group) 때문에 재삽입 불가). (A-0) */
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

    /**
     * 멤버십 전이를 기록한다 — <b>세대와 순서를 같은 쓰기에서</b> (ⓚ · ㋥).
     *
     * <p>탈퇴·강퇴·재가입에서만 부른다. 이름 변경·권한 변경처럼 「누가 멤버인가」를 바꾸지 않는
     * 갱신에서 부르면 세대가 오르고, 그러면 살아 있는 재사용 링크가 통째로 죽는다.
     *
     * @param newTransitionSeq 링크 멤버십 aggregate 잠금 아래 발급받은 단조값
     * @return 전이 <b>전</b> 세대 — 폐기 명령의 {@code linkVersion} 이 이 값이다(ⓑ″)
     */
    public long applyMembershipTransition(long newTransitionSeq) {
        long previousEpoch = this.membershipEpoch;
        this.membershipEpoch = previousEpoch + 1;
        this.transitionSeq = newTransitionSeq;
        return previousEpoch;
    }

    /**
     * 표시정보 스냅샷 버전을 전진시킨다 (㋡) — 그룹명·닉네임이 바뀐 트랜잭션에서 부른다.
     *
     * <p>멤버십 세대를 건드리지 않는 것이 핵심이다. 이름이 바뀌었다고 세대가 오르면 그 순간
     * 공유된 링크가 전부 무효가 된다.
     *
     * @param newSnapshotVersion 링크 멤버십 aggregate 잠금 아래 발급받은 단조값
     */
    public void applyDisplaySnapshot(long newSnapshotVersion) {
        this.snapshotVersion = newSnapshotVersion;
    }

    /**
     * 강퇴 이력으로 재참여가 막힌 상태인지. (A-0 재가입 차단)
     *
     * @return 이탈 마킹 <b>과</b> 사유 KICKED 가 함께일 때만 true — 강퇴 후 방장이 다시 넣어
     *     {@code isLeft} 가 풀린 행은 false 다(차단은 지금 나가 있는 사람에게만 건다)
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

    /** 이 멤버에게 공지 작성 권한 부여 (GROMO-676). 방장에게는 의미가 없다 — 역할만으로 이미 가능하다. */
    public void allowAnnouncement() {
        this.announcementPermission = GroupAnnouncementGrant.ALLOW;
    }

    /**
     * 공지 작성 권한 회수 — 멤버 단위 컬럼만 되돌린다. 대상이 방장이면 {@link #canWriteAnnouncement()} 는
     * 여전히 true 다(역할이 컬럼을 덮는다).
     */
    public void disallowAnnouncement() {
        this.announcementPermission = GroupAnnouncementGrant.DISALLOW;
    }

    /**
     * 공지 작성/관리 가능 여부 — 방장은 항상 가능, 멤버는 권한(ALLOW) 부여 시 가능 (GROMO-676).
     *
     * @return 작성·수정·삭제를 한 번에 가르는 단일 판정. <b>이탈 여부는 보지 않으므로</b> 호출측이
     *     활성 멤버십을 먼저 확인한 뒤에 물어야 한다
     */
    public boolean canWriteAnnouncement() {
        return role == GroupMemberRole.OWNER || announcementPermission == GroupAnnouncementGrant.ALLOW;
    }
}
