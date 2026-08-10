package com.oneorthree.phone.group.repository;

import com.oneorthree.phone.group.domain.GroupChallengeMember;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDate;
import java.util.Collection;
import java.util.List;
import java.util.UUID;

/**
 * 스크린타임 창 사용분 보고 저장소 — 판정은 조회 시 계산하고, 여기는 클라 보고 원본값만 담는다
 * ({@link GroupChallengeMember} 주석 참고).
 */
public interface GroupChallengeMemberRepository extends JpaRepository<GroupChallengeMember, UUID> {

    /** 진행률 조립용 — 창형 챌린지들의 해당 날짜 보고값을 IN 절 1회로 배치 로드한다(N+1 방지). */
    List<GroupChallengeMember> findByGroupChallengeIdInAndUsageDate(
            Collection<UUID> challengeIds, LocalDate usageDate);

    /**
     * 창 사용분 보고 upsert — (챌린지, 유저, 날짜)당 1행, 마지막 값 승리(중간 보고 허용).
     *
     * <p>V20 유니크 (group_challenge_id, user_id, usage_date) 가 동시 보고 레이스의 방어선이다 —
     * {@code ON CONFLICT} 로 삽입/갱신을 원자화해 check-then-insert 경합 자체를 없앤다.
     * 네이티브 경로라 {@code @GeneratedUuidV7} 이 타지 않으므로 id 는 호출측이 UUID v7 로 생성해 넘긴다
     * (충돌 시 기존 행 id 유지 — 넘긴 id 는 버려진다).
     */
    @Modifying
    @Query(value = "INSERT INTO group_challenge_members"
            + " (id, group_challenge_id, user_id, usage_date, progress_minutes, created_at, updated_at)"
            + " VALUES (:id, :challengeId, :userId, :usageDate, :usedMinutes, now(), now())"
            + " ON CONFLICT (group_challenge_id, user_id, usage_date)"
            + " DO UPDATE SET progress_minutes = EXCLUDED.progress_minutes, updated_at = now()", nativeQuery = true)
    void upsertWindowUsage(@Param("id") UUID id,
                           @Param("challengeId") UUID challengeId,
                           @Param("userId") UUID userId,
                           @Param("usageDate") LocalDate usageDate,
                           @Param("usedMinutes") int usedMinutes);
}
