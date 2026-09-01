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
}
