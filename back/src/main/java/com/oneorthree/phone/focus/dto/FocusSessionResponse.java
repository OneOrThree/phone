package com.oneorthree.phone.focus.dto;

import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

/**
 * 집중 세션 1건 응답.
 *
 * <p>GROMO-673: {@code focusTagId} 의미는 user_focus_tags.id (세션이 참조하는 채택 태그의 id).
 * JSON 키(focusTagId)는 유지된다.
 */
@Getter
@NoArgsConstructor
@AllArgsConstructor
public class FocusSessionResponse {
    UUID focusTagId;
    Instant startedAt;
    Instant endedAt;
    int totalDistractionSeconds;

    /**
     * GROMO-1252(코드리뷰 3차 ①): 완료 시점에 확정한 날짜별 집중 초
     * (유저 존 로컬 날짜 "YYYY-MM-DD" → 초, additive).
     *
     * <p>앱 복원(재로그인 시 '오늘 집중'·과목별 누적 재계산)이 세션 구간을 다시 벽시계로 자르지 않고
     * 서버 사전집계와 같은 분포를 쓰게 하려고 함께 내려준다. 분포 미기록(레거시) 세션은 null —
     * 앱이 종전 구간 겹침 추정으로 폴백한다.
     */
    Map<String, Integer> focusSecondsByDate;

    /** 하위호환 — 분포 없이 만드는 기존 4-arg 호출부(테스트 등). */
    public FocusSessionResponse(UUID focusTagId, Instant startedAt, Instant endedAt,
                                int totalDistractionSeconds) {
        this(focusTagId, startedAt, endedAt, totalDistractionSeconds, null);
    }
}
