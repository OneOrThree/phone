package com.oneorthree.phone.magazine.support;

import com.oneorthree.phone.common.util.ZonePolicy;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZonedDateTime;

/**
 * 고양이 잡지의 시각 계산 (GROMO-2289, 잡지 구현 계획 §4-1) — 신청·고치기·불러오기가 모두 이 한 곳을 본다.
 *
 * <pre>
 * D일 07:00          D일 호 발행 · D+1일 호 신청 창 열림
 * D+1일 00:00        신청 마감 — 이후 D+1일 호는 고칠 수 없다(10/14 확정)
 * D+1일 00:00~07:00  창 닫힘(사전 검토 없음)
 * D+1일 07:00        D+1일 호 발행 · D+2일 호 신청 창 열림
 * </pre>
 *
 * <p>「07시」는 정본이 한국 시간으로 못 박은 제품 규칙이라 {@link ZonePolicy#KST} 고정이다 — UTC 전환(date-axis D8) 때
 * 이 클래스만 다시 본다. 00시 마감에는 배치가 필요 없다: 신청·고치기 API 가 요청 시각으로 판정한다.
 */
public final class MagazineCalendar {

    /** 발행 시각이자 다음 호 신청 창이 열리는 시각(KST). */
    public static final LocalTime OPENS = LocalTime.of(7, 0);

    private MagazineCalendar() {
    }

    /** 신청 창이 열려 있나 — KST 07:00:00~23:59:59. */
    public static boolean isWindowOpen(Instant now) {
        return !kst(now).toLocalTime().isBefore(OPENS);
    }

    /**
     * 지금 열려 있거나(07~24시) 다음에 열릴(00~07시) 신청 창이 향하는 호 = KST 오늘 + 1. 창이 열려 있을 때의 신청·고치기는
     * 이 호에만 된다.
     */
    public static LocalDate windowIssueDate(Instant now) {
        return kst(now).toLocalDate().plusDays(1);
    }

    /** 아직 발행되지 않은 가장 가까운 호 — 07시 전이면 오늘 07시 호, 07시부터는 내일 호. */
    public static LocalDate upcomingIssueDate(Instant now) {
        return isWindowOpen(now) ? windowIssueDate(now) : windowIssueDate(now).minusDays(1);
    }

    /** {@code issueDate} 호의 신청 창 시작 — 전날 07:00 KST. */
    public static Instant opensAt(LocalDate issueDate) {
        return issueDate.minusDays(1).atTime(OPENS).atZone(ZonePolicy.KST).toInstant();
    }

    /** {@code issueDate} 호의 신청 마감 — 그날 00:00 KST. */
    public static Instant closesAt(LocalDate issueDate) {
        return issueDate.atStartOfDay(ZonePolicy.KST).toInstant();
    }

    private static ZonedDateTime kst(Instant now) {
        return now.atZone(ZonePolicy.KST);
    }
}
