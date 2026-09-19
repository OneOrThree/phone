package com.oneorthree.phone.internal.dto;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * 회관 기록(도서관) 통계 3종의 내부 표면 DTO (GROMO-1769, island-records LLD §2·§4).
 *
 * <p>Data 는 scope 별로 필요한 필드만 채우고 나머지는 {@code null} 로 둔다 — 공개 모양(scope 별 필드 집합)은
 * Business 가 만든다. 날짜는 UTC 버킷이다(2026-09-19 결정 RC-축).
 */
public final class IslandRecordViews {

    private IslandRecordViews() {
    }

    /**
     * 집중 통계. scope=me 는 {@code totalSeconds·series·records}, scope=island 는 {@code members} 를 채운다.
     * 다음 페이지가 있으면(me 만) {@code nextSnapshotId·nextOffset} 이 함께 있다 — Business 가 서명 커서로 감싼다.
     */
    public record FocusStatistics(String scope, Long totalSeconds, List<DaySeconds> series,
                                  List<FocusRecord> records, List<FocusMember> members, Instant asOf,
                                  UUID nextSnapshotId, Integer nextOffset) {
    }

    /** 날짜 하나의 순수 ACTIVE 초. */
    public record DaySeconds(LocalDate date, long seconds) {
    }

    /** 완료 세션 한 건 — {@code activeSeconds} 는 조회 날짜 범위에 배분된 그 세션의 몫이다(LLD §2). */
    public record FocusRecord(UUID id, String subject, long activeSeconds, Instant completedAt) {
    }

    /** 섬 주민 한 명의 이 섬 기여 — 개인 기록·과목은 싣지 않는다(RC-P05). catColor 는 미답(Q03)이라 null. */
    public record FocusMember(UUID userId, String name, String catColor, long totalSeconds,
                              List<DaySeconds> series) {
    }

    /** scope=me 스냅샷에 고정하는 값 — 합계·일별·기록 전체와 관측 시각. */
    public record FocusSnapshot(Instant asOf, long totalSeconds, List<DaySeconds> series,
                                List<FocusRecord> records) {
    }

    /**
     * 스크린타임 통계. scope=me 는 {@code measurementStatus·totalMinutes·series·updatedAt}, scope=island 는
     * {@code members} 를 채운다. 측정이 전혀 없으면 {@code unavailable / null / [] / null} 이다(LLD §2).
     */
    public record ScreenTimeStatistics(String scope, String measurementStatus, Integer totalMinutes,
                                       List<ScreenDay> series, Instant updatedAt, List<ScreenMember> members) {
    }

    /** 날짜 하나의 측정 — authorized 가 아니면 {@code minutes} 는 null 이다. */
    public record ScreenDay(LocalDate date, Integer minutes, String measurementStatus, Instant updatedAt) {
    }

    /** 섬 주민 한 명의 기간 측정. 기기 목록·deviceId 는 싣지 않는다. */
    public record ScreenMember(UUID userId, String name, String catColor, Integer minutes, String measurementStatus,
                               List<ScreenDay> series, Instant updatedAt) {
    }

    /** {@code PUT /me/screen-time/{date}} 본문 — Business 가 모양을 검증하고 timezone 을 {@code UTC} 로 정규화했다. */
    public record ScreenTimeUpload(Integer minutes, String measurementStatus, String timezone, Instant measuredAt,
                                   UUID deviceId) {
    }

    /** PUT 응답 — 그 <b>기기·날짜의 최신 선택 관측</b>이다(계정 전체 병합값이 아니다, LLD §4). */
    public record ScreenTimeDay(LocalDate date, Integer minutes, String measurementStatus) {
    }
}
