package com.oneorthree.phone.group.repository;

import com.oneorthree.phone.group.repository.domain.UserMainIsland;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;
import java.util.UUID;

/**
 * 명시적으로 고른 메인 섬 행 (GROMO-1971, V81).
 *
 * <p><b>행이 없는 것은 오류가 아니다</b> — 아직 고른 적 없다는 뜻이고, 그때의 메인 섬은
 * {@code MainIslandService} 가 활성 멤버십에서 도출한다. 그래서 여기에는 「없으면 던지는」 조회가 없다.
 */
public interface UserMainIslandRepository extends JpaRepository<UserMainIsland, UUID> {

    /**
     * 명시 선택분의 섬 <b>이름까지</b> 한 번에 — 친구 목록의 N+1 방지.
     *
     * @param userIds 조회 대상. 비어 있으면 빈 목록
     * @return 행이 있는 사용자분만. <b>없는 사용자는 결과에서 빠지므로</b> 호출측이 도출로 메운다
     */
    @Query("SELECT new com.oneorthree.phone.group.repository.UserIslandNameProjection("
            + "m.userId, m.island.id, m.island.name) FROM UserMainIsland m WHERE m.userId IN :userIds")
    List<UserIslandNameProjection> findChosenByUserIdIn(@Param("userIds") Collection<UUID> userIds);

    /**
     * 한 사용자의 메인 섬 이전을 <b>직렬화</b>하는 트랜잭션 스코프 advisory lock (GROMO-1971).
     *
     * <h2>무엇을 막는가</h2>
     * 이탈·강퇴는 대상 사용자의 {@code users} 행을 <b>공유</b> 잠금으로만 잡는다
     * ({@code getCallerForShare}·{@code getTargetForShare}). 그래서 같은 사람이 <b>서로 다른 두 섬</b>에서
     * 동시에 회수되면 두 트랜잭션이 각자 다른 멤버십 행만 잡고 <b>나란히 돈다</b>. 그러면 A(메인)를
     * 회수하는 쪽이 아직 커밋되지 않은 C 회수를 보지 못해 C 를 후보로 고르고, C 를 회수하는 쪽은 갱신 전
     * 메인(A)을 읽어 「내 섬은 메인이 아니다」로 지나간다 — 최종적으로 <b>이미 떠난 섬</b>이 메인으로 박힌다.
     * 「유효하지 않은 섬을 반환하지 않는다」가 바로 이 경로로 깨진다.
     *
     * <h2>왜 행 잠금이 아니라 advisory 인가</h2>
     * 잠글 행이 <b>아직 없을 수도</b> 있다 — 고른 적 없는 사람은 {@code user_main_islands} 에 행이 없고,
     * 이 기능은 그 «행 없음»이 정상 상태다({@code MainIslandService} 의 도출). {@code users} 행을 배타로
     * <b>승급</b>하는 쪽은 더 나쁘다: 두 회수가 이미 공유 잠금을 쥐고 있어 서로의 해제를 기다리는
     * <b>승급 교착</b>이 되고, 그건 종전에 교착이 없던 강퇴·이탈 경로에 교착을 새로 심는 일이다
     * ({@code UserRepository} 의 「락 선택 원칙」).
     *
     * <h2>잠금 순서</h2>
     * 이 잠금은 <b>오직 이 훅만</b> 잡는 새 축이고, 회수 경로가 {@code users} → 섬 → 멤버십을 이미 잡은
     * <b>뒤</b>(꼬리)에서 잡는다. 잡은 채로는 {@code user_main_islands} 행 하나만 더 건드린다 — 그 테이블을
     * 만지는 다른 경로가 없으므로 기존 잠금과 순환을 만들 수 없다. 같은 트랜잭션이 나중에 잡는
     * {@code USER} aggregate(알림 flush)도 <b>모든</b> 회수가 같은 순서(advisory → USER)로 지나므로
     * 역순 쌍이 생기지 않는다. 계정 탈퇴는 {@code users} 를 배타로 쥐고 있어 애초에 겹치지 않는다.
     *
     * @param key 축 문자열 {@code "main-island:{userId}"}
     * @return 항상 true — 반환값이 아니라 <b>호출 자체</b>가 잠금이다
     */
    @Query(value = "SELECT true FROM (SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))) locked",
            nativeQuery = true)
    boolean lockUserAxis(@Param("key") String key);
}
