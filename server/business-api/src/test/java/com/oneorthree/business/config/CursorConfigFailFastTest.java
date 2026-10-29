package com.oneorthree.business.config;

import com.oneorthree.business.common.request.SignedCursorCodec;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

import java.util.Base64;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 커서 서명키가 없거나 치환되지 않았거나 짧으면 <b>부팅에서 실패</b>한다 (티켓 2535 — 서명기는 항상 만든다).
 *
 * <p>왜 첫 목록 요청이 아니라 부팅인가: 종전에는 {@code business.cursor.enabled} 가 없으면 빈이 안 생겨 부팅·헬스는 정상이고
 * 목록의 첫 요청만 503 이 됐다 — 배포 뒤에야 드러나는 모양이다.
 */
@DisplayName("커서 서명키 fail-fast")
class CursorConfigFailFastTest {

    private static final String KEY = Base64.getEncoder().encodeToString(bytes(SignedCursorCodec.MIN_KEY_BYTES));

    private final CursorConfig config = new CursorConfig();

    private static byte[] bytes(int length) {
        byte[] value = new byte[length];
        for (int i = 0; i < length; i++) {
            value[i] = (byte) (i + 1);
        }
        return value;
    }

    private SignedCursorCodec build(String activeKey, Map<String, String> keys) {
        return config.signedCursorCodec(new CursorConfig.Properties(activeKey, keys), new ObjectMapper());
    }

    @Test
    @DisplayName("활성 키가 keys 에 있고 32바이트 이상이면 서명기를 만든다")
    void 정상() {
        assertThat(build("v1", Map.of("v1", KEY))).isNotNull();
    }

    @Test
    @DisplayName("active-key 가 비면 거절한다")
    void 활성키없음() {
        assertThatThrownBy(() -> build(null, Map.of("v1", KEY)))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("business.cursor.active-key");
    }

    @Test
    @DisplayName("keys 가 하나도 없으면 거절한다 — 활성 키가 가리킬 곳이 없다")
    void 키없음() {
        assertThatThrownBy(() -> build("v1", Map.of()))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("business.cursor.keys.v1");
    }

    @Test
    @DisplayName("키 값이 비면 거절한다")
    void 빈키() {
        assertThatThrownBy(() -> build("v1", Map.of("v1", "  ")))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("business.cursor.keys.v1 미설정");
    }

    @Test
    @DisplayName("치환되지 않은 ${...} 플레이스홀더도 거절한다 — 그 리터럴은 base64 가 아니지만 «값이 있는 것처럼» 보인다")
    void 치환되지않은플레이스홀더() {
        assertThatThrownBy(() -> build("v1", Map.of("v1", "${BUSINESS_CURSOR_KEY_V1}")))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("치환되지 않았다")
                .hasMessageContaining("BUSINESS_CURSOR_KEY_V1");
    }

    @Test
    @DisplayName("base64 가 아니면 거절한다 — 메시지에 키 원문을 싣지 않는다")
    void base64아님() {
        assertThatThrownBy(() -> build("v1", Map.of("v1", "not*base64*secret")))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("business.cursor.keys.v1")
                .hasMessageContaining("base64")
                .hasMessageNotContaining("not*base64*secret");
    }

    @Test
    @DisplayName("32바이트(256비트)보다 짧은 키는 거절한다")
    void 짧은키() {
        String shortKey = Base64.getEncoder().encodeToString(bytes(SignedCursorCodec.MIN_KEY_BYTES - 1));

        assertThatThrownBy(() -> build("v1", Map.of("v1", shortKey)))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("business.cursor.keys.v1")
                .hasMessageContaining("256비트");
    }

    @Test
    @DisplayName("active-key 만 v2 로 바꾸고 keys 에 v2 가 없으면 거절한다 — 회전 트랩")
    void 회전트랩() {
        assertThatThrownBy(() -> build("v2", Map.of("v1", KEY)))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("business.cursor.keys.v2");
    }
}
