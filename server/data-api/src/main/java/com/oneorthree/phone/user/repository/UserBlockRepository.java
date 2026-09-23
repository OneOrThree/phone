package com.oneorthree.phone.user.repository;

import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.repository.domain.UserBlock;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * user_blocks 매핑 리포지토리.
 *
 * <p>GROMO-676 스키마+매핑 선반영 — 차단 기능 로직은 별도 티켓에서 구현한다.
 */
public interface UserBlockRepository extends JpaRepository<UserBlock, UUID> {

    /**
     * (blocker → blocked) 방향 고정 단건 조회
     *
     * @param blocker 차단한 쪽
     * @param blocked 차단당한 쪽
     * @return 그 방향의 차단 행. <b>방향이 고정</b>이라 반대 방향 차단은 잡히지 않는다 —
     *         상호 차단 여부를 보려면 두 번 물어야 한다
     */
    Optional<UserBlock> findByBlockerAndBlocked(User blocker, User blocked);

    /**
     * blocker 가 차단한 목록
     *
     * @param blocker 차단한 쪽
     * @return 이 유저가 차단한 관계. <b>자신을 차단한 사람들은 들어 있지 않다</b>
     */
    List<UserBlock> findByBlocker(User blocker);

    /**
     * 멱등 차단 등록 (GROMO-1975) — DB 차원 upsert. {@code PinnedUserRepository.insertIgnoreConflict}
     * 와 같은 이유로 check-then-insert 가 아니다: 동시 요청이 「없음」을 같이 보고 들어와도
     * {@code uk_user_blocks_blocker_blocked} 가 지는 쪽을 무시해 500 이 나지 않는다.
     * 네이티브 INSERT 는 {@code @GeneratedUuidV7} 를 안 타므로 id 를 호출측({@code UuidV7.next()})이 넣는다.
     *
     * @param id        새 행에 쓸 id — 충돌로 무시되면 버려진다
     * @param blockerId 차단하는 쪽
     * @param blockedId 차단당하는 쪽
     * @return 꽂힌 행 수. {@code 0} 이면 이미 차단된 상태 — 멱등 성공으로 올린다
     */
    @Modifying
    @Query(value = "INSERT INTO user_blocks (id, blocker_id, blocked_id, created_at) "
            + "VALUES (:id, :blockerId, :blockedId, now()) ON CONFLICT DO NOTHING", nativeQuery = true)
    int insertIgnoreConflict(@Param("id") UUID id,
                             @Param("blockerId") UUID blockerId,
                             @Param("blockedId") UUID blockedId);

    /**
     * 차단 목록을 상대 유저와 함께 읽는다 (GROMO-1975) — JOIN FETCH 로 항목 직렬화의 N+1 을 막는다.
     * 정렬은 최근 차단이 먼저다.
     *
     * @param blocker 목록의 주인
     * @return 이 유저가 차단한 관계, 최신순
     */
    @Query("SELECT b FROM UserBlock b JOIN FETCH b.blocked"
            + " WHERE b.blocker = :blocker ORDER BY b.createdAt DESC")
    List<UserBlock> findAllByBlockerWithBlocked(@Param("blocker") User blocker);

    /**
     * 내가 차단한 상대 id 집합 — <b>방향 고정</b>(blocker → blocked) (GROMO-1975).
     * 친구 목록·검색·받은 편지함의 제외 대조표다. 나를 차단한 사람은 들어 있지 않다 —
     * 그쪽의 목록 계약은 이 집합의 책임이 아니다.
     *
     * @param blockerId 기준 유저
     * @return 내가 차단한 상대 id 들 — 없으면 빈 집합
     */
    @Query("SELECT b.blocked.id FROM UserBlock b WHERE b.blocker.id = :blockerId")
    Set<UUID> findBlockedIdsByBlockerId(@Param("blockerId") UUID blockerId);

    /**
     * 방향 고정 해제 (GROMO-1975) — (blocker → blocked) 한 방향만 지운다. 벌크 DELETE 라 없으면
     * 0 행이고 그 자체가 멱등이다 — 조회 후 remove 는 탈퇴 정리({@link #deleteAllInvolving})와 겹칠 때
     * StaleStateException 으로 500 이 난다. 대상 User 를 읽지 않으므로 존재하지 않는 UUID 도
     * 0 행으로 접힌다 — DELETE 멱등 계약이 요구하는 동작이다.
     *
     * @param blockerId 차단을 건 쪽
     * @param blockedId 해제할 대상
     * @return 지운 행 수. 0 = 이미 해제된 상태(멱등)
     */
    @Modifying(flushAutomatically = true)
    @Query("DELETE FROM UserBlock b WHERE b.blocker.id = :blockerId AND b.blocked.id = :blockedId")
    int deleteByBlockerIdAndBlockedId(@Param("blockerId") UUID blockerId, @Param("blockedId") UUID blockedId);

    /**
     * 탈퇴자가 낀 차단을 <b>양방향 모두</b> 지운다 (GROMO-1801 · 계정 LLD §4 user_blocks).
     *
     * <p>한 방향만 지우거나 삭제 flag 로 남기면 관계 원문이 남는다. UserBlock 은 cascade·콜백이 없는
     * 단순 매핑이라 벌크로 잃는 것이 없다.
     *
     * @param userId 탈퇴하는 유저
     * @return 지운 행 수. 0 도 정상이다
     */
    @Modifying(flushAutomatically = true)
    @Query("DELETE FROM UserBlock b WHERE b.blocker.id = :userId OR b.blocked.id = :userId")
    int deleteAllInvolving(@Param("userId") UUID userId);
}
