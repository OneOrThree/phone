package com.oneorthree.phone.focus.dto.session;

/**
 * 집중섬에서 앉은 자리 (GROMO-2477) — 시작 때 앱이 고른 지도 % 좌표(0~100) 그대로다. 반올림하지 않는다.
 *
 * <p>서버는 범위만 본다. 땅·겹침 판정은 앱 몫이다(맞지 않으면 앱이 빈 자리로 다시 배정한다). 본문 파서 안의 예외는
 * 읽기 실패 400 {@code INVALID_REQUEST} 로 나간다({@code GuestbookWriteRequest} 와 같은 결). NaN 은 비교가 전부
 * 거짓이라 범위 검사에 함께 걸린다. 저장 열은 {@code focus_session_details.seat_x/seat_y}(CHECK 가 같은 범위를 묶는다).
 *
 * @param x 가로 % (0~100)
 * @param y 세로 % (0~100)
 */
public record FocusSeat(Double x, Double y) {

    public FocusSeat {
        if (!inRange(x) || !inRange(y)) {
            throw new IllegalArgumentException("자리 좌표는 0~100 이어야 합니다.");
        }
    }

    /** 저장된 두 열에서 되살린다 — 자리 없이 시작한 세션(둘 다 null)이면 {@code null}. */
    public static FocusSeat of(Double x, Double y) {
        return x == null && y == null ? null : new FocusSeat(x, y);
    }

    private static boolean inRange(Double value) {
        return value != null && value >= 0 && value <= 100;
    }
}
