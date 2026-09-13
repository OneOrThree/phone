package com.oneorthree.phone.user.support;

import com.oneorthree.phone.common.exception.CommonErrorCode;
import com.oneorthree.phone.common.exception.DomainException;

/** Data 직접 공개 PUT을 Business의 동일 내구 단계 키에 연결한다. 내부 API에는 적용하지 않는다. */
public final class NotificationSettingsCommandKeys {
    private static final int MAX_PUBLIC_KEY_LENGTH = 150;
    private static final String OUTBOX_SUFFIX = ":settings-outbox";

    private NotificationSettingsCommandKeys() {
    }

    public static String fromPublicHeader(String header) {
        if (header == null || header.isBlank()) {
            // 키 없는 legacy 요청은 기존 매 요청 새 명령 동작을 유지한다.
            return null;
        }
        String base = header.trim();
        if (base.length() > MAX_PUBLIC_KEY_LENGTH) {
            throw new InvalidKeyException();
        }
        // raw 자체가 접미로 끝나더라도 Business처럼 덧붙인다. 내부 저장 키는 이 함수를 거치지 않는다.
        return base + OUTBOX_SUFFIX;
    }

    private static final class InvalidKeyException extends DomainException {
        private InvalidKeyException() {
            super(CommonErrorCode.INVALID_PARAMETER);
        }

        @Override
        public CommonErrorCode getErrorCode() {
            return CommonErrorCode.INVALID_PARAMETER;
        }
    }
}
