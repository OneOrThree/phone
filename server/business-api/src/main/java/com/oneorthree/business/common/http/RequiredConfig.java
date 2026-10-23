package com.oneorthree.business.common.http;

/** 필수 설정값은 빈 문자열과 치환되지 않은 환경변수 플레이스홀더를 모두 거절한다. */
public final class RequiredConfig {

    private RequiredConfig() {
    }

    /**
     * @param value 검증할 값
     * @param what  실패 메시지에 넣을 설정 이름(예: {@code "DATA service-token"})
     * @return 검증을 통과한 값
     * @throws IllegalStateException 비어 있거나 치환되지 않은 {@code ${...}} 플레이스홀더일 때
     */
    public static String require(String value, String what) {
        if (value == null || value.isBlank()) {
            throw new IllegalStateException(what + " 미설정");
        }
        String trimmed = value.trim();
        if (trimmed.startsWith("${") && trimmed.endsWith("}")) {
            // ⚠️ 값 전체를 메시지에 넣어도 안전하다 — 치환되지 않았으므로 비밀이 아니라 변수 «이름» 이다.
            //    오히려 이름을 보여 주는 것이 「어느 env 키가 전달되지 않았는가」를 바로 알려 준다.
            throw new IllegalStateException(
                    what + " 이 치환되지 않았다: " + trimmed
                            + " — 환경변수가 전달되지 않았다(dev 는 env 생성기의 허용목록 확인)");
        }
        return value;
    }
}
