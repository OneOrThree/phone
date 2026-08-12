package com.oneorthree.phone.user.repository;

import com.oneorthree.phone.user.domain.User;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface UserRepository extends JpaRepository<User, UUID> {

    Optional<User> findByNickname(String nickname);

    // 소프트딜리트(탈퇴) 유저 차단 (GROMO-635) — is_deleted=true 인 유저는 조회/변경 경로에서 제외.
    Optional<User> findByIdAndIsDeletedFalse(UUID id);

    // 탈퇴 트랜잭션의 대상 유저 배타 락 (GROMO-801).
    // withdraw 는 friendships·pinned_users 를 스캔해 정리한 뒤 is_deleted 를 세우는데, READ COMMITTED 에서
    // 그 사이 다른 트랜잭션이 아직 커밋 안 된 is_deleted=true 를 못 보고 새 친구요청·핀을 끼워 넣으면
    // 정리를 통과해 유령 관계가 남는다. 탈퇴 시작 시점에 대상 행을 잠가 관계 생성과 직렬화한다.
    //
    // 락 선택 원칙 (codex 리뷰 3차) — **그 트랜잭션이 users 행을 변경하면 처음부터 이 배타 락**을 쓴다
    // (탈퇴, 소셜 로그인/게스트 승격의 refreshTokenHash·isGuest 갱신). 공유 락으로 읽고 나중에 UPDATE
    // 하면, 같은 행을 잡은 두 트랜잭션이 서로의 공유 락 해제를 기다리며 락 승급 교착으로 죽는다.
    // users 행을 읽기만 하는 트랜잭션(관계·멤버십·내기 생성)은 아래 공유 락으로 병렬성을 지킨다.
    //
    // READ COMMITTED 재평가 전제 (GROMO-1230) — 이 배타 락과 아래 공유 락(findActiveByIdForShare)의
    // "빈 결과 = 탈퇴 확정" 논증이 공유하는 메커니즘. READ COMMITTED 에서 락 대기에 걸린 조회는 상대
    // 트랜잭션이 커밋하면 잠금을 얻은 뒤 그 행의 **최신 커밋 버전으로 WHERE 술어를 재평가**한다
    // (Postgres EvalPlanQual). 그래서 탈퇴(is_deleted=true)와 경합해도 스냅샷의 옛 활성 행이 아니라
    // 빈 결과를 돌려받고, 호출측은 그것을 "탈퇴가 먼저 커밋됐다"로 읽고 skip/404 한다
    // (리그 정산 LeagueUserSettler, 그룹 위임·강퇴 GroupMemberService 등이 전부 이 전제 위에 있다).
    // 격리 수준을 REPEATABLE READ 이상으로 올리면 같은 경합이 재평가 대신 직렬화 오류로 터지므로
    // 이 논증들은 그대로 성립하지 않는다 — 격리 수준을 바꾸려면 락 논증 전면 재검토가 필요하다.
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT u FROM User u WHERE u.id = :id AND u.isDeleted = false")
    Optional<User> findActiveByIdForUpdate(@Param("id") UUID id);

    // 무효 토큰 정리 전용 — device_token 한 컬럼만 조건부로 지운다 (GROMO-1090 @codex 리뷰 P1).
    //
    // 더티체킹(user.setDeviceToken(null))으로 지우면 안 되는 이유: User 에 @Version·@DynamicUpdate 가
    // 없어 커밋 시 UPDATE 가 전체 컬럼을 이 트랜잭션의 스냅샷으로 덮어쓴다. 발송 대상을 읽은 뒤
    // FCM 응답이 오기 전에 withdraw 가 먼저 커밋되면(is_deleted=true·닉네임 등 PII 파기), 그 뒤 나가는
    // 이 UPDATE 가 옛 스냅샷으로 되돌려 탈퇴 계정과 PII 가 되살아난다. 발송이 비동기·크론이라 그 간격은
    // 짧지 않고, FCM RestClient 에 타임아웃도 없다.
    //
    // is_deleted = false 조건이 그 창을 닫는다 — 탈퇴가 먼저 커밋됐다면 0행이 되어 아무것도 되돌리지 않는다.
    //
    // device_token = :invalidToken 조건도 같은 이유다: FCM 에 보낸 토큰이 무효라는 응답을 기다리는 사이
    // 클라이언트가 새 토큰을 등록(registerDeviceToken)하면, id 만 보고 지울 경우 **새 토큰까지** 날아가
    // 다음 등록 전까지 그 유저의 모든 푸시가 사라진다. 토큰 회전은 정상 시나리오다.
    // 실제로 보냈던 토큰과 일치할 때만 지운다.
    //
    // clearAutomatically=false: 호출측(발송 루프)이 들고 있는 다른 영속 엔티티를 detach 시키지 않기 위함.
    @Modifying(clearAutomatically = false, flushAutomatically = false)
    @Query("UPDATE User u SET u.deviceToken = null"
            + " WHERE u.id = :id AND u.isDeleted = false AND u.deviceToken = :invalidToken")
    int clearDeviceToken(@Param("id") UUID id, @Param("invalidToken") String invalidToken);

    // 게스트 승격(loginOrRegister) 전용 — 활성 **게스트** 행만 배타 락으로 잠근다 (GROMO-801, codex 리뷰 4차).
    // isGuest 술어가 쿼리 안에 있는 이유: 비게스트 인증 상태로 다른 소셜 계정에 로그인하는 "계정 전환"
    // 에서 (버려질) 현재 유저 A 까지 잠그면 트랜잭션 하나가 users 2행(현재 A + 로그인 대상 B)을 잠가,
    // 역방향 전환 2건이 A→B / B→A 순서로 교착할 수 있다. 게스트만 잠그면 ① 승격 트랜잭션은 대상이
    // 곧 본인이라 자기 1행만 잠그고 ② 비게스트 전환은 이 조회가 0행(락 없음) → 이후 재검증이 대상 B
    // 1행만 잠근다 — 어떤 로그인 트랜잭션도 users 2행을 잠그지 않으므로 잠금 순서 문제가 원천 제거된다.
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT u FROM User u WHERE u.id = :id AND u.isDeleted = false AND u.isGuest = true")
    Optional<User> findActiveGuestByIdForUpdate(@Param("id") UUID id);

    // 관계·멤버십·내기 생성 등 users 행을 **읽기만 하는** 트랜잭션의 활성 검증 + 공유 락 (GROMO-801).
    // 공유 락끼리는 충돌하지 않아 동시 요청은 그대로 병렬이고, 위 배타 락(탈퇴)하고만 직렬화된다.
    // 탈퇴가 먼저 커밋되면 잠금 해제 후 조건을 재평가해 is_deleted=true 를 보고 빈 결과가 된다
    // (READ COMMITTED 재평가 전제 — findActiveByIdForUpdate 주석 참고).
    // 주의: 같은 트랜잭션이 이후 users 행을 UPDATE 한다면 이 락을 쓰면 안 된다(승급 교착) —
    // 그 경우 위 findActiveByIdForUpdate 로 처음부터 배타 락을 잡는다 (락 선택 원칙 참고).
    @Lock(LockModeType.PESSIMISTIC_READ)
    @Query("SELECT u FROM User u WHERE u.id = :id AND u.isDeleted = false")
    Optional<User> findActiveByIdForShare(@Param("id") UUID id);

    @Query("SELECT new com.oneorthree.phone.user.repository.UserTierLevelProjection(u.id, u.tierLevel)"
            + " FROM User u WHERE u.id IN :ids AND u.isDeleted = false")
    List<UserTierLevelProjection> findTierLevelsByIdInAndIsDeletedFalse(@Param("ids") Collection<UUID> ids);

    /** 티어 정산처럼 실제 User 변경이 필요한 경로의 활성 사용자 엔티티 배치 조회. */
    List<User> findAllByIdInAndIsDeletedFalse(Collection<UUID> ids);

    // 인증 hot path 단일 조회 (GROMO-903) — 탈퇴 차단 판정(827)과 활동 갱신 판정(578)을 한 왕복으로 병합.
    // 이전엔 존재 확인(왕복 ①) 직후 오늘 이미 갱신된 유저에게도 UPDATE 트랜잭션(왕복 ②)이 매 요청 붙었다.
    // 왕복 ① 이 이미 그 유저 행을 PK 로 찾으므로, last_active_at 을 함께 읽어오면 왕복을 늘리지 않고 스로틀 판정이 끝난다.
    // empty = 없는 유저 or 소프트딜리트 → existsByIdAndIsDeletedFalse 가 false 이던 집합과 동일(=401 신호 불변).
    // (last_active_at 은 NOT NULL 이라 "행은 있는데 값이 null" 로 empty 가 되는 경우는 없다)
    @Query("SELECT u.lastActiveAt FROM User u WHERE u.id = :id AND u.isDeleted = false")
    Optional<Instant> findLastActiveAtIfActive(@Param("id") UUID id);

    // 닉네임 중복 검사 (GROMO-584) — 본인 제외(AndIdNot)로 자기 닉네임 재사용은 허용.
    boolean existsByNicknameAndIdNot(String nickname, UUID id);

    Optional<User> findByRefreshTokenHash(String hash);

    /**
     * refresh 토큰 해시 조건부 교체 (GROMO-1509) — 회전 전용. 바뀐 행 수를 반환한다.
     *
     * <p>엔티티 필드를 고쳐 dirty checking 에 맡기면 안 된다. {@link User} 에는 {@code @Version} 도
     * {@code @DynamicUpdate} 도 없어 <b>full-row UPDATE</b> 가 나가는데, 회전 경로는 해시를 락 없이
     * ({@link #findByRefreshTokenHash}) 읽으므로 그 스냅샷이 이미 낡았을 수 있다. 조회와 flush 사이에
     * 탈퇴(withdraw, 배타 락)가 커밋되면 낡은 스냅샷이 {@code is_deleted=true} 와 파기된 PII 를 통째로
     * 되살리고, 그 계정에 유효한 refresh 토큰까지 쥐여준다.
     *
     * <p>그래서 해시 컬럼만, 그것도 "여전히 활성이고 해시가 그대로일 때만" 바꾸는 조건부 UPDATE 로
     * 쓴다. 다른 컬럼을 건드리지 않으니 되살릴 것이 없고, 조건이 곧 compare-and-swap 이라 탈퇴·
     * 로그아웃·다른 기기 로그인과의 경합을 한 번에 막는다. <b>0 이면 그 사이 세션이 끊긴 것이므로
     * 회전을 포기하고 거절해야 한다</b>(끊긴 세션 부활 금지).
     */
    @Modifying
    @Query("UPDATE User u SET u.refreshTokenHash = :newHash"
            + " WHERE u.id = :id AND u.refreshTokenHash = :expectedHash AND u.isDeleted = false")
    int rotateRefreshTokenHash(@Param("id") UUID id,
                               @Param("expectedHash") String expectedHash,
                               @Param("newHash") String newHash);

    // 닉네임 trgm fuzzy 검색 (NicknameSearchStrategy에서 호출).
    // 전제: pg_trgm 확장 + users.nickname GIN trgm 인덱스 (run-migration-v13.sh).
    // % = 트라이그램 유사도 매칭, <-> = 거리(가까운 순). 임계값 튜닝은 실데이터 기준(한글 gotcha 주의).
    @Query(value = "SELECT * FROM users u"
            + " WHERE u.nickname % :q AND u.is_deleted = false"
            + " ORDER BY u.nickname <-> :q"
            + " LIMIT :limit", nativeQuery = true)
    List<User> searchByNicknameTrgm(@Param("q") String q, @Param("limit") int limit);

    // last_active_at 스로틀 갱신 (GROMO-578) — JwtFilter 인증 통과 지점에서 호출.
    // WHERE 의 last_active_at < :staleBefore 가드로 스로틀 창당 최대 1 row write/유저 (이미 최신이면 0건 매치=무쓰기).
    // 호출측이 needsTouch 로 이미 걸러 보내므로 이 가드는 동시 요청 레이스의 최종 방어선이다 (GROMO-903).
    // User 엔티티 로드 없이 UPDATE 만 — @Modifying 이라 호출측 @Transactional 필요.
    @Modifying
    @Query("UPDATE User u SET u.lastActiveAt = :now"
            + " WHERE u.id = :id AND u.lastActiveAt < :staleBefore")
    int touchLastActiveAt(@Param("id") UUID id,
                          @Param("now") Instant now,
                          @Param("staleBefore") Instant staleBefore);

    // 누끼 생성 trial 앵커 최초 1회 세팅 — 유저가 쿼터를 처음 조회/기록하는 시점에 호출.
    // touchLastActiveAt 과 같은 이유로 엔티티 로드 후 setter 가 아니라 단일 컬럼 UPDATE 다: User 는
    // @DynamicUpdate 가 아니라 더티 필드 하나만 있어도 전 컬럼을 flush 해, 같은 유저에게 동시에 도는
    // touchLastActiveAt 등의 갱신을 조용히 되돌릴 수 있다(lost update).
    // WHERE ... IS NULL 가드로 동시 요청에서도 앵커는 최초 1건만 박힌다(멱등).
    @Modifying
    @Query("UPDATE User u SET u.characterTrialAnchorAt = :now"
            + " WHERE u.id = :id AND u.characterTrialAnchorAt IS NULL")
    int initCharacterTrialAnchorAt(@Param("id") UUID id, @Param("now") Instant now);

    // 미접속 복귀 푸시 대상 조회 (GROMO-578) — last_active_at 가 [startInclusive, endExclusive) KST 하루 구간에 든 유저.
    // 호출측이 D+3/7/14 각 단계의 KST 캘린더 하루 경계를 주입 → "정확히 N일째" 판정. isGuest·소프트딜리트 유저는 제외.
    // (deviceToken·알림설정 필터는 sendIfAllowed 가 처리 — 여기선 대상 셋만 좁힘)
    @Query("SELECT u FROM User u"
            + " WHERE u.isGuest = false AND u.isDeleted = false"
            + " AND u.lastActiveAt >= :startInclusive AND u.lastActiveAt < :endExclusive")
    List<User> findInactiveReturnTargets(@Param("startInclusive") Instant startInclusive,
                                         @Param("endExclusive") Instant endExclusive);
}
