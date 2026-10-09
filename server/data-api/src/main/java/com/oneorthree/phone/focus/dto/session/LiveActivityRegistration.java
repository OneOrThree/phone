package com.oneorthree.phone.focus.dto.session;

import com.oneorthree.phone.focus.exception.FocusErrorCode;
import com.oneorthree.phone.focus.exception.FocusException;

import java.util.Set;

/** 토큰을 로그·응답에 노출하지 않는다. 전송 주소와 집중 상태는 서버가 정한다. */
public record LiveActivityRegistration(String activityId, String pushToken, String environment, String catColor) {
    public void validate() {
        if (activityId == null || !activityId.matches("[A-Za-z0-9-]{1,128}")
                || pushToken == null || !pushToken.matches("[a-fA-F0-9]{64,1024}")
                || (pushToken.length() % 2) != 0
                || !Set.of("development", "production").contains(environment == null ? "" : environment)
                || !Set.of("black", "ginger", "cream", "gray", "white", "calico")
                        .contains(catColor == null ? "" : catColor)) {
            throw new FocusException(FocusErrorCode.INVALID_LIVE_ACTIVITY);
        }
    }

    @Override
    public String toString() {
        return "LiveActivityRegistration[redacted]";
    }
}
