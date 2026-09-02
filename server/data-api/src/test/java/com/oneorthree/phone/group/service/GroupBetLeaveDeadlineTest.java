package com.oneorthree.phone.group.service;

import com.oneorthree.phone.group.repository.domain.GroupBetStatus;
import com.oneorthree.phone.group.repository.domain.GroupChallengeBetParticipant;
import com.oneorthree.phone.group.repository.domain.GroupChallengeBetSession;
import com.oneorthree.phone.group.repository.domain.MissionCategory;
import com.oneorthree.phone.group.repository.domain.MissionType;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 취소 마감 분기(N22 최종안, GROMO-1423)의 경계 단위 테스트 — 판정은 {@code now < leaveDeadline}
 * 하나이므로 마감값과 ±1초 경계를 순수 함수 수준에서 고정한다(실제 흐름은
 * {@link GroupBetLeaveIntegrationTest}·{@link GroupBetJoinServiceIntegrationTest}).
 *
 * <p>엔티티는 빌더로만 조립한다 — {@code @CreationTimestamp} 는 persist 시점에만 적용되므로
 * 빌더 값이 그대로 참가 시각이 된다.
 */
class GroupBetLeaveDeadlineTest {

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");
    private static final LocalDate DATE = LocalDate.of(2026, 8, 12);
    /** 하루형 회차 — 시작 00:00, 종료 익일 00:00 (KST). */
    private static final Instant STARTS_AT = DATE.atStartOfDay(KST).toInstant();
    private static final Instant CLOSES_AT = DATE.plusDays(1).atStartOfDay(KST).toInstant();

    private static GroupChallengeBetSession session(Instant startsAt, Instant closesAt) {
        return session(startsAt, closesAt, MissionType.DURATION);
    }

    private static GroupChallengeBetSession session(
            Instant startsAt, Instant closesAt, MissionType missionType) {
        return GroupChallengeBetSession.builder()
                .sessionDate(DATE)
                .stake(30)
                .missionCategory(MissionCategory.FOCUS)
                .missionType(missionType)
                .status(GroupBetStatus.OPEN)
                .startsAt(startsAt)
                .joinClosesAt(closesAt)
                .closesAt(closesAt)
                .settleAfter(closesAt)
                .build();
    }

    private static GroupChallengeBetParticipant participantAt(Instant joinedAt) {
        return GroupChallengeBetParticipant.builder().createdAt(joinedAt).build();
    }

    @Test
    @DisplayName("시작 전 참가 — 마감은 회차 시작이고 5분 유예가 없다 (시작 ±1초 경계)")
    void beforeStartJoinDeadlineIsSessionStart() {
        GroupChallengeBetSession session = session(STARTS_AT, CLOSES_AT);
        // 창 시작 1초 전 참가 — max(시작, 참가+5분)이었다면 시작 후 4분 59초까지 무를 수 있었다.
        GroupChallengeBetParticipant participant = participantAt(STARTS_AT.minusSeconds(1));

        Instant deadline = GroupBetService.leaveDeadline(session, participant);

        assertThat(deadline).isEqualTo(STARTS_AT);
        // now < deadline 판정: 시작 1초 전 = 가능, 시작 정각·1초 후 = 불가.
        assertThat(STARTS_AT.minusSeconds(1).isBefore(deadline)).isTrue();
        assertThat(STARTS_AT.isBefore(deadline)).isFalse();
        assertThat(STARTS_AT.plusSeconds(1).isBefore(deadline)).isFalse();
    }

    @Test
    @DisplayName("시작 후 참가(하루형) — 마감은 참가+5분이다 (참가+5분 ±1초 경계)")
    void afterStartJoinDeadlineIsGraceEnd() {
        GroupChallengeBetSession session = session(STARTS_AT, CLOSES_AT);
        Instant joinedAt = STARTS_AT.plus(Duration.ofHours(10));
        GroupChallengeBetParticipant participant = participantAt(joinedAt);

        Instant deadline = GroupBetService.leaveDeadline(session, participant);

        Instant graceEnd = joinedAt.plus(Duration.ofMinutes(5));
        assertThat(deadline).isEqualTo(graceEnd);
        assertThat(graceEnd.minusSeconds(1).isBefore(deadline)).isTrue();
        assertThat(graceEnd.isBefore(deadline)).isFalse();
        assertThat(graceEnd.plusSeconds(1).isBefore(deadline)).isFalse();
    }

