package com.oneorthree.phone.focus.repository;

import com.oneorthree.phone.common.support.RepositoryTestBase;
import com.oneorthree.phone.focus.domain.DefaultTag;
import com.oneorthree.phone.focus.domain.FocusSession;
import com.oneorthree.phone.focus.domain.FocusSessionStatus;
import com.oneorthree.phone.focus.domain.UserFocusTag;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.repository.UserRepository;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Slice;

import java.time.Duration;
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
    private DefaultTagRepository defaultTagRepository;

    @Autowired
    private UserFocusTagRepository userFocusTagRepository;

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

    // ── 취소(CANCELED) 세션 제외 ──────────────────────────────────────────

    @Test
    @DisplayName("findCompletedSessionsOverlappingPeriod — status=CANCELED(소프트딜리트) 세션은 결과에서 제외")
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
        List<FocusSession> result = focusSessionRepository.findCompletedSessionsOverlappingPeriod(user, FROM, TO);

        // then: 활성 세션만 반환, 취소 세션은 제외
        assertThat(result).hasSize(1);
        assertThat(result.get(0).getId()).isEqualTo(active.getId());
    }

    // ── orphan 자동 종료(AUTO_CLOSED) 세션 제외 (GROMO-804) ───────────────

    @Test
    @DisplayName("findCompletedSessionsOverlappingPeriod — status=AUTO_CLOSED(orphan 자동 종료) 세션은 결과에서 제외")
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
        List<FocusSession> result = focusSessionRepository.findCompletedSessionsOverlappingPeriod(user, FROM, TO);

        // then: 정상 세션만 반환, AUTO_CLOSED 세션은 제외 (→ /stats/focus 사전집계와 by-category 총합 정합)
        assertThat(result).hasSize(1);
        assertThat(result.get(0).getId()).isEqualTo(active.getId());
    }

    // ── 세션 귀속은 endedAt(UTC) 윈도우 기준 ─────────────────────────────

    /**
     * GROMO-1252(코드리뷰 P1): 창을 걸친(자정 넘긴) 세션은 endedAt 이 창 밖이어도 포함돼야 한다.
     * 종전 endedAt-포함 윈도우에선 이 세션이 통째로 빠져 by-category 가 사전집계보다 적게 나왔다.
     * (겹침분만 세는 클리핑은 호출측 StatsService 책임 — 여기선 '고르는지'만 본다.)
     */
    @Test
    @DisplayName("findCompletedSessionsOverlappingPeriod — endedAt 이 창 밖이어도 겹치면 포함(자정 걸친 세션)")
    void includesSessionOverlappingWindowEnd() {
        // given: 07-03 23:00 시작 ~ 07-04 01:00 종료 — endedAt 은 TO(07-04 00:00Z) 밖이지만 창과 1시간 겹친다.
        FocusSession spanning = focusSessionRepository.save(FocusSession.builder()
                .user(user)
                .startedAt(Instant.parse("2026-07-03T23:00:00Z"))
                .endedAt(Instant.parse("2026-07-04T01:00:00Z"))
                .build());
        focusSessionRepository.flush();

        // when
        List<FocusSession> result = focusSessionRepository.findCompletedSessionsOverlappingPeriod(user, FROM, TO);

        // then
        assertThat(result).hasSize(1);
        assertThat(result.get(0).getId()).isEqualTo(spanning.getId());
    }

    @Test
    @DisplayName("findCompletedSessionsOverlappingPeriod — [from,to) 와 전혀 겹치지 않는 세션은 제외")
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
        List<FocusSession> result = focusSessionRepository.findCompletedSessionsOverlappingPeriod(user, FROM, TO);

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

    // ── 라이브 마커 원자 마감(autoCloseOpenMarkersOf) — GROMO-1287 ────────────

    @Test
    @DisplayName("autoCloseOpenMarkersOf — 그 유저의 열린 마커를 전부 AUTO_CLOSED 로 마감하고, 완료 세션은 건드리지 않는다")
    void autoCloseOpenMarkersClosesEveryOpenMarkerOfUser() {
        // given: 같은 유저의 열린 마커 2개(중복 시작·마커 회전 잔재) + 이미 완료된 세션 1개
        FocusSession older = focusSessionRepository.save(FocusSession.builder()
                .user(user)
                .startedAt(Instant.parse("2026-07-03T01:00:00Z"))
                .build());
        FocusSession newer = focusSessionRepository.save(FocusSession.builder()
                .user(user)
                .startedAt(Instant.parse("2026-07-03T03:00:00Z"))
                .build());
        FocusSession completed = focusSessionRepository.save(FocusSession.builder()
                .user(user)
                .startedAt(Instant.parse("2026-07-03T00:00:00Z"))
                .endedAt(Instant.parse("2026-07-03T00:30:00Z"))
                .status(FocusSessionStatus.COMPLETED)
                .build());
        focusSessionRepository.flush();
        Instant closedAt = Instant.parse("2026-07-03T04:00:00Z");

        // when: 새 마커를 열기 직전의 원자 마감
        int updated = focusSessionRepository.autoCloseOpenMarkersOf(user, closedAt);
        focusSessionRepository.flush();
        entityManager.clear();   // 1차 캐시 비우고 DB 실제 값 재조회

        // then: 열린 마커 2개만 AUTO_CLOSED + endedAt=closedAt. 완료 세션은 원본 그대로다
        // (마감 대상이 endedAt IS NULL 이라 이미 통계·코인에 반영된 행은 절대 덮이지 않는다).
        assertThat(updated).isEqualTo(2);
        for (FocusSession marker : List.of(older, newer)) {
            FocusSession reloaded = focusSessionRepository.findById(marker.getId()).orElseThrow();
            assertThat(reloaded.getStatus()).isEqualTo(FocusSessionStatus.AUTO_CLOSED);
            assertThat(reloaded.getEndedAt()).isEqualTo(closedAt);
        }
        FocusSession untouched = focusSessionRepository.findById(completed.getId()).orElseThrow();
        assertThat(untouched.getStatus()).isEqualTo(FocusSessionStatus.COMPLETED);
        assertThat(untouched.getEndedAt()).isEqualTo(Instant.parse("2026-07-03T00:30:00Z"));

        // 그리고 라이브 조회에는 아무것도 남지 않는다 = isFocusing 오염 해소
        assertThat(focusSessionRepository.findLiveSessionsByUserIdIn(List.of(user.getId()), LIVE_SINCE))
                .isEmpty();
    }

    @Test
    @DisplayName("autoCloseOpenMarkersOf — 다른 유저의 열린 마커는 건드리지 않는다")
    void autoCloseOpenMarkersLeavesOtherUsersMarkersOpen() {
        // given: 나와 남이 각각 열린 마커를 하나씩 갖고 있다
        User other = userRepository.save(User.builder().nickname("남").build());
        focusSessionRepository.save(FocusSession.builder()
                .user(user)
                .startedAt(Instant.parse("2026-07-03T01:00:00Z"))
                .build());
        FocusSession othersMarker = focusSessionRepository.save(FocusSession.builder()
                .user(other)
                .startedAt(Instant.parse("2026-07-03T01:00:00Z"))
                .build());
        focusSessionRepository.flush();

        // when
        int updated = focusSessionRepository.autoCloseOpenMarkersOf(user, Instant.parse("2026-07-03T04:00:00Z"));
        focusSessionRepository.flush();
        entityManager.clear();

        // then: 내 것 1개만 마감. 남의 라이브 세션은 그대로 살아 있다
        assertThat(updated).isEqualTo(1);
        FocusSession reloaded = focusSessionRepository.findById(othersMarker.getId()).orElseThrow();
        assertThat(reloaded.getStatus()).isEqualTo(FocusSessionStatus.ACTIVE);
        assertThat(reloaded.getEndedAt()).isNull();
    }

    @Test
    @DisplayName("autoCloseOpenMarkersOf — 열린 마커가 없으면 0행(정상 경로, 예외 아님)")
    void autoCloseOpenMarkersReturnsZeroWhenNoOpenMarker() {
        // given: 완료 세션만 있는 유저
        focusSessionRepository.save(FocusSession.builder()
                .user(user)
                .startedAt(Instant.parse("2026-07-03T01:00:00Z"))
                .endedAt(Instant.parse("2026-07-03T02:00:00Z"))
                .status(FocusSessionStatus.COMPLETED)
                .build());
        focusSessionRepository.flush();

        // when & then
        assertThat(focusSessionRepository.autoCloseOpenMarkersOf(user, Instant.parse("2026-07-03T04:00:00Z")))
                .isZero();
    }

    // ── 정산 대기 가드 (existsPendingOverlappingSession) — GROMO-1413 · GROMO-1287 ──

    @Test
    @DisplayName("창 겹침 ACTIVE 마커가 있으면 대기한다(종전 조건)")
    void pendingGuardWaitsForRunningMarker() {
        focusSessionRepository.save(FocusSession.builder()
                .user(user)
                .startedAt(Instant.parse("2026-07-03T01:00:00Z"))
                .build());
        focusSessionRepository.flush();

        assertThat(focusSessionRepository.existsPendingOverlappingSession(
                List.of(user.getId()), WIN_END, WIN_END.minus(Duration.ofMinutes(5)))).isTrue();
    }

    @Test
    @DisplayName("close-then-open 이 방금 닫은 마커도 대기 사유다 — 미저장 블록을 뺀 채 승패가 확정되면 안 된다")
    void pendingGuardStillWaitsRightAfterMarkerAutoClosed() {
        // given: 창과 겹치는 마커가 열려 있고, 다음 블록 start 가 그것을 즉시 AUTO_CLOSED 로 닫는다.
        // 이 시점에 그 블록의 PATCH/POST 는 아직 서버에 도착하지 않았을 수 있다.
        focusSessionRepository.save(FocusSession.builder()
                .user(user)
                .startedAt(Instant.parse("2026-07-03T01:00:00Z"))
                .build());
        focusSessionRepository.flush();
        Instant closedAt = Instant.parse("2026-07-03T02:05:00Z");   // 창 종료 직후 회전
        focusSessionRepository.autoCloseOpenMarkersOf(user, closedAt);
        focusSessionRepository.flush();
        entityManager.clear();

        // then: 유예창(닫힌 지 5분 이내) 안에서는 계속 대기한다.
        // 종전 가드(status=ACTIVE AND endedAt IS NULL)였다면 여기서 false 가 돼 정산이 진행됐고,
        // 뒤늦게 POST 폴백이 적립해도 정산은 되돌릴 수 없었다(codex P1-a).
        assertThat(focusSessionRepository.existsPendingOverlappingSession(
                List.of(user.getId()), WIN_END, closedAt.minus(Duration.ofMinutes(1)))).isTrue();
    }

    @Test
    @DisplayName("유예창을 넘긴 마감 마커는 가드를 잡지 않는다 — 대기는 반드시 끝난다")
    void pendingGuardReleasesAfterGraceExpires() {
        focusSessionRepository.save(FocusSession.builder()
                .user(user)
                .startedAt(Instant.parse("2026-07-03T01:00:00Z"))
                .build());
        focusSessionRepository.flush();
        Instant closedAt = Instant.parse("2026-07-03T02:05:00Z");
        focusSessionRepository.autoCloseOpenMarkersOf(user, closedAt);
        focusSessionRepository.flush();
        entityManager.clear();

        // 마커의 endedAt 은 한 번 정해지면 안 바뀌므로 상한을 넘기면 자동으로 빠진다
        assertThat(focusSessionRepository.existsPendingOverlappingSession(
                List.of(user.getId()), WIN_END, closedAt.plus(Duration.ofMinutes(1)))).isFalse();
    }

    @Test
    @DisplayName("정상 완료(COMPLETED)한 마커는 유예창 안이어도 대기 사유가 아니다 — 데이터가 이미 들어왔다")
    void pendingGuardIgnoresCompletedSessions() {
        // given: PATCH 가 제때 도착해 COMPLETED 로 마감된 세션(= 창 집계에 이미 반영됨)
        focusSessionRepository.save(FocusSession.builder()
                .user(user)
                .startedAt(Instant.parse("2026-07-03T01:00:00Z"))
                .endedAt(Instant.parse("2026-07-03T02:05:00Z"))
                .status(FocusSessionStatus.COMPLETED)
                .build());
        focusSessionRepository.flush();

        // then: 정상 경로에는 추가 지연이 붙지 않는다
        assertThat(focusSessionRepository.existsPendingOverlappingSession(
                List.of(user.getId()), WIN_END, Instant.parse("2026-07-03T02:00:00Z"))).isFalse();
    }

    @Test
    @DisplayName("창 종료 뒤에 시작한 마커는 대기 사유가 아니다 — 새로 연 마커가 정산을 잡지 않는다")
    void pendingGuardIgnoresMarkersStartedAfterWindowEnd() {
        // given: close-then-open 의 '새 마커' — 창 종료 후 시작이라 창과 겹치지 않는다
        focusSessionRepository.save(FocusSession.builder()
                .user(user)
                .startedAt(Instant.parse("2026-07-03T02:05:00Z"))
                .build());
        focusSessionRepository.flush();

        assertThat(focusSessionRepository.existsPendingOverlappingSession(
                List.of(user.getId()), WIN_END, Instant.parse("2026-07-03T02:00:00Z"))).isFalse();
    }

    @Test
    @DisplayName("유저 취소(CANCELED)로 닫힌 마커도 유예창 안에서는 대기 사유다 — 그 블록은 POST 로 올라온다")
    void pendingGuardWaitsForRecentlyCanceledMarker() {
        // given: PATCH 를 못 태워 마커를 취소로 닫은 경우(uploadFocusBlock 의 onMarkerStillOpen 경로).
        // 취소 뒤에 POST 가 온다 — 닫혔다고 바로 정산하면 그 블록이 빠진다.
        FocusSession marker = focusSessionRepository.save(FocusSession.builder()
                .user(user)
                .startedAt(Instant.parse("2026-07-03T01:00:00Z"))
                .build());
        focusSessionRepository.flush();
        Instant canceledAt = Instant.parse("2026-07-03T02:05:00Z");
        focusSessionRepository.cancelSessionIfActive(marker.getId(), canceledAt);
        focusSessionRepository.flush();
        entityManager.clear();

        assertThat(focusSessionRepository.existsPendingOverlappingSession(
                List.of(user.getId()), WIN_END, canceledAt.minus(Duration.ofMinutes(1)))).isTrue();
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

    // ── COMPLETED 세션 포함 (GROMO-733) ──────────────────────────────────

    @Test
    @DisplayName("findCompletedSessionsOverlappingPeriod — status=COMPLETED(정상 완료) 세션은 결과에 포함")
    void includesCompletedSessions() {
        // given: end() 로 COMPLETED 전이된 정상 완료 세션 (endedAt 윈도우 내)
        FocusSession completed = focusSessionRepository.save(FocusSession.builder()
                .user(user)
                .startedAt(Instant.parse("2026-07-03T01:00:00Z"))
                .endedAt(Instant.parse("2026-07-03T02:00:00Z"))
                .status(FocusSessionStatus.COMPLETED)
                .build());
        focusSessionRepository.flush();

        // when
        List<FocusSession> result = focusSessionRepository.findCompletedSessionsOverlappingPeriod(user, FROM, TO);

        // then: COMPLETED 는 NOT IN(CANCELED, AUTO_CLOSED) 필터를 통과해 포함된다(이제 정상값)
        assertThat(result).hasSize(1);
        assertThat(result.get(0).getId()).isEqualTo(completed.getId());
    }

    // ── 유저 취소 조건부 원자 UPDATE(cancelSessionIfActive) (GROMO-733) ──────

    @Test
    @DisplayName("cancelSessionIfActive — 미종료(진행 중) 세션은 CANCELED + endedAt 세팅, 반환 1")
    void cancelSessionIfActiveCancelsOpenSession() {
        // given: endedAt IS NULL 인 진행 중 세션
        FocusSession open = focusSessionRepository.save(FocusSession.builder()
                .user(user)
                .startedAt(Instant.parse("2026-07-03T00:00:00Z"))
                .build());
        focusSessionRepository.flush();
        Instant canceledAt = Instant.parse("2026-07-03T00:30:00Z");

        // when: 조건부 UPDATE
        int updated = focusSessionRepository.cancelSessionIfActive(open.getId(), canceledAt);
        focusSessionRepository.flush();
        entityManager.clear();   // 1차 캐시 비우고 DB 실제 값 재조회

        // then: 영향 row=1, DB 상태가 CANCELED + endedAt=canceledAt
        assertThat(updated).isEqualTo(1);
        FocusSession reloaded = focusSessionRepository.findById(open.getId()).orElseThrow();
        assertThat(reloaded.getStatus()).isEqualTo(FocusSessionStatus.CANCELED);
        assertThat(reloaded.getEndedAt()).isEqualTo(canceledAt);
    }

    @Test
    @DisplayName("cancelSessionIfActive — 이미 종료된 세션은 덮어쓰지 않고 반환 0(멱등)")
    void cancelSessionIfActiveSkipsAlreadyEndedSession() {
        // given: 이미 완료(endedAt 채워진) 세션 — 재취소 방지 경합 시나리오
        Instant endedAt = Instant.parse("2026-07-03T02:00:00Z");
        FocusSession ended = focusSessionRepository.save(FocusSession.builder()
                .user(user)
                .startedAt(Instant.parse("2026-07-03T00:00:00Z"))
                .endedAt(endedAt)
                .status(FocusSessionStatus.COMPLETED)
                .build());
        focusSessionRepository.flush();

        // when: endedAt IS NULL 조건 → 매칭 안 됨
        int updated = focusSessionRepository.cancelSessionIfActive(ended.getId(),
                Instant.parse("2026-07-03T03:00:00Z"));
        focusSessionRepository.flush();
        entityManager.clear();

        // then: 영향 row=0, status·endedAt 는 기존 완료 값 보존(CANCELED 로 덮이지 않음)
        assertThat(updated).isZero();
        FocusSession reloaded = focusSessionRepository.findById(ended.getId()).orElseThrow();
        assertThat(reloaded.getStatus()).isEqualTo(FocusSessionStatus.COMPLETED);
        assertThat(reloaded.getEndedAt()).isEqualTo(endedAt);
    }

    // ── 마커 원자 선점(claimMarkerIfActive) (GROMO-1214 코드리뷰 2차) ────────

    /**
     * POST 폴백이 마커를 <b>원자적으로 선점</b>하는지 — 종전 존재 조회(existsByIdAndUserAndStatus)는
     * 아직 커밋 전인 PATCH 를 ACTIVE 로 보고 통과해, 폴백 POST 가 두 번째 완료 행을 만들었다.
     * 조건부 UPDATE 는 이미 닫힌 마커에 0 을 돌려주므로 호출측이 '누가 이겼는지'로 분기할 수 있다.
     */
    @Test
    @DisplayName("claimMarkerIfActive — 진행 중 마커는 CANCELED 로 선점하고 반환 1(폴백 POST 가 완료 행을 만든다)")
    void claimMarkerIfActiveClaimsOpenMarker() {
        FocusSession open = focusSessionRepository.save(FocusSession.builder()
                .user(user)
                .startedAt(Instant.parse("2026-07-03T00:00:00Z"))
                .build());
        focusSessionRepository.flush();
        Instant claimedAt = Instant.parse("2026-07-03T00:30:00Z");

        int updated = focusSessionRepository.claimMarkerIfActive(open.getId(), user, claimedAt);
        focusSessionRepository.flush();
        entityManager.clear();

        assertThat(updated).isEqualTo(1);
        FocusSession reloaded = focusSessionRepository.findById(open.getId()).orElseThrow();
        assertThat(reloaded.getStatus()).isEqualTo(FocusSessionStatus.CANCELED);
        assertThat(reloaded.getEndedAt()).isEqualTo(claimedAt);
    }

    @Test
    @DisplayName("claimMarkerIfActive — PATCH 가 먼저 완료한 마커는 반환 0 + 완료 상태 보존(이중 계상 차단 지점)")
    void claimMarkerIfActiveSkipsCompletedMarker() {
        // given: PATCH 가 이미 종료시킨 마커(= 통계·지급 커밋 완료)
        Instant endedAt = Instant.parse("2026-07-03T02:00:00Z");
        FocusSession completed = focusSessionRepository.save(FocusSession.builder()
                .user(user)
                .startedAt(Instant.parse("2026-07-03T00:00:00Z"))
                .endedAt(endedAt)
                .status(FocusSessionStatus.COMPLETED)
                .build());
        focusSessionRepository.flush();

        int updated = focusSessionRepository.claimMarkerIfActive(completed.getId(), user,
                Instant.parse("2026-07-03T03:00:00Z"));
        focusSessionRepository.flush();
        entityManager.clear();

        // then: 선점 실패(0) → 호출측이 COMPLETED 를 확인하고 저장·지급을 스킵한다. 완료 값은 보존.
        assertThat(updated).isZero();
        FocusSession reloaded = focusSessionRepository.findById(completed.getId()).orElseThrow();
        assertThat(reloaded.getStatus()).isEqualTo(FocusSessionStatus.COMPLETED);
        assertThat(reloaded.getEndedAt()).isEqualTo(endedAt);
    }

    @Test
    @DisplayName("claimMarkerIfActive — 남의 마커는 선점하지 못한다(반환 0) — sessionId 는 클라 입력")
    void claimMarkerIfActiveRejectsOtherUsersMarker() {
        User other = userRepository.save(User.builder().nickname("남").build());
        FocusSession othersMarker = focusSessionRepository.save(FocusSession.builder()
                .user(other)
                .startedAt(Instant.parse("2026-07-03T00:00:00Z"))
                .build());
        focusSessionRepository.flush();

        int updated = focusSessionRepository.claimMarkerIfActive(othersMarker.getId(), user,
                Instant.parse("2026-07-03T00:30:00Z"));
        focusSessionRepository.flush();
        entityManager.clear();

        // then: 남의 진행 중 세션을 취소시킬 수 없다
        assertThat(updated).isZero();
        FocusSession reloaded = focusSessionRepository.findById(othersMarker.getId()).orElseThrow();
        assertThat(reloaded.getStatus()).isEqualTo(FocusSessionStatus.ACTIVE);
        assertThat(reloaded.getEndedAt()).isNull();
    }

    // ── findStatusById — 409 원인 판정용 상태 재조회 (GROMO-1214 코드리뷰) ──

    /**
     * endFocusSession 은 findById 로 엔티티를 로드한 뒤 조건부 UPDATE 를 쏘고, 실패(row=0)하면 409 의 원인을
     * 상태로 가른다. 그런데 <b>로드한 엔티티는 UPDATE 이전 스냅샷</b>이고 findById 재호출은 1차 캐시가
     * 흡수해 DB 를 다시 읽지 않는다 — 그대로 쓰면 동시 취소를 못 보고, 살릴 수 있는 세션을
     * SESSION_ALREADY_ENDED 로 돌려보내 시간이 영구 유실된다. 이 테스트가 그 전제(스칼라 JPQL 은
     * 캐시를 우회해 DB 값을 읽는다)를 잠근다.
     */
    @Test
    @DisplayName("findStatusById — 엔티티를 로드한 뒤 벌크 취소가 나가도 clear 없이 DB 실제 상태(CANCELED)를 읽는다")
    void findStatusByIdReadsDbNotStaleEntity() {
        // given: 진행 중 세션을 영속성 컨텍스트에 올려 둔 상태(= endFocusSession 의 findById 시점)
        FocusSession open = focusSessionRepository.save(FocusSession.builder()
                .user(user)
                .startedAt(Instant.parse("2026-07-03T00:00:00Z"))
                .build());
        focusSessionRepository.flush();
        FocusSession loaded = focusSessionRepository.findById(open.getId()).orElseThrow();

        // when: 그 사이 취소가 벌크 UPDATE 로 성사(로드한 엔티티는 여전히 ACTIVE 로 보인다)
        focusSessionRepository.cancelSessionIfActive(open.getId(), Instant.parse("2026-07-03T00:30:00Z"));
        focusSessionRepository.flush();

        // then: 캐시된 엔티티는 낡았지만, 스칼라 조회는 DB 값을 그대로 읽는다(clear() 없이)
        assertThat(loaded.getStatus()).isEqualTo(FocusSessionStatus.ACTIVE);
        assertThat(focusSessionRepository.findStatusById(open.getId()))
                .contains(FocusSessionStatus.CANCELED);
    }

    // ── findLiveSessionsByUserIdIn (GROMO-822 FocusLiveInfoLookup 공용) ──

    @Test
    @DisplayName("findLiveSessionsByUserIdIn — 미종료 세션만(userId 집합) + 태그명 fetch join 매핑. 종료 세션·집합 밖 유저 제외")
    void findLiveSessionsByUserIdIn_returnsLiveSessionsWithTag() {
        User other = userRepository.save(User.builder().nickname("other").build());
        User outOfSet = userRepository.save(User.builder().nickname("outOfSet").build());

        DefaultTag defaultTag = defaultTagRepository.save(DefaultTag.builder().name("전공 공부").build());
        UserFocusTag userTag = userFocusTagRepository.save(
                UserFocusTag.builder().user(user).defaultTag(defaultTag).build());

        // user: 진행 중(태그 있음) → 포함
        FocusSession live = focusSessionRepository.save(FocusSession.builder()
                .user(user)
                .startedAt(Instant.parse("2026-07-03T01:00:00Z"))
                .focusTag(userTag)
                .build());
        // user: 종료 세션 → 제외 (endedAt IS NULL 조건)
        focusSessionRepository.save(FocusSession.builder()
                .user(user)
                .startedAt(Instant.parse("2026-07-03T02:00:00Z"))
                .endedAt(Instant.parse("2026-07-03T03:00:00Z"))
                .build());
        // outOfSet: 진행 중이지만 집합 밖 → 제외
        focusSessionRepository.save(FocusSession.builder()
                .user(outOfSet)
                .startedAt(Instant.parse("2026-07-03T01:30:00Z"))
                .build());
        focusSessionRepository.flush();
        entityManager.clear();   // 1차 캐시 비우고 fetch join 로딩·매핑 검증

        // other 는 집합에 있으나 라이브 세션 없음 → 결과에 미포함되어야 한다
        List<FocusSession> result = focusSessionRepository.findLiveSessionsByUserIdIn(
                List.of(user.getId(), other.getId()), LIVE_SINCE);

        assertThat(result).hasSize(1);
        assertThat(result.get(0).getId()).isEqualTo(live.getId());
        assertThat(result.get(0).getFocusTag().getDefaultTag().getName()).isEqualTo("전공 공부");
    }

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
        assertThat(result.get(0).getFocusTag()).isNull();
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

    // ── 태그 rename 세션 재연결(repointFocusTag) (GROMO-754) ─────────────────

    @Test
    @DisplayName("repointFocusTag — 옛 태그를 참조하던 세션만 새 태그로 이동, 무관 세션은 그대로")
    void repointFocusTagMovesOnlyOldTagSessions() {
        // given: 옛 태그('이전이름')를 참조하는 세션 2개 + 무관 태그('무관')를 참조하는 세션 1개
        DefaultTag oldDefault = defaultTagRepository.save(DefaultTag.builder().name("이전이름").build());
        DefaultTag newDefault = defaultTagRepository.save(DefaultTag.builder().name("새이름").build());
        DefaultTag otherDefault = defaultTagRepository.save(DefaultTag.builder().name("무관").build());
        UserFocusTag oldTag = userFocusTagRepository.save(
                UserFocusTag.builder().user(user).defaultTag(oldDefault).build());
        UserFocusTag newTag = userFocusTagRepository.save(
                UserFocusTag.builder().user(user).defaultTag(newDefault).build());
        UserFocusTag otherTag = userFocusTagRepository.save(
                UserFocusTag.builder().user(user).defaultTag(otherDefault).build());

        FocusSession old1 = focusSessionRepository.save(FocusSession.builder()
                .user(user).focusTag(oldTag)
                .startedAt(Instant.parse("2026-07-01T01:00:00Z"))
                .endedAt(Instant.parse("2026-07-01T02:00:00Z"))
                .build());
        FocusSession old2 = focusSessionRepository.save(FocusSession.builder()
                .user(user).focusTag(oldTag)
                .startedAt(Instant.parse("2026-07-02T01:00:00Z"))
                .endedAt(Instant.parse("2026-07-02T02:00:00Z"))
                .build());
        FocusSession unrelated = focusSessionRepository.save(FocusSession.builder()
                .user(user).focusTag(otherTag)
                .startedAt(Instant.parse("2026-07-03T01:00:00Z"))
                .endedAt(Instant.parse("2026-07-03T02:00:00Z"))
                .build());
        focusSessionRepository.flush();

        // when: 옛 태그 참조 세션을 새 태그로 재연결(전체기간, 날짜 조건 없음)
        int updated = focusSessionRepository.repointFocusTag(oldTag, newTag);
        focusSessionRepository.flush();
        entityManager.clear();   // 1차 캐시 비우고 DB 실제 값 재조회

        // then: 옛 태그 세션 2개만 새 태그로 이동, 무관 세션은 그대로
        assertThat(updated).isEqualTo(2);
        assertThat(focusSessionRepository.findById(old1.getId()).orElseThrow()
                .getFocusTag().getId()).isEqualTo(newTag.getId());
        assertThat(focusSessionRepository.findById(old2.getId()).orElseThrow()
                .getFocusTag().getId()).isEqualTo(newTag.getId());
        assertThat(focusSessionRepository.findById(unrelated.getId()).orElseThrow()
                .getFocusTag().getId()).isEqualTo(otherTag.getId());
    }

    // ── 세션 목록 조회(findSessionsByCursor) 취소·자동종료 제외 (GROMO-872) ──

    @Test
    @DisplayName("findSessionsByCursor — CANCELED·AUTO_CLOSED 는 제외하고 ACTIVE·COMPLETED 만 포함")
    void findSessionsByCursorExcludesCanceledAndAutoClosed() {
        // given: 같은 startedAt 윈도우 내에 상태별 세션 4개
        // ACTIVE(진행 중 라이브 또는 레거시 완료) — 포함
        FocusSession active = focusSessionRepository.save(FocusSession.builder()
                .user(user)
                .startedAt(Instant.parse("2026-07-03T01:00:00Z"))
                .build());
        // COMPLETED(정상 완료) — 포함
        FocusSession completed = focusSessionRepository.save(FocusSession.builder()
                .user(user)
                .startedAt(Instant.parse("2026-07-03T02:00:00Z"))
                .endedAt(Instant.parse("2026-07-03T02:30:00Z"))
                .status(FocusSessionStatus.COMPLETED)
                .build());
        // AUTO_CLOSED(orphan 자동 종료 — 라이브 레코드 강제종료 종단) — 제외
        focusSessionRepository.save(FocusSession.builder()
                .user(user)
                .startedAt(Instant.parse("2026-07-03T03:00:00Z"))
                .endedAt(Instant.parse("2026-07-03T04:00:00Z"))
                .status(FocusSessionStatus.AUTO_CLOSED)
                .build());
        // CANCELED(유저 취소 — 라이브 레코드 정상종료 종단) — 제외
        focusSessionRepository.save(FocusSession.builder()
                .user(user)
                .startedAt(Instant.parse("2026-07-03T05:00:00Z"))
                .endedAt(Instant.parse("2026-07-03T05:10:00Z"))
                .status(FocusSessionStatus.CANCELED)
                .build());
        focusSessionRepository.flush();

        // when: 첫 페이지(cursor=null) 전체 조회
        Slice<FocusSession> slice =
                focusSessionRepository.findSessionsByCursor(user, FROM, TO, null, PageRequest.of(0, 20));

        // then: CANCELED·AUTO_CLOSED 는 빠지고 ACTIVE·COMPLETED 2개만 포함(이중집계 방지)
        assertThat(slice.getContent())
                .extracting(FocusSession::getId)
                .containsExactlyInAnyOrder(active.getId(), completed.getId());
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
