package com.oneorthree.phone.group.repository.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
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
 * 사용자의 현재 섬 컨텍스트 (users 1:1) — GROMO-1907, island-membership LLD §4 논리 모델
 * {@code UserIslandContext} 의 실제 테이블.
 *
 * <p>섬 생성·가입·현재 섬 이동·집중 세션 시작이 <b>같은 사용자 축</b>을 동시에 건드리는데, 그걸
 * 직렬화할 공통 경계가 이 행이다. PK 가 곧 유저 id 라 users 행 배타 락 아래에서 이 행도 함께
 * 직렬화된다 — 실제 잠금 취득은 항상
 * {@link com.oneorthree.phone.group.service.UserIslandContextLockService} 를 거친다. 이 엔티티를
 * 직접 {@code save}/{@code findById} 로 만지는 새 경로를 추가하지 않는다.
 *
 * <p>{@code currentIslandId} 가 {@code null} 인 것은 «아직 어떤 섬에도 속한 적 없음»이다. 상실
 * 사유별 복구 전이(IM-D06, lossReason/previousIslandId/recoveryGeneration)는 아직 미승인이라
 * 이 엔티티는 그 분기에만 쓰는 필드를 갖지 않는다 — 승인되면 그때 추가한다(ponytail: 지금은 미정
 * 정책을 위한 자리를 미리 파지 않는다).
 *
 * <p>{@code contextVersion} 은 {@code Group.version} 과 같은 방식의 JPA {@code @Version} 낙관락이다.
 * outbox 순서용 {@code aggregate_versions(USER, userId)} 축(㊸)과는 <b>별개 값</b>이다 — 그 축은
 * 인증 세션·알림·초대·탈퇴 등 무관한 도메인이 공유하는 발행 순서용이라, 컨텍스트 전이 여부와 섞으면
 * "무슨 일로 올랐는지 알 수 없는" 값이 된다. 컨텍스트 전이 자체도 outbox 사건이 아니다 — 개인 선택
 * 변경을 island.members.updated 로 방송하지 않는다(LLD §3.6).
 */
@Entity
@Table(name = "user_island_contexts")
@Getter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class UserIslandContext {

    @Id
    @Column(name = "user_id")
    private UUID userId;

    @Column(name = "current_island_id")
    private UUID currentIslandId;

    @Version
    @Column(name = "context_version", nullable = false)
    @Builder.Default
    private Long contextVersion = 0L;

    @CreationTimestamp
    private Instant createdAt;

    @UpdateTimestamp
    private Instant updatedAt;

    /**
     * 신규 사용자의 첫 컨텍스트 행 — 아직 어떤 섬에도 속하지 않았다.
     *
     * @param userId 컨텍스트 주인
     * @return currentIslandId=null 인 새 행(미저장)
     */
    public static UserIslandContext newFor(UUID userId) {
        return UserIslandContext.builder().userId(userId).build();
    }

    /**
     * 현재 섬을 옮긴다 — 자격·정원·출발 시설 가드는 호출측(GroupService 등) 책임이다. 이 메서드는
     * 대입만 한다.
     *
     * @param islandId 새 현재 섬
     */
    public void moveTo(UUID islandId) {
        this.currentIslandId = islandId;
    }
}
