package com.oneorthree.business.common.http;

/**
 * 필수 설정값 검증 — <b>비어 있는 것뿐 아니라 「치환되지 않은 플레이스홀더」도 거절</b>한다.
 *
 * <h2>왜 blank 검사만으로는 부족한가 (실측)</h2>
 * {@code application-prod.yml} 은 {@code service-token: ${SVC_TOKEN_BIZ_TO_LINK}} 처럼 기본값 없는
 * 플레이스홀더만 둔다. 그런데 <b>그 환경변수가 아예 없을 때 Spring 은 부팅을 실패시키지 않고 값을
 * 리터럴 {@code "${SVC_TOKEN_BIZ_TO_LINK}"} 로 남긴다</b> — 실제로 이 이미지를 해당 변수 없이 띄워
 * {@code Started BusinessApplication} 까지 확인했다.
 *
 * <p>그 상태는 정확히 우리가 막으려던 것이다: 리터럴이 Bearer 토큰으로 실려 나가 <b>상류가 전부 401</b>
 * 을 주고, 그 401 은 운영에서 「인증 장애」로 보여 <b>원인이 시크릿 미주입이라는 사실이 가려진다</b>.
 *
 * <p>그리고 이 경로는 가설이 아니다 — dev 배포의 env 생성기는 <b>고정 허용목록에 있는 키만 출력</b>
 * 하므로(A22 ㋯), 새 키를 허용목록에 추가하는 것을 빠뜨리면 변수는 «없는» 상태가 된다. 가장 일어나기
 * 쉬운 실수가 곧 이 구멍이었다.
 */
public final class RequiredConfig {

    private RequiredConfig() {
    }

    /**
     * @param value 검증할 값
     * @param what  실패 메시지에 넣을 설정 이름(예: {@code "LINK service-token"})
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
