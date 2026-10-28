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
 * 섬의 이름·정원·가입 방식을 저장한다. 활성 판정은 종료 상태와 삭제 시각을 함께 확인한다.
 * 입력 검증과 주민 수에 따른 변경 제한은 섬 서비스가 담당한다.
 */
@Entity
@Table(name = "islands")
@Getter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class Group {

    /** 섬 정원 상한. 계정당 소속 섬 상한은 {@code IslandInputPolicy.MAX_JOINED_ISLANDS}다. */
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

    /** 과거 비밀번호 보존값. 새 섬에서는 설정하지 않으며 값이 남은 섬의 가입은 거절한다. */
    @Column(length = 100)
    private String password;

    @Column(length = 200)
    private String description;

    /** 섬장 환영 인사말(GROMO-2262, V113) — null 이면 기본 문구를 읽을 때 합성한다. */
    @Column(length = 160)
    private String greeting;

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

    /** true면 신규 가입에 방장 승인이 필요하다. */
    @Column(name = "approval_required", nullable = false,
            columnDefinition = "boolean not null default false")
    @Builder.Default
    private boolean approvalRequired = false;

    /** 섬 정보 변경의 낙관락 버전. */
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

    /** 과거 채팅 설정 보존값. 현재 우체통·섬 채팅 인가에서는 사용하지 않는다. */
    @Getter(AccessLevel.NONE)
    @Column(name = "is_chat_enabled", nullable = false)
    @Builder.Default
    private boolean isChatEnabled = true;

    /** 과거 채팅 한도 보존값. 현재 메시지 정책에서는 사용하지 않는다. */
    @Getter(AccessLevel.NONE)
    @Column
    private Integer chatLimitPerPerson;

    /** 과거 초대 권한 보존값. 현재 섬 초대는 활성 주민 누구나 발급한다. */
    @Getter(AccessLevel.NONE)
    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    @Builder.Default
    private GroupPermissionScope invitePermission = GroupPermissionScope.OWNER_ONLY;

    /** 과거 구매 권한 보존값. 현재 건설·공동 구매 인가는 {@code SharedPurchase} 정책을 따른다. */
    @Getter(AccessLevel.NONE)
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

    /** 인사말 교체 — null 이면 기본 문구로 되돌린다(GROMO-2262). */
    public void updateGreeting(String greeting) {
        this.greeting = greeting;
    }

    /**
     * 섬 공개 여부를 바꾼다. 첫 정착이 끝난 온보딩 섬은 공개 섬으로 전환한다.
     *
     * @param isPrivate true 면 공개 검색에서 제외한다
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

    /** 섬을 종료 상태로 바꾼다. 공동 데이터 삭제는 섬 서비스가 처리한다. */
    public void close() {
        this.status = GroupStatus.ENDED;
    }

    /**
     * 섬 삭제 묘비 (GROMO-1995) — 정책 「섬 삭제 시 섬 정보·설정 … 을 함께 삭제한다」.
     *
     * <p><b>행은 지우지 않는다.</b> 이 섬을 가리키는 FK 가 전부 {@code ON DELETE RESTRICT} 이고
     * 그중에는 정책이 <b>유지</b>하라고 한 개인 집중 기록·멤버십
     * ({@code focus_sessions}·{@code group_members})이 섞여 있다. 물리 삭제는 그것까지 지우거나 FK로 실패한다.
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
