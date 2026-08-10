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
     * 보고 축 {@code (challengeId, userId, usageDate)} 의 <b>트랜잭션 스코프 advisory lock</b>
     * (GROMO-1407) — 창 사용분 쓰기(upsert)와 참가 시 무효화(delete)를 직렬화한다.
     *
     * <p><b>왜 행 잠금이 아니라 advisory 인가</b>: 잠글 행이 <b>아직 없을 수도</b> 있다(첫 보고는
     * INSERT 다). 회차 행을 대신 잠그면 같은 회차의 <b>모든 참가자·모든 표시용 보고</b>가 한 줄에
     * 서고 정산과도 부딪혀, N34 가 전제한 저지연 보고 경로가 무너진다. advisory 키를
     * <b>유저·날짜 단위</b>로 끊으면 같은 사람의 자기 요청끼리만 직렬화된다.
     *
     * <p><b>키 충돌</b>: {@code hashtextextended} 는 64비트 결정적 해시라 서로 다른 축이 같은 키로
     * 접힐 확률이 사실상 없고, 접히더라도 <b>정확성은 그대로다</b> — 무관한 두 요청이 잠깐 줄을 설
     * 뿐(지연만 는다). 잠금은 트랜잭션 종료 시 자동 해제되므로 누수도 없다.
     *
     * <p><b>잠금 순서</b>: 보고 경로는 {@code advisory → 회차 행}, 참가 경로는
     * {@code 회차 행 → advisory} 다. 역순이지만 교착이 성립하려면 같은 유저가 "이미 참가자"이면서
     * 동시에 "참가 중"이어야 하는데, 참가 경로는 그 경우 사전 검사에서
     * {@code BET_ALREADY_JOINED} 로 끝나 advisory 까지 오지 않는다.
     *
     * @param key 축 문자열 {@code "{challengeId}:{userId}:{usageDate}"}
     * @return 항상 true — 반환값이 아니라 <b>호출 자체</b>가 잠금이다(void 반환은 매핑이 불가해 상수를 돌려준다)
     */
    @Query(value = "SELECT true FROM (SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))) locked",
            nativeQuery = true)
    boolean lockReportAxis(@Param("key") String key);

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
