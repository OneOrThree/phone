package com.oneorthree.business.upstream.data.dto;

import java.util.List;

/**
 * 회관 기록(도서관) 통계 3종의 상류 응답 (GROMO-1769, island-records LLD §2·§4). 날짜는 UTC 버킷({@code YYYY-MM-DD}),
 * 시각은 UTC instant 문자열이다 — 형식을 다시 쓰지 않고 그대로 내보낸다.
 *
 * <p>Data 는 scope 별로 필요한 필드만 채우고 나머지는 null 로 보낸다. 공개 모양은 {@code IslandRecordsUseCase} 가
 * scope 별 record 로 만든다. 항목 record 는 공개 모양과 같아 그대로 싣는다.
 */
public final class IslandRecordViews {

    private IslandRecordViews() {
    }

    /** 집중 통계 상류. me 다음 페이지가 있으면 {@code nextSnapshotId·nextOffset} 이 함께 온다. */
    public record FocusStatistics(String scope, Long totalSeconds, List<DaySeconds> series,
            List<FocusRecord> records, List<FocusMember> members, String asOf, String nextSnapshotId,
            Integer nextOffset) {
    }

    public record DaySeconds(String date, long seconds) {
    }

    /** 완료 세션 한 건 — {@code activeSeconds} 는 조회 범위에 배분된 몫. */
    public record FocusRecord(String id, String subject, long activeSeconds, String completedAt) {
    }

    /** 섬 주민의 이 섬 기여 — 개인 기록·과목 없음. */
    public record FocusMember(String userId, String name, String catColor, long totalSeconds,
            List<DaySeconds> series) {
    }

    /** 스크린타임 통계 상류. */
    public record ScreenTimeStatistics(String scope, String measurementStatus, Integer totalMinutes,
            List<ScreenDay> series, String updatedAt, List<ScreenMember> members) {
    }

    public record ScreenDay(String date, Integer minutes, String measurementStatus, String updatedAt) {
    }

    /** 섬 주민의 기간 측정 — 기기 목록·deviceId 없음. */
    public record ScreenMember(String userId, String name, String catColor, Integer minutes,
            String measurementStatus, List<ScreenDay> series, String updatedAt) {
    }

    /** PUT 결과 — 그 기기·날짜의 최신 선택 관측(계정 병합값 아님). 공개 {@code data} 와 같다. */
    public record ScreenTimeDay(String date, Integer minutes, String measurementStatus) {
    }
}
