package com.oneorthree.phone.group.repository.domain;

import com.oneorthree.phone.common.id.GeneratedUuidV7;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
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
 * 그룹(방) 자체. 이름·정원·비밀번호·공개 여부 같은 <b>방의 설정</b>만 소유하고, 챌린지 생명주기나 멤버 명단은
 * 각각 group_challenges · group_members 가 소유한다(GROMO-676).
 *
 * <p>살아 있는 그룹인지는 두 축을 함께 봐야 한다 — {@code status}({@link GroupStatus#ENDED} 면 종료)와
 * {@code deletedAt}(소프트 딜리트). 어느 한쪽만 보면 종료됐거나 지워진 방이 조회에 섞인다.
 *
 * <p>변경 메서드들은 값 검증을 하지 않는다 — 정원 축소 하한, 비밀번호 해싱 같은 규칙은 전부
 * {@code GroupService.updateGroup} 이 지고 여기서는 대입만 한다.
 */
@Entity
@Table(name = "groups")
@Getter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class Group {

    /**
     * 섬 정원의 상한 — 정책 「정원은 1~15명」(policy-2026-09-14 §섬 가입·전망대·랭킹, GROMO-1993).
     *
     * <p>여기 두는 이유는 정원이 «방의 설정»이라 이 엔티티가 주인이고, {@code CreateGroupRequest}·
     * {@code UpdateGroupRequest} 의 {@code @Max} 가 컴파일 상수를 요구하기 때문이다. 값을 세 군데에
     * 흩어 놓으면 한 곳만 고쳐져 「검증은 통과하는데 저장은 거절」이 된다.
     *
     * <p><b>계정당 소속 섬 상한(10)과는 다른 축이다</b> — 그쪽은
     * {@code IslandMovementGuards.MAX_JOINED_ISLANDS} 이고 이 값과 함께 움직이지 않는다.
     */
    public static final int MAX_MEMBERS_CEILING = 15;

    /** 정원 하한 — 방장 혼자인 1인 섬이 유효하다(정책 「정원은 1~15명」). */
    public static final int MAX_MEMBERS_FLOOR = 1;

    /** 정원 미입력 시 기본값 — 정책 「따로 정하지 않으면 15명」. */
    public static final int DEFAULT_MAX_MEMBERS = MAX_MEMBERS_CEILING;

    @Id
    @GeneratedUuidV7
    private UUID id;

    @Column(nullable = false, length = 50)
    @Builder.Default
    private String name = "";

    @Column(length = 100)
    private String password;

    @Column(length = 200)
    private String description;

    @Column(nullable = false)
    private int maxMembers;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    @Builder.Default
    private GroupStatus status = GroupStatus.WAITING;

    /**
     * 공개/비공개 구분 — true 면 이름 검색에서 제외되고 초대 링크(groupId)로만 참여한다.
     */
    @Column(name = "is_private", nullable = false)
    @Builder.Default
    private boolean isPrivate = false;

    /**
     * 가입에 방장 승인이 필요한지 (GROMO-1907, island-membership LLD §3.1). 섬 API(1759)의 create
     * 계약이 쓸 입력이며, 이 티켓은 저장 칸만 만든다 — 승인 대기/거절 흐름의 배선은 여기 없다.
     * 기존 그룹은 전부 즉시가입이었으므로 기본값 false 로 과거 행의 의미를 보존한다.
     *
     * <p>{@code columnDefinition} 에 DB 기본값을 함께 선언하는 이유: local 프로필은 Flyway 를 끄고
     * {@code ddl-auto: update} 로 스키마를 만든다(GROMO-670). {@code @Builder.Default} 는 새 자바
     * 객체에만 적용돼 DDL 기본값을 만들지 않으므로, 그것만 두면 기존 행이 있는 로컬에서 기본값 없는
     * NOT NULL 컬럼 추가가 되어 부팅이 깨진다. UserNotificationSettings·GroupMember 와 같은 처리다.
     */
    @Column(name = "approval_required", nullable = false,
            columnDefinition = "boolean not null default false")
    @Builder.Default
    private boolean approvalRequired = false;

    /**
     * GROMO-671: dbml 은 version 을 누락했으나 낙관락(동시성)이 필요해 유지(UserWallet 과 동일 판단).
     */
    @Version
    private Long version;

    @CreationTimestamp
    private Instant createdAt;

    @Column(name = "deleted_at")
    private Instant deletedAt;

    /**
     * 방 이름 교체 — 이름 검색용 trgm GIN 인덱스는 자동으로 따라오므로 별도 재색인이 없다.
     *
     * @param newName 새 이름(50자 이내). null 을 그대로 받으면 NOT NULL 컬럼에서 깨지므로, 호출측이 "변경
     *     요청이 있을 때만" 부르는 전제다
     */
    public void updateName(String newName) {
        this.name = newName;
    }

    /**
     * 정원 교체.
     *
     * @param newMaxMembers 새 정원. <b>현원보다 작은 값·1 미만은 여기서 막지 않는다</b> — 탈퇴자를 제외한
     *     현원과의 비교는 호출측이 먼저 하고 {@code MAX_MEMBERS_TOO_SMALL} 로 거른다(GROMO-1220)
     */
    public void updateMaxMembers(int newMaxMembers) {
        this.maxMembers = newMaxMembers;
    }

    /**
     * 비밀방 비밀번호 설정·교체.
     *
     * @param newPassword <b>이미 해싱된</b> 값 — 평문을 넣으면 그대로 저장된다. 인코딩은 호출측
     *     ({@code GroupService} 의 {@code passwordEncoder})이 한다
     */
    public void updatePassword(String newPassword) {
        this.password = newPassword;
    }

    /** 비밀번호 해제 — null 로 비운다. 이후 참여에 비밀번호를 묻지 않는다(공개/비밀 여부와는 별개 축이다). */
    public void removePassword() {
        this.password = null;
    }

    @Column(name = "is_chat_enabled", nullable = false)
    @Builder.Default
    private boolean isChatEnabled = true;

    @Column
    private Integer chatLimitPerPerson;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    @Builder.Default
    private GroupPermissionScope invitePermission = GroupPermissionScope.OWNER_ONLY;

    /**
     * 섬 물고기 지출 권한 (GROMO-1767, island-construction 정책 C13 — 판정 이름 SHARED_PURCHASE).
     * 건설 실행·공동 구매를 방장만 할지 주민에게 열지를 정하는 섬 설정이다.
     * 기본값은 보존적인 {@code OWNER_ONLY} — 토글 변경 API 는 1767 범위 밖이다.
     * {@code columnDefinition} 에 DB 기본값을 두는 이유는 {@link #approvalRequired} 와 같다
     * (ddl-auto: update 로컬에서 기본값 없는 NOT NULL 추가가 부팅을 깨뜨리지 않게).
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "shared_purchase_permission", nullable = false, length = 20,
            columnDefinition = "varchar(20) not null default 'OWNER_ONLY'")
    @Builder.Default
    private GroupPermissionScope sharedPurchasePermission = GroupPermissionScope.OWNER_ONLY;

    /**
     * 방 소개 교체.
     *
     * @param description 새 소개(200자 이내). 컬럼이 nullable 이라 null 을 넣으면 소개가 지워진다 —
     *     "변경 없음"을 null 로 표현하는 요청 DTO 와 뜻이 다르므로 호출측이 null 일 때 아예 부르지 않는다
     */
    public void updateDescription(String description) {
        this.description = description;
    }

    /**
     * 공개/비밀 전환 (A-1) — 비밀방은 검색 제외, 초대 링크 전용.
     *
     * @param isPrivate true 면 비밀방 — 이름 검색·공개 그룹 목록에서 빠지고 초대 링크(groupId)로만 들어온다.
     *     비밀번호 유무와는 독립된 축이다
     */
    public void updateIsPrivate(boolean isPrivate) {
        this.isPrivate = isPrivate;
    }

    /**
     * 가입 방식 전환 (GROMO-1802, 섬 관리 LLD §3.1). 이미 열려 있는 가입 요청을 자동 승인·거절하지 않는다 —
     * 기존 요청은 방장이 명시적으로 처리한다.
     *
     * @param approvalRequired true 면 새 가입은 승인 대기 요청이 된다
     */
    public void updateApprovalRequired(boolean approvalRequired) {
        this.approvalRequired = approvalRequired;
    }

    /**
     * 채팅·초대 설정 부분 변경 — <b>null 은 "안 바꿈"</b>이라 세 값을 따로 보낼 수 있다.
     * 현재 호출부가 없다(채팅·초대 권한 설정 화면이 배선되기 전이다).
     *
     * @param chatEnabled 그룹 채팅 사용 여부. null 이면 유지
     * @param chatLimitPerPerson 1인당 채팅 한도. null 이면 유지 — 한도 없음(null)으로 되돌리는 방법은
     *     이 메서드에 없다
     * @param invitePermission 초대를 누가 할 수 있는지. null 이면 유지
     */
    public void updateSettings(Boolean chatEnabled, Integer chatLimitPerPerson,
            GroupPermissionScope invitePermission) {
        if (chatEnabled != null) {
            this.isChatEnabled = chatEnabled;
        }
        if (chatLimitPerPerson != null) {
            this.chatLimitPerPerson = chatLimitPerPerson;
        }
        if (invitePermission != null) {
            this.invitePermission = invitePermission;
        }
    }

    /**
     * GROMO-676: 챌린지 생명주기(started/ended_at)는 group_challenges 소유 — 그룹 종료는 status 만 전이한다.
     */
    public void close() {
        this.status = GroupStatus.ENDED;
    }

    /**
     * 섬 삭제 묘비 (GROMO-1995) — 정책 「섬 삭제 시 섬 정보·설정 … 을 함께 삭제한다」.
     *
     * <p><b>행은 지우지 않는다.</b> 이 섬을 가리키는 FK 가 전부 {@code ON DELETE RESTRICT} 이고
     * 그중에는 정책이 <b>유지</b>하라고 한 개인 집중 기록·정산 증거({@code focus_sessions}·
     * {@code group_members}·내기 참가)가 섞여 있다 — 물리 삭제는 그것까지 지우거나 FK 로 실패한다.
     * 그래서 {@code deleted_at} 으로 「없는 섬」을 확정하고({@code IslandMovementGuards.isAlive} 가
     * 이미 이 축을 본다), 공동 데이터는 {@code IslandPurgeService} 가 테이블 단위로 지운다.
     *
     * <p>이미 지워진 섬을 다시 지우지 않는다 — 같은 명령의 재생이 묘비 시각을 앞뒤로 흔들지 않게.
     *
     * @param at 삭제 시각
     */
    public void markDeleted(Instant at) {
        if (this.deletedAt == null) {
            this.deletedAt = at;
        }
    }
}
