package com.oneorthree.phone.user.repository;

import com.oneorthree.phone.user.repository.domain.User;
import jakarta.persistence.LockModeType;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * 유저 행의 저장·조회 지점. 세 가지가 이 인터페이스의 메서드 수를 설명한다.
 *
 * <p><b>소프트 딜리트</b> — 탈퇴는 행 삭제가 아니라 {@code is_deleted=true} 다. 그래서 활성 유저만 봐야 하는
 * 경로는 이름에 그 조건이 드러난 메서드를 쓰고, 조건이 없는 메서드({@link #existsByNicknameIgnoreCaseAndIdNot}
 * 등)는 <b>탈퇴 유저까지 잡는다</b> — 호출측이 따로 걸러야 한다.
 *
 * <p><b>락 선택</b> — 그 트랜잭션이 users 행을 <b>변경</b>하면 처음부터 배타 락({@link #findActiveByIdForUpdate}),
 * <b>읽기만</b> 하면 공유 락({@link #findActiveByIdForShare})이다. 공유로 읽고 나중에 UPDATE 하면 락 승급
 * 교착이 난다. 락 조회가 빈 결과면 "탈퇴가 먼저 커밋됐다"로 읽는데, 이 논증은 READ COMMITTED 의 술어
 * 재평가에 기대고 있다.
 *
 * <p><b>단일 컬럼 조건부 UPDATE</b> — {@link User} 에 {@code @Version} 도 {@code @DynamicUpdate} 도 없어
 * 더티 체킹은 <b>전 컬럼을 스냅샷으로 덮어쓴다</b>. 그래서 활동 시각 갱신은 전부
 * {@code @Modifying} 벌크 UPDATE 로 한 컬럼만 조건부로 건드린다 — 그러지 않으면 그 사이 커밋된 탈퇴가
 * 되살아나거나 다른 갱신이 조용히 사라진다(lost update). 벌크라 영속성 컨텍스트도 우회한다.
 */
public interface UserRepository extends JpaRepository<User, UUID> {

    /**
     * 소프트딜리트(탈퇴) 유저 차단 (GROMO-635) — is_deleted=true 인 유저는 조회/변경 경로에서 제외.
     *
     * @param id 조회 대상
     * @return 활성 유저. 없거나 탈퇴했으면 빈 값(호출측은 보통 404 로 바꾼다).
     *         <b>락이 없어</b> 동시에 도는 탈퇴와 직렬화되지 않으므로, users 행을 잠가야 하는 쓰기 경로엔 쓰지 않는다
     */
    Optional<User> findByIdAndIsDeletedFalse(UUID id);

    /**
     * 탈퇴 트랜잭션의 대상 유저 배타 락 (GROMO-801).
     * withdraw 는 friendships 를 스캔해 정리한 뒤 is_deleted 를 세우는데, READ COMMITTED 에서
     * 그 사이 다른 트랜잭션이 아직 커밋 안 된 is_deleted=true 를 못 보고 새 친구 요청을 끼워 넣으면
     * 정리를 통과해 유령 관계가 남는다. 탈퇴 시작 시점에 대상 행을 잠가 관계 생성과 직렬화한다.
     *
     * 락 선택 원칙 (codex 리뷰 3차) — **그 트랜잭션이 users 행을 변경하면 처음부터 이 배타 락**을 쓴다
     * (탈퇴, 소셜 로그인/게스트 승격의 isGuest 갱신). 공유 락으로 읽고 나중에 UPDATE
     * 하면, 같은 행을 잡은 두 트랜잭션이 서로의 공유 락 해제를 기다리며 락 승급 교착으로 죽는다.
     * users 행을 읽기만 하는 트랜잭션(관계·멤버십·내기 생성)은 아래 공유 락으로 병렬성을 지킨다.
     *
     * READ COMMITTED 재평가 전제 (GROMO-1230) — 이 배타 락과 아래 공유 락(findActiveByIdForShare)의
     * "빈 결과 = 탈퇴 확정" 논증이 공유하는 메커니즘. READ COMMITTED 에서 락 대기에 걸린 조회는 상대
     * 트랜잭션이 커밋하면 잠금을 얻은 뒤 그 행의 **최신 커밋 버전으로 WHERE 술어를 재평가**한다
     * (Postgres EvalPlanQual). 그래서 탈퇴(is_deleted=true)와 경합해도 스냅샷의 옛 활성 행이 아니라
     * 빈 결과를 돌려받고, 호출측은 그것을 "탈퇴가 먼저 커밋됐다"로 읽고 skip/404 한다
     * (섬 위임·강퇴 GroupMemberService 등이 이 전제 위에 있다).
     * 격리 수준을 REPEATABLE READ 이상으로 올리면 같은 경합이 재평가 대신 직렬화 오류로 터지므로
     * 이 논증들은 그대로 성립하지 않는다 — 격리 수준을 바꾸려면 락 논증 전면 재검토가 필요하다.
     *
     * @param id 잠글 유저
     * @return 잠긴 활성 유저. 빈 값은 "없는 유저" 또는 <b>"탈퇴가 먼저 커밋됐다"</b>는 뜻이라 호출측은 그대로 중단한다.
     *         반환된 행은 트랜잭션이 끝날 때까지 배타 잠금 상태다
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT u FROM User u WHERE u.id = :id AND u.isDeleted = false")
    Optional<User> findActiveByIdForUpdate(@Param("id") UUID id);

    /**
     * 게스트 승격(loginOrRegister) 전용 — 활성 **게스트** 행만 배타 락으로 잠근다 (GROMO-801, codex 리뷰 4차).
     * isGuest 술어가 쿼리 안에 있는 이유: 비게스트 인증 상태로 다른 소셜 계정에 로그인하는 "계정 전환"
     * 에서 (버려질) 현재 유저 A 까지 잠그면 트랜잭션 하나가 users 2행(현재 A + 로그인 대상 B)을 잠가,
     * 역방향 전환 2건이 A→B / B→A 순서로 교착할 수 있다. 게스트만 잠그면 ① 승격 트랜잭션은 대상이
     * 곧 본인이라 자기 1행만 잠그고 ② 비게스트 전환은 이 조회가 0행(락 없음) → 이후 재검증이 대상 B
     * 1행만 잠근다 — 어떤 로그인 트랜잭션도 users 2행을 잠그지 않으므로 잠금 순서 문제가 원천 제거된다.
     *
     * @param id 승격 대상 후보
     * @return 잠긴 활성 <b>게스트</b>. 이미 승격됐거나(비게스트) 탈퇴했으면 빈 값이고, 그건 오류가 아니라
     *         "계정 전환 경로"라는 신호다 — 호출측이 대상 계정을 따로 잠근다
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT u FROM User u WHERE u.id = :id AND u.isDeleted = false AND u.isGuest = true")
    Optional<User> findActiveGuestByIdForUpdate(@Param("id") UUID id);

    /**
     * 관계·멤버십·내기 생성 등 users 행을 **읽기만 하는** 트랜잭션의 활성 검증 + 공유 락 (GROMO-801).
     * 공유 락끼리는 충돌하지 않아 동시 요청은 그대로 병렬이고, 위 배타 락(탈퇴)하고만 직렬화된다.
     * 탈퇴가 먼저 커밋되면 잠금 해제 후 조건을 재평가해 is_deleted=true 를 보고 빈 결과가 된다
     * (READ COMMITTED 재평가 전제 — findActiveByIdForUpdate 주석 참고).
     * 주의: 같은 트랜잭션이 이후 users 행을 UPDATE 한다면 이 락을 쓰면 안 된다(승급 교착) —
     * 그 경우 위 findActiveByIdForUpdate 로 처음부터 배타 락을 잡는다 (락 선택 원칙 참고).
     *
     * @param id 검증할 유저
     * @return 잠긴 활성 유저. 빈 값은 "탈퇴가 먼저 커밋됐다"로 읽는다.
     *         <b>읽기 전용 트랜잭션에서는 쓸 수 없다</b> — Postgres 가 read-only 트랜잭션의 {@code FOR SHARE} 를 거절한다
     */
    @Lock(LockModeType.PESSIMISTIC_READ)
    @Query("SELECT u FROM User u WHERE u.id = :id AND u.isDeleted = false")
    Optional<User> findActiveByIdForShare(@Param("id") UUID id);

    /**
     * 여러 사용자 정보를 한 번에 읽는 경로의 활성 사용자 엔티티 배치 조회.
     *
     * @param ids 조회 대상
     * @return 활성 유저 엔티티. 탈퇴·부재분은 빠진다. <b>락이 없으므로</b> 여기서 얻은 엔티티를 더티 체킹으로
     *         고치면 전 컬럼 UPDATE 가 나가 동시 갱신을 덮어쓸 수 있다
     */
    List<User> findAllByIdInAndIsDeletedFalse(Collection<UUID> ids);

    /**
     * 닉네임 중복 검사 (GROMO-584) — 본인 제외로 자기 닉네임 재사용은 허용.
     * <b>대소문자를 구분하지 않는다</b> (GROMO-1996, policy-2026-09-14
     * 「닉네임은 대소문자를 구분하지 않고 중복될 수 없으며 앞뒤 공백 없이 저장한다」).
     *
     * <p>종전의 정확 일치 검사({@code existsByNicknameAndIdNot})를 대체하며 그 메서드는 함께 지웠다 —
     * 정확 일치만 검사하면 {@code Alice} 와 {@code alice} 가 둘 다 가입되고, 그 상태에서 대소문자 무시
     * «검색»을 켜면 한 질의에 두 사람이 잡혀 정책의 「정확히 일치할 때만」이 깨진다. 검색과 유일성은
     * 같은 축이어야 한다.
     *
     * <p>DB 도 같은 축으로 막는다 — {@code uq_users_nickname_lower}(V89)가 TOCTOU 레이스의 최종
     * 방어선이고, 이 표현식 인덱스가 아래 검색의 인덱스이기도 하다.
     *
     * <p><b>탈퇴 유저까지 센다</b> — 종전과 같은 취급이다. 다만 탈퇴는 닉네임을 NULL 로 파기하므로
     * 실제로 걸리는 행은 파기 전뿐이고, {@code lower(NULL)} 은 NULL 이라 어떤 질의와도 매치되지 않는다.
     *
     * @param nickname 검사할 닉네임
     * @param id       본인 id — 자기 닉네임의 대소문자만 바꾸는 변경을 막지 않으려고 제외한다
     * @return 대소문자를 빼고 같은 닉네임을 다른 유저가 이미 쓰고 있으면 true
     */
    @Query("SELECT COUNT(u) > 0 FROM User u WHERE lower(u.nickname) = lower(:nickname) AND u.id <> :id")
    boolean existsByNicknameIgnoreCaseAndIdNot(@Param("nickname") String nickname, @Param("id") UUID id);

    /**
     * 친구 검색의 <b>유일한</b> 조회 (GROMO-1996, policy-2026-09-14 「친구 검색은 대소문자를 구분하지
     * 않고 정확히 일치할 때만 결과를 보여 주며 본인과 탈퇴한 사용자는 제외한다」).
     *
     * <p>종전의 pg_trgm 유사도 검색({@code searchByNicknameTrgm})을 대체하며 그 메서드는 함께 지웠다 —
     * 부분 일치는 「누가 이 앱을 쓰는가」를 훑게 해 주는데, 친구 추가는 상대의 닉네임을 이미 아는
     * 사람만 하면 되는 일이다. DB 의 {@code idx_users_nickname_trgm} 은 안정화 전까지 남겨 둔다(V89 주석).
     *
     * <p><b>탈퇴자 제외가 쿼리 안에 있다.</b> 함께 지운 {@code findByNickname} 은 그 조건이 없어 호출측이
     * 따로 걸러야 했는데, 검색은 결과를 «그대로» 내보내는 경로라 걸러지지 않으면 탈퇴자가 화면에 뜬다.
     * <b>본인 제외는 여기가 아니라 {@code FriendService.search} 다</b> — 관계 배지 판정과 같은 자리라야
     * 두 필터가 갈라지지 않는다.
     *
     * <p>인덱스는 {@code uq_users_nickname_lower}(V89) — 같은 {@code lower(nickname)} 표현식이다.
     *
     * @param nickname 검색어. 호출측이 strip 해서 넘긴다(저장도 strip 이므로 앞뒤 공백은 무의미하다 — GROMO-2051)
     * @return 그 닉네임을 쓰는 활성 유저 한 명. 유일성이 보장하므로 둘 이상일 수 없다
     */
    @Query("SELECT u FROM User u WHERE lower(u.nickname) = lower(:nickname) AND u.isDeleted = false")
    Optional<User> findActiveByNicknameIgnoreCase(@Param("nickname") String nickname);

    /**
     * 잡지 발행 알림 대상 한 쪽(GROMO-2307) — 활성 <b>정식</b> 유저를 id 순 키셋으로 훑는다.
     * 게스트·탈퇴 계정을 제외하며 날짜 창은 적용하지 않는다.
     *
     * <p><b>잠금 없이</b> 읽는다 — 쪽 전체(200행)를 FCM 왕복 동안 잠그면 프로필 수정·접속 갱신이 그만큼 대기한다. 호출부는
     * id·언어만 쓰고, 탈퇴와의 직렬화가 필요하면 사용자별 짧은 트랜잭션에서 {@code findActiveByIdForShare} 로 다시 읽는다
     * ({@code MagazineIssueNotifier}).
     *
     * @param after    직전 쪽의 마지막 id(첫 쪽은 nil UUID)
     * @param pageable 쪽 크기만 쓴다({@code PageRequest.ofSize})
     * @return id 오름차순 최대 쪽 크기만큼
     */
    @Query("SELECT u FROM User u WHERE u.isGuest = false AND u.isDeleted = false AND u.id > :after ORDER BY u.id")
    List<User> findFormalUsersAfter(@Param("after") UUID after, Pageable pageable);
}
