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
import java.time.LocalDate;
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
    // GROMO-643: 카테고리 조회는 세션 localDate [FROM,TO] 기준(inclusive)
    private static final LocalDate FROM = LocalDate.of(2026, 7, 3);
    private static final LocalDate TO   = LocalDate.of(2026, 7, 3);

    private User user;

    @BeforeEach
    void setUp() {
        user = userRepository.save(User.builder().nickname("테스터").currentTier(1).build());
    }

    // ── 소프트딜리트 세션 제외 ─────────────────────────────────────────────

    @Test
    @DisplayName("findCompletedSessionsInPeriod — deletedAt!=null(소프트딜리트) 세션은 결과에서 제외")
    void excludesSoftDeletedSessions() {
        // given: 활성 완료 세션 1개 + 소프트딜리트된 완료 세션 1개 저장 (둘 다 localDate=2026-07-03)
        FocusSession active = focusSessionRepository.save(FocusSession.builder()
                .user(user)
                .startedAt(Instant.parse("2026-07-03T01:00:00Z"))
                .endedAt(Instant.parse("2026-07-03T02:00:00Z"))
                .localDate(LocalDate.of(2026, 7, 3))
                .build());
        // 소프트딜리트 세션 — deletedAt 설정됨. deletedAt IS NULL 조건에 의해 제외되어야 한다.
        focusSessionRepository.save(FocusSession.builder()
                .user(user)
                .startedAt(Instant.parse("2026-07-03T03:00:00Z"))
                .endedAt(Instant.parse("2026-07-03T04:00:00Z"))
                .localDate(LocalDate.of(2026, 7, 3))
                .deletedAt(Instant.parse("2026-07-03T05:00:00Z"))
                .build());
        focusSessionRepository.flush();

        // when
        List<FocusSession> result = focusSessionRepository.findCompletedSessionsInPeriod(user, FROM, TO);

        // then: 활성 세션만 반환, 소프트딜리트 세션은 제외
        assertThat(result).hasSize(1);
        assertThat(result.get(0).getId()).isEqualTo(active.getId());
    }

    // ── 세션 귀속은 localDate 기준 (GROMO-643 회귀) ───────────────────────

    @Test
    @DisplayName("findCompletedSessionsInPeriod — 귀속은 endedAt UTC 가 아니라 localDate 기준 (KST 오전 세션 회귀)")
    void belongsToLocalDateNotEndedAtUtc() {
        // given: endedAt UTC date=2026-07-02 이지만 클라 localDate=2026-07-03 (KST 07-03 오전 세션).
        // 과거 버그(endedAt UTC 윈도우)면 오늘(07-03) 조회에서 누락됐으나, 이제 localDate 로 포함되어야 한다.
        FocusSession kstMorning = focusSessionRepository.save(FocusSession.builder()
                .user(user)
                .startedAt(Instant.parse("2026-07-02T22:30:00Z")) // KST 07-03 07:30
                .endedAt(Instant.parse("2026-07-02T23:30:00Z"))   // KST 07-03 08:30, endedAt UTC date=07-02
                .localDate(LocalDate.of(2026, 7, 3))
                .build());
        // localDate=07-02 세션 — 오늘(07-03) 조회에서 제외되어야 한다.
        focusSessionRepository.save(FocusSession.builder()
                .user(user)
                .startedAt(Instant.parse("2026-07-02T10:00:00Z"))
                .endedAt(Instant.parse("2026-07-02T11:00:00Z"))
                .localDate(LocalDate.of(2026, 7, 2))
                .build());
        focusSessionRepository.flush();

        // when: 오늘(localDate 2026-07-03) 기준 조회
        List<FocusSession> result = focusSessionRepository.findCompletedSessionsInPeriod(user, FROM, TO);

        // then: localDate=07-03 세션만 포함 (endedAt UTC 는 07-02 여도)
        assertThat(result).hasSize(1);
        assertThat(result.get(0).getId()).isEqualTo(kstMorning.getId());
    }
}
