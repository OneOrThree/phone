package com.oneorthree.phone.focus.repository;

import com.oneorthree.phone.common.support.RepositoryTestBase;
import com.oneorthree.phone.focus.domain.FocusSession;
import com.oneorthree.phone.focus.domain.FocusSessionStatus;
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
 * <p>Mockito 서비스 테스트로 검증 불가한 DB 레벨 필터(status <> CANCELED, endedAt 윈도우)를
 * 실 PostgreSQL(Testcontainers)로 검증한다.
 *
 * <p>GROMO-671(커밋3): local_date 컬럼 제거로 귀속 기준이 endedAt(UTC) [from,to) 반열림 윈도우로 전환됐고,
 * 소프트딜리트는 deleted_at 대신 status=CANCELED 로 표현된다.
 */
class FocusSessionRepositoryTest extends RepositoryTestBase {

    @Autowired
    private FocusSessionRepository focusSessionRepository;

    @Autowired
    private UserRepository userRepository;

    // 테스트 기준 윈도우: 2026-07-03 UTC 하루
    // from = 2026-07-03 00:00:00 UTC (inclusive)
    // to   = 2026-07-04 00:00:00 UTC (exclusive 상한)
    private static final Instant FROM = Instant.parse("2026-07-03T00:00:00Z");
    private static final Instant TO   = Instant.parse("2026-07-04T00:00:00Z");

    private User user;

    @BeforeEach
    void setUp() {
        user = userRepository.save(User.builder().nickname("테스터").build());
    }

    // ── 취소(CANCELED) 세션 제외 ──────────────────────────────────────────

    @Test
    @DisplayName("findCompletedSessionsInPeriod — status=CANCELED(소프트딜리트) 세션은 결과에서 제외")
    void excludesCanceledSessions() {
        // given: 활성 완료 세션 1개 + 취소된 완료 세션 1개 (둘 다 endedAt 이 윈도우 내)
        FocusSession active = focusSessionRepository.save(FocusSession.builder()
                .user(user)
                .startedAt(Instant.parse("2026-07-03T01:00:00Z"))
                .endedAt(Instant.parse("2026-07-03T02:00:00Z"))
                .build());
        // 취소 세션 — status=CANCELED 조건에 의해 제외되어야 한다.
        focusSessionRepository.save(FocusSession.builder()
                .user(user)
                .startedAt(Instant.parse("2026-07-03T03:00:00Z"))
                .endedAt(Instant.parse("2026-07-03T04:00:00Z"))
                .status(FocusSessionStatus.CANCELED)
                .build());
        focusSessionRepository.flush();

        // when
        List<FocusSession> result = focusSessionRepository.findCompletedSessionsInPeriod(user, FROM, TO);

        // then: 활성 세션만 반환, 취소 세션은 제외
        assertThat(result).hasSize(1);
        assertThat(result.get(0).getId()).isEqualTo(active.getId());
    }

    // ── orphan 자동 종료(AUTO_CLOSED) 세션 제외 (GROMO-804) ───────────────

    @Test
    @DisplayName("findCompletedSessionsInPeriod — status=AUTO_CLOSED(orphan 자동 종료) 세션은 결과에서 제외")
    void excludesAutoClosedSessions() {
        // given: 정상 완료 세션 1개 + orphan 자동 종료 세션 1개 (둘 다 endedAt 이 윈도우 내)
        FocusSession active = focusSessionRepository.save(FocusSession.builder()
                .user(user)
                .startedAt(Instant.parse("2026-07-03T01:00:00Z"))
                .endedAt(Instant.parse("2026-07-03T02:00:00Z"))
                .build());
        // AUTO_CLOSED 세션 — endedAt 이 채워져 윈도우에 걸리지만 통계 미반영 세션이라 제외되어야 한다.
        focusSessionRepository.save(FocusSession.builder()
                .user(user)
                .startedAt(Instant.parse("2026-07-03T03:00:00Z"))
                .endedAt(Instant.parse("2026-07-03T04:00:00Z"))
                .status(FocusSessionStatus.AUTO_CLOSED)
                .build());
        focusSessionRepository.flush();

        // when
        List<FocusSession> result = focusSessionRepository.findCompletedSessionsInPeriod(user, FROM, TO);

        // then: 정상 세션만 반환, AUTO_CLOSED 세션은 제외 (→ /stats/focus 사전집계와 by-category 총합 정합)
        assertThat(result).hasSize(1);
        assertThat(result.get(0).getId()).isEqualTo(active.getId());
    }

    // ── 세션 귀속은 endedAt(UTC) 윈도우 기준 ─────────────────────────────

    @Test
    @DisplayName("findCompletedSessionsInPeriod — endedAt 이 [from,to) 밖인 세션은 제외")
    void belongsToEndedAtWindow() {
        // given: endedAt UTC 가 07-03 윈도우 내인 세션 1개
        FocusSession inWindow = focusSessionRepository.save(FocusSession.builder()
                .user(user)
                .startedAt(Instant.parse("2026-07-03T05:30:00Z"))
                .endedAt(Instant.parse("2026-07-03T06:30:00Z"))
                .build());
        // endedAt UTC date=07-02 세션 — 07-03 윈도우에서 제외되어야 한다.
        focusSessionRepository.save(FocusSession.builder()
                .user(user)
                .startedAt(Instant.parse("2026-07-02T10:00:00Z"))
                .endedAt(Instant.parse("2026-07-02T11:00:00Z"))
                .build());
        focusSessionRepository.flush();

        // when: 07-03 윈도우 기준 조회
        List<FocusSession> result = focusSessionRepository.findCompletedSessionsInPeriod(user, FROM, TO);

        // then: 윈도우 내 세션만 포함
        assertThat(result).hasSize(1);
        assertThat(result.get(0).getId()).isEqualTo(inWindow.getId());
    }
}
