package com.oneorthree.phone.group.repository;

import com.oneorthree.phone.group.domain.GroupChallengeBetParticipant;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDate;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface GroupChallengeBetParticipantRepository
        extends JpaRepository<GroupChallengeBetParticipant, UUID> {

    boolean existsBySessionIdAndUserId(UUID sessionId, UUID userId);

    long countBySessionId(UUID sessionId);

    /**
     * 조기 확정 대상(GROMO-1268, N11) — 유저가 참가 중인 그 날짜의 <b>FOCUS</b> OPEN 회차에서 아직
     * 미확정({@code achieved IS NULL})인 참가 행. 미션 스냅샷의 카테고리로 거르므로(SCREEN_TIME 은
     * 조기 확정 자체가 성립하지 않는다 — FR-23) 챌린지 조인이 없다. 회차 id 오름차순 — 호출측이
     * 이 순서로 <b>전부 잠근 뒤</b> 판정한다(탈퇴 연동 등 오름차순 경로와의 교차 데드락 방지, §5.4).
     */
    @Query("SELECT p FROM GroupChallengeBetParticipant p JOIN p.session s "
            + "WHERE p.user.id = :userId AND p.achieved IS NULL "
            + "AND s.status = com.oneorthree.phone.group.domain.GroupBetStatus.OPEN "
            + "AND s.sessionDate IN :dates "
            + "AND s.missionCategory = com.oneorthree.phone.group.domain.MissionCategory.FOCUS "
            + "ORDER BY s.id")
    List<GroupChallengeBetParticipant> findUnconfirmedOpenFocusByUserAndDates(
            @Param("userId") UUID userId,
            @Param("dates") Collection<LocalDate> dates);

    /**
     * 조기 정산 전원 확정 검사(GROMO-1268) — 미확정({@code achieved IS NULL}) 참가자 수.
     * {@code AFTER_COMMIT} 리스너가 커밋된 상태 기준으로 세고, 최종 판정은 {@code settle(EARLY)}
     * 가 회차 락 안에서 다시 한다(리스너의 무락 검사는 낡았을 수 있다 — LLD §5.2).
     */
    @Query("SELECT COUNT(p) FROM GroupChallengeBetParticipant p "
            + "WHERE p.session.id = :sessionId AND p.achieved IS NULL")
    long countBySessionIdAndAchievedIsNull(@Param("sessionId") UUID sessionId);

    /**
     * 잠금 후 재조회용 단건 — 회차 행 잠금을 잡은 <b>뒤</b> 내 참가 행이 아직 있는지 다시 본다
     * (1258 P0 이중 환불 재발 방지: 잠금 대기 중 취소·탈퇴가 이미 처리했으면 없어야 정상).
     */
    @EntityGraph(attributePaths = "user")
    Optional<GroupChallengeBetParticipant> findBySessionIdAndUserId(UUID sessionId, UUID userId);

    /**
     * 조회 조립·정산 공용 배치 로드. 응답에 닉네임이 필요하고 정산도 userId 를 봐야 하므로
     * user 를 함께 fetch 해 참가자 수만큼의 추가 SELECT 를 막는다.
     */
    @EntityGraph(attributePaths = "user")
    List<GroupChallengeBetParticipant> findBySessionIdIn(Collection<UUID> sessionIds);
}
