package com.oneorthree.phone.focus.dto;

import com.oneorthree.phone.focus.repository.domain.FocusType;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;
import java.time.LocalDate;
import java.util.Map;
import java.util.UUID;

/**
 * 완료된 집중 블록 업로드 요청(POST) — 라이브 마커를 거치지 않고 구간을 통째로 올린다.
 *
 * <p>시작·종료 시각을 <b>클램프하지 않고 그대로</b> 저장하는 유일한 경로다. 재업로드 중복 검사가
 * (유저, 시작, 종료) 완전일치로 이뤄지기 때문에 값을 손대면 같은 블록이 두 번 저장된다. 대신 미래
 * 종료 위조는 통계 귀속용 유효 종료에서, 장시간 위조는 보상 상한(12h)에서 잘린다.
 *
 * <p>생성자가 여럿인 건 필드가 additive 하게 늘어난 흔적이다 — 구버전 앱이 보내지 않는 필드는
 * 전부 null 로 떨어지고, 그때의 폴백 동작이 각 생성자 문서에 적혀 있다.
 */
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
    /**
     * GROMO-1214 코드리뷰(돈 경로): 음수 금지 — 지급 공식이 (endedAt − startedAt) − totalDistractionSeconds 라
     * 음수는 집중초를 부풀린다. PATCH(FocusSessionEndRequest)와 같은 범위로 맞춘다.
     */
    @PositiveOrZero
    @Max(value = 24 * 60 * 60, message = "하루 24시간을 넘을 수 없습니다")
    // 앱이 세는 건 수동 일시정지뿐이다 — 뽀모도로 휴식·실드 이탈 크레딧은 정산 구간 밖이라
    // 여기 넣으면 이중 차감이 된다(app/screens/focus/blockPause.ts 헤더 주석이 정본).
    int totalDistractionSeconds;
    /**
     * GROMO-733: 세션 유형(INFINITE/RANGE/POMODORO, additive). null 이면 서비스에서 INFINITE 기본(하위호환).
     */
    FocusType focusType;
    /**
     * GROMO-1214 코드리뷰(additive): 이 POST 가 '라이브 마커의 폴백'일 때 그 마커 id. PATCH 가 커밋됐는데 응답만
     * 유실돼 앱이 POST 로 폴백하는 경우, 서버가 클램프한 마커 구간과 앱이 보낸 원본 타임스탬프가 달라
     * (startedAt, endedAt) 중복 검사가 못 잡는다(기기 시계 스큐). 그 마커가 이미 COMPLETED 인지로 먼저 거른다.
     */
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
     *
     * <p>엔트리 수는 {@link #MAX_SECONDS_BY_DATE_ENTRIES} 개로 제한한다 — 초과 시 400.
     */
    @Size(max = MAX_SECONDS_BY_DATE_ENTRIES)
    Map<LocalDate, Integer> focusSecondsByDate;

    /**
     * 하위호환 — focusType·sessionId·focusSecondsByDate 미지정 기존 4-arg 호출부.
     *
     * @param focusTagId              소유 태그 id. null 이면 태그 없는 세션
     * @param startedAt               시작 시각(필수). 클램프 없이 그대로 저장된다
     * @param endedAt                 종료 시각(필수). 시작보다 앞서면 400
     * @param totalDistractionSeconds 누적 방해 초. 집중 시간과 보상에서 그대로 차감된다
     */
    public FocusSessionRequest(UUID focusTagId, Instant startedAt, Instant endedAt, int totalDistractionSeconds) {
        this(focusTagId, startedAt, endedAt, totalDistractionSeconds, null, null, null);
    }

    /**
     * 하위호환 — sessionId(마커 폴백 표식)·focusSecondsByDate(날짜별 집중초) 미지정 기존 5-arg 호출부.
     * 둘 다 null 이면 종전 동작: 마커 id 중복 검사 생략 + 서버 벽시계 분할 폴백.
     *
     * @param focusTagId              소유 태그 id. null 이면 태그 없는 세션
     * @param startedAt               시작 시각(필수)
     * @param endedAt                 종료 시각(필수)
     * @param totalDistractionSeconds 누적 방해 초
     * @param focusType               세션 유형. null 이면 INFINITE
     */
    public FocusSessionRequest(UUID focusTagId, Instant startedAt, Instant endedAt, int totalDistractionSeconds,
                               FocusType focusType) {
        this(focusTagId, startedAt, endedAt, totalDistractionSeconds, focusType, null, null);
    }

    /**
     * 하위호환 — 마커 폴백 표식만 싣는 6-arg 호출부(날짜별 집중초 미지정 → 서버 벽시계 분할 폴백).
     *
     * @param focusTagId              소유 태그 id
     * @param startedAt               시작 시각(필수)
     * @param endedAt                 종료 시각(필수)
     * @param totalDistractionSeconds 누적 방해 초
     * @param focusType               세션 유형. null 이면 INFINITE
     * @param sessionId               이 업로드가 폴백하는 마커 id. 서버가 그 마커를 선점해 PATCH 와 직렬화한다
     */
    public FocusSessionRequest(UUID focusTagId, Instant startedAt, Instant endedAt, int totalDistractionSeconds,
                               FocusType focusType, UUID sessionId) {
        this(focusTagId, startedAt, endedAt, totalDistractionSeconds, focusType, sessionId, null);
    }

    /**
     * 하위호환 — 날짜별 집중초만 싣는 6-arg 호출부(마커 폴백 표식 미지정 → id 중복 검사 생략).
     *
     * @param focusTagId              소유 태그 id
     * @param startedAt               시작 시각(필수)
     * @param endedAt                 종료 시각(필수)
     * @param totalDistractionSeconds 누적 방해 초
     * @param focusType               세션 유형. null 이면 INFINITE
     * @param focusSecondsByDate      날짜별 집중 초. 자정을 걸친 세션의 귀속 근거이고, 무검증 수용이 아니라
     *                                날짜별 벽시계 몫으로 클램프된다
     */
    public FocusSessionRequest(UUID focusTagId, Instant startedAt, Instant endedAt, int totalDistractionSeconds,
                               FocusType focusType, Map<LocalDate, Integer> focusSecondsByDate) {
        this(focusTagId, startedAt, endedAt, totalDistractionSeconds, focusType, null, focusSecondsByDate);
    }
}
