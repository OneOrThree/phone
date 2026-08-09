package com.oneorthree.phone.focus.dto;

import com.oneorthree.phone.focus.domain.FocusType;
import jakarta.validation.constraints.Size;
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

    /**
     * {@link #focusSecondsByDate} 엔트리 수 상한 (GROMO-1252 코드리뷰 4차 ③).
     *
     * <p>인증된 클라가 임의로 큰 맵을 보내면 Jackson 이 키를 전부 {@code LocalDate} 로 만들고 서버가 그
     * 전체를 순회한다 — 서버 벽시계 맵은 어차피 이 수로 캡되어 있어 초과분은 전량 폐기되는데 힙·CPU 만
     * 태운다. 정상 세션은 12h(orphan 상한) 이내라 조각이 2개를 넘지 않으므로 여유 있는 상한이다.
     * 서버 분할 상한({@code FocusService.MAX_SPLIT_DAYS})이 이 값을 그대로 쓴다 — 정본은 여기 하나.
     */
    public static final int MAX_SECONDS_BY_DATE_ENTRIES = 32;

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
     *
     * <p>엔트리 수는 {@link #MAX_SECONDS_BY_DATE_ENTRIES} 개로 제한한다 — 초과 시 400.
     */
    @Size(max = MAX_SECONDS_BY_DATE_ENTRIES)
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
