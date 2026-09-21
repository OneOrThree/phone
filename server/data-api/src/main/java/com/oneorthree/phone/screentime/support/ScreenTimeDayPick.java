package com.oneorthree.phone.screentime.support;

import com.oneorthree.phone.screentime.repository.domain.ScreenTimeObservation;

import java.time.Instant;
import java.util.Collection;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/**
 * 하루치 스크린타임 관측에서 «그날의 값» 하나를 고르는 규칙 (2026-09-19 결정 RC-D02-기기 · RC-D03).
 *
 * <p><b>정의가 한 곳에만 있어야 하는 규칙이다.</b> 회관 기록 조회({@code IslandRecordsService})와 일일
 * 퀘스트 판정({@code IslandQuestJudge})이 같은 날의 같은 원본을 읽는데, 한쪽만 규칙이 바뀌면 도서관이
 * 「측정 불가」로 보여 주는 날을 퀘스트가 「달성」으로 정산한다 — 그 어긋남은 사용자가 아니라 보상에서
 * 드러나므로 늦게 발견된다.
 *
 * <p>규칙은 둘이다:
 * <ul>
 *   <li>기기(= 서명된 로그인 세션)마다 {@code measuredAt} 이 가장 늦은 관측 하나를 고른다 —
 *       정정 업로드는 <b>대체</b>이지 합산이 아니다(이중 합산 없음).</li>
 *   <li>그날 기기가 <b>둘 이상이면</b> {@code minutes=null}·{@code unavailable} 이다. 병합 정책
 *       (RC-D02)이 보류라 더하지도(중복) 하나를 고르지도(누락) 않는다. 원본은 기기별로 남아 있으므로
 *       정책이 정해지면 다시 계산할 수 있다.</li>
 * </ul>
 */
public final class ScreenTimeDayPick {

    public static final String AUTHORIZED = "authorized";
    public static final String DENIED = "denied";
    public static final String UNAVAILABLE = "unavailable";
    public static final String PENDING = "pending";

    private ScreenTimeDayPick() {
    }

    /**
     * @param sameDay 같은 (사용자, UTC 날짜)의 관측 전부 — 기기가 섞여 있어도 된다
     * @return 그날의 값. 관측이 하나도 없으면 {@code null}(「보고 없음」이며 「0분 사용」이 아니다)
     */
    public static Day of(Collection<ScreenTimeObservation> sameDay) {
        Map<UUID, ScreenTimeObservation> latest = new LinkedHashMap<>();
        for (ScreenTimeObservation observation : sameDay) {
            latest.merge(observation.getDeviceId(), observation,
                    (a, b) -> a.getMeasuredAt().isAfter(b.getMeasuredAt()) ? a : b);
        }
        if (latest.isEmpty()) {
            return null;
        }
        Instant updatedAt = latest.values().stream().map(ScreenTimeObservation::getMeasuredAt)
                .max(Comparator.naturalOrder()).orElseThrow();
        if (latest.size() > 1) {
            return new Day(null, UNAVAILABLE, updatedAt, latest.size());
        }
        ScreenTimeObservation only = latest.values().iterator().next();
        return new Day(only.getMinutes(), only.getMeasurementStatus(), updatedAt, 1);
    }

    /**
     * 한 날짜의 확정 값.
     *
     * @param minutes           측정된 분. {@code authorized} 일 때만 값이 있다(측정된 0 만 0 — RC-P06)
     * @param measurementStatus {@code authorized|denied|unavailable|pending} — 공개 계약 문자열 그대로
     * @param updatedAt         그날 고른 관측들의 가장 늦은 측정 시각
     * @param devices           그날 값을 보낸 기기 수 — {@link #conflicted()} 의 근거다
     */
    public record Day(Integer minutes, String measurementStatus, Instant updatedAt, int devices) {

        /** 숫자를 판정에 쓸 수 있는가 — 권한 있음이고 값이 있다. */
        public boolean measured() {
            return AUTHORIZED.equals(measurementStatus) && minutes != null;
        }

        /**
         * 복수 기기라 병합할 수 없는가(RC-D02 보류).
         *
         * <p>「아직 보고가 안 왔다」와 <b>다른 상태</b>다 — 기다린다고 기기 수가 줄지 않으므로 유예를
         * 기다릴 이유가 없다. 둘을 같이 다루면 복수 기기 주민이 유예 동안 분모에 남아, 그 사이의
         * 전원 달성 판정을 혼자서 막는다.
         */
        public boolean conflicted() {
            return devices > 1;
        }
    }
}
