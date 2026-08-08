package com.oneorthree.phone.focus.dto;

import com.oneorthree.phone.focus.domain.FocusType;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.PositiveOrZero;
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
    // GROMO-1214 코드리뷰(돈 경로): 음수 금지 — 지급 공식이 (endedAt − startedAt) − totalDistractionSeconds 라
    // 음수는 집중초를 부풀린다. PATCH(FocusSessionEndRequest)와 같은 범위로 맞춘다.
    @PositiveOrZero
    @Max(value = 24 * 60 * 60, message = "하루 24시간을 넘을 수 없습니다")
    int totalDistractionSeconds;
    // GROMO-733: 세션 유형(INFINITE/RANGE/POMODORO, additive). null 이면 서비스에서 INFINITE 기본(하위호환).
    FocusType focusType;
    // GROMO-1214 코드리뷰(additive): 이 POST 가 '라이브 마커의 폴백'일 때 그 마커 id. PATCH 가 커밋됐는데 응답만
    // 유실돼 앱이 POST 로 폴백하는 경우, 서버가 클램프한 마커 구간과 앱이 보낸 원본 타임스탬프가 달라
    // (startedAt, endedAt) 중복 검사가 못 잡는다(기기 시계 스큐). 그 마커가 이미 COMPLETED 인지로 먼저 거른다.
    UUID sessionId;

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

    /** 하위호환 — focusType·sessionId·focusSecondsByDate 미지정 기존 4-arg 호출부. */
    public FocusSessionRequest(UUID focusTagId, Instant startedAt, Instant endedAt, int totalDistractionSeconds) {
        this(focusTagId, startedAt, endedAt, totalDistractionSeconds, null, null, null);
    }

    /**
     * 하위호환 — sessionId(마커 폴백 표식)·focusSecondsByDate(날짜별 집중초) 미지정 기존 5-arg 호출부.
     * 둘 다 null 이면 종전 동작: 마커 id 중복 검사 생략 + 서버 벽시계 분할 폴백.
     */
    public FocusSessionRequest(UUID focusTagId, Instant startedAt, Instant endedAt, int totalDistractionSeconds,
                               FocusType focusType) {
        this(focusTagId, startedAt, endedAt, totalDistractionSeconds, focusType, null, null);
    }

    /** 하위호환 — 마커 폴백 표식만 싣는 6-arg 호출부(날짜별 집중초 미지정 → 서버 벽시계 분할 폴백). */
    public FocusSessionRequest(UUID focusTagId, Instant startedAt, Instant endedAt, int totalDistractionSeconds,
                               FocusType focusType, UUID sessionId) {
        this(focusTagId, startedAt, endedAt, totalDistractionSeconds, focusType, sessionId, null);
    }

    /** 하위호환 — 날짜별 집중초만 싣는 6-arg 호출부(마커 폴백 표식 미지정 → id 중복 검사 생략). */
    public FocusSessionRequest(UUID focusTagId, Instant startedAt, Instant endedAt, int totalDistractionSeconds,
                               FocusType focusType, Map<LocalDate, Integer> focusSecondsByDate) {
        this(focusTagId, startedAt, endedAt, totalDistractionSeconds, focusType, null, focusSecondsByDate);
    }
}
