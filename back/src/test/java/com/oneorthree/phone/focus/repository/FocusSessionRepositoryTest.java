package com.oneorthree.phone.focus.repository;

import com.oneorthree.phone.common.support.RepositoryTestBase;
import com.oneorthree.phone.focus.domain.FocusSession;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.repository.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.Instant;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * FocusSessionRepository.findCompletedSessionsInPeriod JPQL 필터 통합 테스트.
 *
 * <p>Mockito 서비스 테스트로 검증 불가한 DB 레벨 필터(deletedAt IS NULL) 및
 * 자정 걸친 세션 귀속(endedAt 기준) 시나리오를 실 PostgreSQL(Testcontainers)로 검증한다.
 *
 * <p>참고: JPQL의 {@code endedAt IS NOT NULL} 조건은 엔티티 스키마
 * {@code @Column(nullable = false)}로 이미 DB 레벨에서 강제되므로, 해당 필터를
 * 단독으로 검증하는 통합 테스트는 생략한다(스키마 제약이 방어 역할을 담당).
 */
class FocusSessionRepositoryTest extends RepositoryTestBase {

    @Autowired
    private FocusSessionRepository focusSessionRepository;

    @Autowired
    private UserRepository userRepository;

    // 테스트 기준 시각: 2026-07-03 UTC
    // from = 2026-07-03 00:00:00 UTC (inclusive)
    // to   = 2026-07-04 00:00:00 UTC (exclusive 상한)
    private static final Instant FROM = Instant.parse("2026-07-03T00:00:00Z");
    private static final Instant TO   = Instant.parse("2026-07-04T00:00:00Z");

    private User user;

    @BeforeEach
    void setUp() {
        user = userRepository.save(User.builder().nickname("테스터").currentTier(1).build());
    }

    // ── 소프트딜리트 세션 제외 ─────────────────────────────────────────────

    @Test
    @DisplayName("findCompletedSessionsInPeriod — deletedAt!=null(소프트딜리트) 세션은 결과에서 제외")
    void excludesSoftDeletedSessions() {
        // given: 활성 완료 세션 1개 + 소프트딜리트된 완료 세션 1개 저장
        FocusSession active = focusSessionRepository.save(FocusSession.builder()
                .user(user)
                .startedAt(Instant.parse("2026-07-03T01:00:00Z"))
                .endedAt(Instant.parse("2026-07-03T02:00:00Z"))
                .build());
        // 소프트딜리트 세션 — deletedAt 설정됨. deletedAt IS NULL 조건에 의해 제외되어야 한다.
        focusSessionRepository.save(FocusSession.builder()
                .user(user)
                .startedAt(Instant.parse("2026-07-03T03:00:00Z"))
                .endedAt(Instant.parse("2026-07-03T04:00:00Z"))
                .deletedAt(Instant.parse("2026-07-03T05:00:00Z"))
                .build());
        focusSessionRepository.flush();

        // when
        List<FocusSession> result = focusSessionRepository.findCompletedSessionsInPeriod(user, FROM, TO);

        // then: 활성 세션만 반환, 소프트딜리트 세션은 제외
        assertThat(result).hasSize(1);
        assertThat(result.get(0).getId()).isEqualTo(active.getId());
    }

    // ── 자정 걸친 세션 귀속 (endedAt 기준) ────────────────────────────────

    @Test
    @DisplayName("findCompletedSessionsInPeriod — 자정 걸친 세션(startedAt 어제, endedAt 오늘)은 endedAt 기준으로 오늘 구간에 귀속")
    void midnightCrossingSessionBelongsToEndedAtDate() {
        // given: startedAt=어제 23:30 UTC, endedAt=오늘 00:30 UTC — 자정을 넘어 종료된 세션.
        // endedAt이 오늘(FROM <= endedAt < TO) 이므로 오늘 조회 결과에 포함되어야 한다.
        FocusSession midnightCrossing = focusSessionRepository.save(FocusSession.builder()
                .user(user)
                .startedAt(Instant.parse("2026-07-02T23:30:00Z")) // 어제 23:30 UTC
                .endedAt(Instant.parse("2026-07-03T00:30:00Z"))   // 오늘 00:30 UTC
                .build());
        // 어제 전체 종료 세션 — startedAt·endedAt 모두 어제. 오늘 기준 조회 시 제외되어야 한다.
        focusSessionRepository.save(FocusSession.builder()
                .user(user)
                .startedAt(Instant.parse("2026-07-02T23:30:00Z"))
                .endedAt(Instant.parse("2026-07-02T23:50:00Z"))
                .build());
        focusSessionRepository.flush();

        // when: 오늘(FROM~TO) 기준 조회
        List<FocusSession> result = focusSessionRepository.findCompletedSessionsInPeriod(user, FROM, TO);

        // then: 자정 걸친 세션(endedAt=오늘 00:30)만 포함, 어제 종료 세션은 제외
        assertThat(result).hasSize(1);
        assertThat(result.get(0).getId()).isEqualTo(midnightCrossing.getId());
    }
}
