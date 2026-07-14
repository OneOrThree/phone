package com.oneorthree.phone.focus.repository;

import com.oneorthree.phone.common.support.RepositoryTestBase;
import com.oneorthree.phone.focus.domain.FocusSession;
import com.oneorthree.phone.focus.domain.FocusSessionStatus;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.repository.UserRepository;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
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

    // markAutoClosedIfOpen 은 @Modifying 벌크 UPDATE(clearAutomatically 미사용 — endSessionIfActive 스타일 일치).
    // 같은 트랜잭션에서 findById 재조회 시 영속성 컨텍스트 1차 캐시의 낡은 엔티티가 반환되므로, DB 실제 반영을
    // 검증하려면 clear() 로 컨텍스트를 비운 뒤 재조회한다.
    @PersistenceContext
    private EntityManager entityManager;

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

    // ── orphan 조건부 자동 종료(markAutoClosedIfOpen) 원자성 (GROMO-804 P2) ──

    @Test
    @DisplayName("markAutoClosedIfOpen — 미종료 orphan 은 AUTO_CLOSED + endedAt 세팅, 반환 1")
    void markAutoClosedIfOpenClosesOpenSession() {
        // given: endedAt IS NULL 인 진행 중(orphan) 세션
        FocusSession open = focusSessionRepository.save(FocusSession.builder()
                .user(user)
                .startedAt(Instant.parse("2026-07-03T00:00:00Z"))
                .build());
        focusSessionRepository.flush();
        Instant cappedEnd = Instant.parse("2026-07-03T12:00:00Z");

        // when: 조건부 UPDATE
        int updated = focusSessionRepository.markAutoClosedIfOpen(open.getId(), cappedEnd);
        focusSessionRepository.flush();
        entityManager.clear();   // 1차 캐시 비우고 DB 실제 값 재조회

        // then: 영향 row=1, DB 상태가 AUTO_CLOSED + endedAt=cappedEnd
        assertThat(updated).isEqualTo(1);
        FocusSession reloaded = focusSessionRepository.findById(open.getId()).orElseThrow();
        assertThat(reloaded.getStatus()).isEqualTo(FocusSessionStatus.AUTO_CLOSED);
        assertThat(reloaded.getEndedAt()).isEqualTo(cappedEnd);
    }

    @Test
    @DisplayName("markAutoClosedIfOpen — 이미 종료된(유저 PATCH 완료) 세션은 덮어쓰지 않고 반환 0")
    void markAutoClosedIfOpenSkipsAlreadyEndedSession() {
        // given: 유저 PATCH 로 이미 완료된(endedAt 채워진, status 기본 ACTIVE) 세션 — 경합 시나리오.
        Instant userEndedAt = Instant.parse("2026-07-03T02:00:00Z");
        FocusSession completed = focusSessionRepository.save(FocusSession.builder()
                .user(user)
                .startedAt(Instant.parse("2026-07-03T00:00:00Z"))
                .endedAt(userEndedAt)
                .build());
        focusSessionRepository.flush();

        // when: 스윕이 뒤늦게 조건부 UPDATE 시도 (endedAt IS NULL 조건 → 매칭 안 됨)
        int updated = focusSessionRepository.markAutoClosedIfOpen(completed.getId(),
                Instant.parse("2026-07-03T12:00:00Z"));
        focusSessionRepository.flush();
        entityManager.clear();   // 1차 캐시 비우고 DB 실제 값 재조회

        // then: 영향 row=0, 완료 세션의 endedAt·status 는 유저 값 그대로 보존(AUTO_CLOSED 로 덮이지 않음)
        assertThat(updated).isZero();
        FocusSession reloaded = focusSessionRepository.findById(completed.getId()).orElseThrow();
        assertThat(reloaded.getStatus()).isEqualTo(FocusSessionStatus.ACTIVE);
        assertThat(reloaded.getEndedAt()).isEqualTo(userEndedAt);
    }
}
