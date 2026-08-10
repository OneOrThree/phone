package com.oneorthree.phone.group.repository;

import com.oneorthree.phone.group.domain.GroupChallengeMember;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
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
     * 창 사용분 보고 upsert — (챌린지, 유저, 날짜)당 1행. 종전 "마지막 값 승리"에서
     * <b>measured_at 단조 갱신</b>(GROMO-1407·N34)으로 바뀌었다: 저장된 측정 시각보다 오래된 보고는
     * {@code DO UPDATE ... WHERE} 절이 조용히 버린다(0행) — 동시 sync 경합·지연 도착 요청이 최신값을
     * 낮은 옛 값으로 덮지 못한다(돈 경로). 같은 measured_at 재전송(재시도)은 갱신된다(멱등).
     *
     * <p>null 규칙: 저장값 null(레거시 행)이면 어떤 보고든 갱신 허용, 저장값이 있는데 들어온
     * measured_at 이 null(구앱)이면 <b>버린다</b> — 시각 없는 보고가 시각 있는 보고를 덮으면 역전
     * 방어가 무의미해진다.
     *
     * <p>V20 유니크 (group_challenge_id, user_id, usage_date) 가 동시 보고 레이스의 방어선이다 —
     * {@code ON CONFLICT} 로 삽입/갱신을 원자화해 check-then-insert 경합 자체를 없앤다.
     * 네이티브 경로라 {@code @GeneratedUuidV7} 이 타지 않으므로 id 는 호출측이 UUID v7 로 생성해 넘긴다
     * (충돌 시 기존 행 id 유지 — 넘긴 id 는 버려진다).
     *
     * @return 1 = 삽입/갱신됨, 0 = 역전 보고라 무시됨(호출측은 그대로 204 — 계약상 조용한 무시)
     */
    @Modifying
    @Query(value = "INSERT INTO group_challenge_members"
            + " (id, group_challenge_id, user_id, usage_date, progress_minutes, is_achieved, measured_at,"
            + " created_at, updated_at)"
            + " VALUES (:id, :challengeId, :userId, :usageDate, :usedMinutes, false, :measuredAt, now(), now())"
            + " ON CONFLICT (group_challenge_id, user_id, usage_date)"
            + " DO UPDATE SET progress_minutes = EXCLUDED.progress_minutes,"
            + " measured_at = EXCLUDED.measured_at, updated_at = now()"
            + " WHERE group_challenge_members.measured_at IS NULL"
            + " OR (EXCLUDED.measured_at IS NOT NULL"
            + " AND EXCLUDED.measured_at >= group_challenge_members.measured_at)", nativeQuery = true)
    int upsertWindowUsage(@Param("id") UUID id,
                          @Param("challengeId") UUID challengeId,
                          @Param("userId") UUID userId,
                          @Param("usageDate") LocalDate usageDate,
                          @Param("usedMinutes") int usedMinutes,
                          @Param("measuredAt") Instant measuredAt);

    /**
     * 참가 <b>직전</b>까지 쌓인 보고를 지운다(GROMO-1407 — 선기록 계열 차단). 참가 시점에 행을
     * 없애면 "미보고" 상태로 되돌아가고, 참가 이후의 보고만 참가자 게이트(회차 락 · OPEN · 시작
     * 이후)를 통과해 다시 쌓인다.
     *
     * <p>값을 0 으로 리셋하지 않고 <b>행을 지우는</b> 이유: {@code progress_minutes} 가 NOT NULL 이라
     * 0 으로 남기면 "0분 사용"이 되어 SCREEN_TIME 에서는 <b>완전 달성</b>이다 — 막으려던 바로 그
     * 결과다. 행이 없어야 미보고 = 미달성(FR-21)이라는 보수적 기본값으로 떨어진다. 클라는 누적값을
     * 보내므로 참가 직후 다음 sync 가 실제 값을 복원한다(정직한 사용자는 손해 보지 않는다).
     *
     * @return 지운 행 수(0 = 참가 전 보고가 없었다 — 정상 경로)
     */
    @Modifying(flushAutomatically = true)
    @Query("DELETE FROM GroupChallengeMember m WHERE m.groupChallenge.id = :challengeId "
            + "AND m.user.id = :userId AND m.usageDate = :usageDate")
    int deleteWindowUsage(@Param("challengeId") UUID challengeId,
                          @Param("userId") UUID userId,
                          @Param("usageDate") LocalDate usageDate);
}