    @Test
    @DisplayName("시작 후 참가가 종료 직전이면 — 유예가 회차 종료에서 잘린다 (자정 정산 CAS 경합 차단)")
    void graceIsCappedAtSessionClose() {
        GroupChallengeBetSession session = session(STARTS_AT, CLOSES_AT);
        // 23:58 참가 — 유예 그대로면 00:03 까지 살아 자정 정산과 경합한다.
        GroupChallengeBetParticipant participant = participantAt(CLOSES_AT.minus(Duration.ofMinutes(2)));

        assertThat(GroupBetService.leaveDeadline(session, participant)).isEqualTo(CLOSES_AT);
    }

    @Test
    @DisplayName("시작 정각 참가는 '시작 후 참가'다 — isBefore 경계가 유예 쪽으로 떨어진다")
    void joinExactlyAtStartCountsAsAfterStart() {
        GroupChallengeBetSession session = session(STARTS_AT, CLOSES_AT);
        GroupChallengeBetParticipant participant = participantAt(STARTS_AT);

        assertThat(GroupBetService.leaveDeadline(session, participant))
                .isEqualTo(STARTS_AT.plus(Duration.ofMinutes(5)));
    }

    @Test
    @DisplayName("창형은 시작 후 참가에도 유예가 없다 — 마감은 창 시작이다 (창 관전 후 이탈 차단)")
    void windowSessionNeverGrantsGraceAfterStart() {
        // 레거시 참가 경로(N36 브리지)는 창형을 창 종료까지 열어 두므로 createdAt >= startsAt 인
        // 창형 참가자가 실제로 존재한다. 유예를 주면 진행 중인 창을 확인하고 판돈을 뺄 수 있다.
        Instant windowStart = DATE.atTime(9, 0).atZone(KST).toInstant();
        Instant windowEnd = DATE.atTime(11, 0).atZone(KST).toInstant();
        GroupChallengeBetSession session = session(windowStart, windowEnd, MissionType.TIME_WINDOW);
        GroupChallengeBetParticipant joinedMidWindow =
                participantAt(windowStart.plus(Duration.ofMinutes(30)));

        Instant deadline = GroupBetService.leaveDeadline(session, joinedMidWindow);

        assertThat(deadline).isEqualTo(windowStart);
        // 참가 직후(유예 안에 해당할 시각)에도 이미 마감이다.
        assertThat(joinedMidWindow.getCreatedAt().isBefore(deadline)).isFalse();
    }

    @Test
    @DisplayName("창형 — 창 시작 전 참가의 마감도 창 시작 그대로다 (분기 통일)")
    void windowSessionBeforeStartKeepsStartDeadline() {
        Instant windowStart = DATE.atTime(9, 0).atZone(KST).toInstant();
        Instant windowEnd = DATE.atTime(11, 0).atZone(KST).toInstant();
        GroupChallengeBetSession session = session(windowStart, windowEnd, MissionType.TIME_WINDOW);

        assertThat(GroupBetService.leaveDeadline(session, participantAt(windowStart.minusSeconds(1))))
                .isEqualTo(windowStart);
    }

    @Test
    @DisplayName("예약분(미래 회차) 참가 — 마감은 그 회차 시작까지다 (N22 예약분 동일 규칙)")
    void reservedFutureSessionDeadlineIsItsStart() {
        Instant futureStart = DATE.plusDays(3).atStartOfDay(KST).toInstant();
        Instant futureClose = DATE.plusDays(4).atStartOfDay(KST).toInstant();
        GroupChallengeBetSession session = session(futureStart, futureClose);
        GroupChallengeBetParticipant participant = participantAt(STARTS_AT.minus(Duration.ofDays(1)));

        assertThat(GroupBetService.leaveDeadline(session, participant)).isEqualTo(futureStart);
    }
}
