package com.oneorthree.phone.focus.dto;

import com.oneorthree.phone.focus.domain.FocusType;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;
import java.time.LocalDate;
import java.util.Map;
import java.util.UUID;

@Getter
@NoArgsConstructor
@AllArgsConstructor
public class FocusSessionRequest {
    UUID focusTagId;
    Instant startedAt;
    Instant endedAt;
    int totalDistractionSeconds;
    // GROMO-733: 세션 유형(INFINITE/RANGE/POMODORO, additive). null 이면 서비스에서 INFINITE 기본(하위호환).
    FocusType focusType;

    /**
     * GROMO-1252: 이 세션의 <b>날짜별 집중 초</b>(로컬 날짜 "YYYY-MM-DD" → 초, additive).
     *
     * <p>업로드 구간엔 일시정지 공백이 섞여 있어 서버가 벽시계로 쪼개면 자정을 걸친 세션의 날짜별 몫이
     * 어긋난다(23:50~23:55 집중 → 일시정지 → 00:10~00:15 집중 = 300/300 인데 벽시계는 600/900).
     * 날짜별 분포를 아는 건 앱뿐이라 앱이 실어 보낸다.
     *
     * <p>null·빈 맵이면 서버가 종전대로 벽시계 분할({@code FocusService.splitByLocalDay})로 폴백한다 —
     * 구버전 앱 호환. 실려 온 값은 무검증 수용하지 않는다(날짜별 벽시계 몫으로 클램프 + 세션 구간과
     * 겹치지 않는 날짜 폐기 — {@code FocusService.resolveSecondsByDate}).
     */
    Map<LocalDate, Integer> focusSecondsByDate;

    /** 하위호환 — focusType 미지정 기존 4-arg 호출부(null → 서비스에서 INFINITE 기본). */
    public FocusSessionRequest(UUID focusTagId, Instant startedAt, Instant endedAt, int totalDistractionSeconds) {
        this(focusTagId, startedAt, endedAt, totalDistractionSeconds, null);
    }

    /** 하위호환 — focusSecondsByDate 미지정 기존 5-arg 호출부(null → 서버 벽시계 분할 폴백). */
    public FocusSessionRequest(UUID focusTagId, Instant startedAt, Instant endedAt, int totalDistractionSeconds,
                               FocusType focusType) {
        this(focusTagId, startedAt, endedAt, totalDistractionSeconds, focusType, null);
    }
}
