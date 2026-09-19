package com.oneorthree.phone.appearance.dto;

/**
 * 공용 음악 재생 상태 공개 DTO (GROMO-1779, island-playback LLD §2) — GET 응답·PATCH data·
 * playback.updated payload 가 같은 모양이다. 원본 7필드 뒤에 확장 {@code durationSeconds}(정책 M07).
 *
 * <p>시각은 ISO-8601 문자열로 둔다 — receipt 에 저장된 바이트가 재생 때 그대로 나가야 하므로
 * 직렬화기 설정에 따라 모양이 바뀌는 {@code Instant} 를 싣지 않는다.
 *
 * @param trackId         선택 곡, 초기 미선택이면 null
 * @param positionSeconds effectiveAt 시점의 위치(초) — 현재 위치가 아니다(앱이 경과를 더한다)
 * @param changedBy       마지막 실제 변경 사용자 UUID, 초기 미선택이면 null
 * @param serverNow       GET 은 관측 시각, 명령은 전이 기준 시각 — 재생 응답은 원 결과의 값이다
 * @param durationSeconds 곡의 불변 길이(소수 허용), 곡이 없으면 null
 */
public record PlaybackView(
        String trackId,
        boolean playing,
        long positionSeconds,
        String effectiveAt,
        String changedBy,
        long version,
        String serverNow,
        Double durationSeconds) {
}
