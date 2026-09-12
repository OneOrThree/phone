package com.oneorthree.phone.outbox.support;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.oneorthree.phone.outbox.dto.PublicCommandReceipt;
import com.oneorthree.phone.outbox.dto.PublicCommandRequest;
import com.oneorthree.phone.outbox.dto.PublicCommandResult;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class PublicCommandFingerprintTest {

    private static final ObjectMapper JSON = new ObjectMapper();

    @Test
    @DisplayName("객체 순서와 숫자 표기는 같게 취급하고 배열 순서·누락/null·문자열 공백은 구분한다")
    void canonicalizesOnlyEquivalentJsonMeaning() throws Exception {
        assertThat(fingerprint("{\"z\":1.0,\"nested\":{\"b\":2,\"a\":3}}"))
                .isEqualTo(fingerprint("{\"nested\":{\"a\":3.0,\"b\":2.0},\"z\":1}"));
        assertThat(fingerprint("{\"items\":[1,2]}"))
                .isNotEqualTo(fingerprint("{\"items\":[2,1]}"));
        assertThat(fingerprint("{}"))
                .isNotEqualTo(fingerprint("{\"value\":null}"));
        assertThat(fingerprint("{\"text\":\"hello \"}"))
                .isNotEqualTo(fingerprint("{\"text\":\"hello\"}"));
    }

    @Test
    @DisplayName("요청과 결과 JSON은 입력·반환 객체 변조로 지문이나 저장 결과가 바뀌지 않는다")
    void defensivelyCopiesMutableJsonTrees() {
        ObjectNode body = JSON.createObjectNode().put("expectedVersion", 1);
        PublicCommandRequest request = new PublicCommandRequest(UUID.randomUUID(), "POST /objects/1",
                UUID.randomUUID(), body);
        String fingerprint = request.fingerprint();
        body.put("expectedVersion", 2);
        ((ObjectNode) request.semanticRequest()).put("expectedVersion", 3);
        assertThat(request.fingerprint()).isEqualTo(fingerprint);
        ObjectNode data = JSON.createObjectNode().put("balance", 100);
        var events = JSON.createArrayNode();
        events.addObject().put("eventId", "original");
        PublicCommandResult result = new PublicCommandResult(201, data, events);
        PublicCommandReceipt receipt = PublicCommandReceipt.completed(request, result);
        data.put("balance", 0);
        events.removeAll();
        ((ObjectNode) result.data()).put("balance", 1);
        ((ObjectNode) receipt.data()).put("balance", 2);
        ((ObjectNode) receipt.events().get(0)).put("eventId", "changed");
        assertThat(receipt.data().get("balance").asInt()).isEqualTo(100);
        assertThat(receipt.events().get(0).get("eventId").asText()).isEqualTo("original");
    }

    @Test
    @DisplayName("공개 요청의 본문은 저장 위치에 영향을 주지 않고 범용 원문 키와 이름 공간을 분리한다")
    void separatesStorageScopeFromRequestFingerprint() {
        UUID user = UUID.randomUUID();
        UUID key = UUID.randomUUID();
        PublicCommandRequest first = new PublicCommandRequest(user, "PATCH /islands/1", key,
                JSON.createObjectNode().put("value", 1));
        PublicCommandRequest changed = new PublicCommandRequest(user, first.operation(), key,
                JSON.createObjectNode().put("value", 2));
        assertThat(first.storageRequest().key()).startsWith("public:v1:");
        assertThat(first.storageRequest().storageKey()).isEqualTo(changed.storageRequest().storageKey());
        assertThat(first.fingerprint()).isNotEqualTo(changed.fingerprint());
    }

    @Test
    @DisplayName("상태 오류·배열 아닌 이벤트·객체 아닌 의미 요청은 저장 전에 거절한다")
    void rejectsInvalidSuccessAndRequestShapes() {
        assertThatThrownBy(() -> new PublicCommandResult(409, JSON.nullNode(), JSON.createArrayNode()))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new PublicCommandResult(200, JSON.nullNode(), JSON.createObjectNode()))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new PublicCommandRequest(UUID.randomUUID(), "POST /objects",
                UUID.randomUUID(), JSON.createArrayNode())).isInstanceOf(IllegalArgumentException.class);
    }

    private static String fingerprint(String source) throws Exception {
        JsonNode body = JSON.readTree(source);
        return PublicCommandFingerprint.of("PATCH /resource/1", body);
    }
}
