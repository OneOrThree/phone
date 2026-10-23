package com.oneorthree.phone.focus.repository;

import com.oneorthree.phone.common.support.RepositoryTestBase;
import com.oneorthree.phone.focus.repository.domain.FocusSession;
import com.oneorthree.phone.focus.repository.domain.FocusSessionStatus;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.repository.UserRepository;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.Instant;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * FocusSessionRepository.findCompletedSessionsOverlappingPeriod JPQL 필터 통합 테스트.
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



    @Autowired
    private FocusSessionDetailRepository focusSessionDetailRepository;

    @Autowired
    private GroupRepository groupRepository;

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

    // findLiveSessionsByUserIdIn 라이브 하한 — 이보다 앞서 시작한 미종료 세션은 orphan 으로 보고 제외.
    // 07-03 윈도우 세션은 모두 포함되도록 이틀 앞으로 잡는다.
    private static final Instant LIVE_SINCE = Instant.parse("2026-07-01T00:00:00Z");

    // 정산 대기 가드(existsPendingOverlappingSession) 기준 창 종료 시각.
    private static final Instant WIN_END = Instant.parse("2026-07-03T02:00:00Z");

    private User user;

    @BeforeEach
    void setUp() {
        user = userRepository.save(User.builder().nickname("테스터").build());
    }



    // ── 세션 귀속은 endedAt(UTC) 윈도우 기준 ─────────────────────────────



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










    // ── 단조성 판정용 최신 열린 마커 조회 (GROMO-1287 codex P1) ─────────────

    @Test
    @DisplayName("findFirstByUserAndEndedAtIsNullOrderByStartedAtDesc — 열린 마커가 여럿이어도 가장 최신 1건")
    void findsNewestOpenMarkerAmongSeveral() {
        // given: 마이그레이션 이전 스냅샷·ci 스키마처럼 열린 마커가 여럿인 상태 + 완료 세션 1개
        focusSessionRepository.save(FocusSession.builder()
                .user(user).startedAt(Instant.parse("2026-07-03T01:00:00Z")).build());
        FocusSession newest = focusSessionRepository.save(FocusSession.builder()
                .user(user).startedAt(Instant.parse("2026-07-03T03:00:00Z")).build());
        focusSessionRepository.save(FocusSession.builder()
                .user(user)
                .startedAt(Instant.parse("2026-07-03T05:00:00Z"))
                .endedAt(Instant.parse("2026-07-03T06:00:00Z"))
                .status(FocusSessionStatus.COMPLETED)
                .build());
        focusSessionRepository.flush();

        // when & then: 완료 세션(더 늦게 시작)이 아니라 열린 마커 중 최신을 고른다
        assertThat(focusSessionRepository.findFirstByUserAndEndedAtIsNullOrderByStartedAtDesc(user))
                .get()
                .extracting(FocusSession::getId)
                .isEqualTo(newest.getId());
    }

    @Test
    @DisplayName("findFirstByUserAndEndedAtIsNullOrderByStartedAtDesc — 열린 마커가 없으면 빈 값")
    void findsNoOpenMarkerWhenAllClosed() {
        focusSessionRepository.save(FocusSession.builder()
                .user(user)
                .startedAt(Instant.parse("2026-07-03T01:00:00Z"))
                .endedAt(Instant.parse("2026-07-03T02:00:00Z"))
                .status(FocusSessionStatus.COMPLETED)
                .build());
        focusSessionRepository.flush();

        assertThat(focusSessionRepository.findFirstByUserAndEndedAtIsNullOrderByStartedAtDesc(user))
                .isEmpty();
    }




    // ── 마커 원자 선점(claimMarkerIfActive) (GROMO-1214 코드리뷰 2차) ────────




    // ── findStatusById — 409 원인 판정용 상태 재조회 (GROMO-1214 코드리뷰) ──



    @Test
    @DisplayName("findLiveSessionsByUserIdIn — 태그 미지정 진행중 세션은 focusTag=null 로 반환")
    void findLiveSessionsByUserIdIn_noTagSession_focusTagNull() {
        FocusSession live = focusSessionRepository.save(FocusSession.builder()
                .user(user)
                .startedAt(Instant.parse("2026-07-03T04:00:00Z"))
                .build());
        focusSessionRepository.flush();
        entityManager.clear();

        List<FocusSession> result = focusSessionRepository.findLiveSessionsByUserIdIn(
                List.of(user.getId()), LIVE_SINCE);

        assertThat(result).hasSize(1);
        assertThat(result.get(0).getId()).isEqualTo(live.getId());
    }

    @Test
    @DisplayName("findLiveSessionsByUserIdIn — startedAt<liveSince 인 미청소 orphan(미종료)은 제외 (GROMO-822 codex 리뷰)")
    void findLiveSessionsByUserIdIn_excludesStaleOrphanBeforeLiveSince() {
        // 최근 시작한 라이브 세션(liveSince 이후) → 포함
        FocusSession recent = focusSessionRepository.save(FocusSession.builder()
                .user(user)
                .startedAt(Instant.parse("2026-07-03T01:00:00Z"))
                .build());
        // liveSince 이전에 시작한 미종료 세션(스윕 전 orphan) → endedAt IS NULL 이어도 제외
        focusSessionRepository.save(FocusSession.builder()
                .user(user)
                .startedAt(Instant.parse("2026-06-30T00:00:00Z"))
                .build());
        focusSessionRepository.flush();
        entityManager.clear();

        List<FocusSession> result = focusSessionRepository.findLiveSessionsByUserIdIn(
                List.of(user.getId()), LIVE_SINCE);

        assertThat(result).hasSize(1);
        assertThat(result.get(0).getId()).isEqualTo(recent.getId());
    }

    @Test
    @DisplayName("findLiveSessionsByUserIdIn — 한 유저 다중 라이브 세션은 startedAt DESC(최신 우선)로 정렬 (GROMO-822 codex 리뷰)")
    void findLiveSessionsByUserIdIn_ordersByStartedAtDesc() {
        FocusSession earlier = focusSessionRepository.save(FocusSession.builder()
                .user(user)
                .startedAt(Instant.parse("2026-07-03T01:00:00Z"))
                .build());
        FocusSession later = focusSessionRepository.save(FocusSession.builder()
                .user(user)
                .startedAt(Instant.parse("2026-07-03T05:00:00Z"))
                .build());
        focusSessionRepository.flush();
        entityManager.clear();

        List<FocusSession> result = focusSessionRepository.findLiveSessionsByUserIdIn(
                List.of(user.getId()), LIVE_SINCE);

        // 최신(05:00)이 먼저, 이전(01:00)이 나중 — 호출측이 first 로 최신을 결정적으로 고른다
        assertThat(result).extracting(FocusSession::getId)
                .containsExactly(later.getId(), earlier.getId());
    }



    // ── 날짜별 확정 분포 jsonb 왕복 (GROMO-1252 코드리뷰 3차 ①) ─────────────

    @Test
    @DisplayName("focus_seconds_by_date — jsonb 컬럼에 날짜별 분포가 그대로 저장·복원된다")
    void focusSecondsByDateRoundTripsThroughJsonb() {
        FocusSession saved = focusSessionRepository.save(FocusSession.builder()
                .user(user)
                .startedAt(Instant.parse("2026-07-03T14:50:00Z"))
                .endedAt(Instant.parse("2026-07-03T15:15:00Z"))
                .status(FocusSessionStatus.COMPLETED)
                .focusSecondsByDate(Map.of("2026-07-03", 300, "2026-07-04", 300))
                .build());
        focusSessionRepository.flush();
        entityManager.clear();

        assertThat(focusSessionRepository.findById(saved.getId()).orElseThrow().getFocusSecondsByDate())
                .containsExactlyInAnyOrderEntriesOf(Map.of("2026-07-03", 300, "2026-07-04", 300));
    }

    @Test
    @DisplayName("focus_seconds_by_date — 미기록(레거시) 세션은 null 로 남아 조회측이 폴백한다")
    void focusSecondsByDateIsNullWhenAbsent() {
        FocusSession saved = focusSessionRepository.save(FocusSession.builder()
                .user(user)
                .startedAt(Instant.parse("2026-07-03T01:00:00Z"))
                .endedAt(Instant.parse("2026-07-03T02:00:00Z"))
                .status(FocusSessionStatus.COMPLETED)
                .build());
        focusSessionRepository.flush();
        entityManager.clear();

        assertThat(focusSessionRepository.findById(saved.getId()).orElseThrow().getFocusSecondsByDate())
                .isNull();
    }

}
