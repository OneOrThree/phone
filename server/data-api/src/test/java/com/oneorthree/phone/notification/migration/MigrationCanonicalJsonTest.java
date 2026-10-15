package com.oneorthree.phone.notification.migration;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.util.AbstractMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 정규형 JSON — <b>체크섬이 맞는지가 이관 검증의 전부</b>라 이 직렬화의 모든 선택이 계약이다.
 *
 * <p>여기 적힌 기대값이 곧 알림 서버의 {@code Json.hash()} / {@code MigrationRecords.canonical()} 과
 * 맞춰야 할 값이다. 한쪽이 바뀌면 이 테스트가 먼저 깨져야 한다 — 운영에서 「체크섬 불일치」로 처음
 * 알게 되면 그때는 정지 창 한복판이고, 되돌릴 시간이 없다.
 */
class MigrationCanonicalJsonTest {

    /** 빈 바이트열의 SHA-256 — 빈 자원의 체크섬이다. */
    private static final String SHA256_EMPTY =
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

    @Test
    @DisplayName("키는 Java UTF-16 오름차순으로 정렬되고 공백이 없다 — 입력 순서와 무관해야 한다")
    void keysAreSortedAndCompact() {
        Map<String, Object> unordered = new LinkedHashMap<>();
        unordered.put("userId", "u");
        unordered.put("active", true);
        unordered.put("authGeneration", 3L);

        assertThat(MigrationCanonicalJson.canonical(unordered))
                .isEqualTo("{\"active\":true,\"authGeneration\":3,\"userId\":\"u\"}");
    }

    @Test
    @DisplayName("같은 내용이면 입력 순서가 달라도 같은 해시다 — 그러지 않으면 체크섬이 무의미하다")
    void hashIsOrderIndependent() {
        Map<String, Object> a = new LinkedHashMap<>();
        a.put("b", 1L);
        a.put("a", 2L);
        Map<String, Object> b = new LinkedHashMap<>();
        b.put("a", 2L);
        b.put("b", 1L);

        assertThat(MigrationCanonicalJson.hash(a)).isEqualTo(MigrationCanonicalJson.hash(b));
    }

    @Test
    @DisplayName("null 은 키를 유지한 채 null 로 쓴다 — 키를 빼면 「필드가 아직 없는 구 스키마」와 섞인다")
    void nullKeepsItsKey() {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("nightStartTime", null);
        data.put("userId", "u");

        assertThat(MigrationCanonicalJson.canonical(data))
                .isEqualTo("{\"nightStartTime\":null,\"userId\":\"u\"}");
    }

    @Test
    @DisplayName("비 ASCII 는 이스케이프하지 않고 UTF-8 원문으로 쓴다 — 한글 닉네임·그룹명이 체크섬을 가른다")
    void nonAsciiStaysRaw() {
        assertThat(MigrationCanonicalJson.canonical(Map.of("groupName", "같이숲")))
                .isEqualTo("{\"groupName\":\"같이숲\"}");
    }

    @Test
    @DisplayName("따옴표·역슬래시·개행은 짧은 이스케이프로 쓴다")
    void escapesQuotesAndNewline() {
        assertThat(MigrationCanonicalJson.canonical(Map.of("v", "a\"b\\c\nd")))
                .isEqualTo("{\"v\":\"a\\\"b\\\\c\\nd\"}");
    }

    @Test
    @DisplayName("짧은 이스케이프가 없는 제어문자는 Jackson과 같은 대문자 hex로 쓴다")
    void escapesOtherControlCharactersAsUppercaseHex() {
        String withControlChar = "a" + (char) 0x1F + "b";

        assertThat(MigrationCanonicalJson.canonical(Map.of("v", withControlChar)))
                .isEqualTo("{\"v\":\"a\\u001Fb\"}");
    }

    @Test
    @DisplayName("정수는 정수로 쓴다 — 1 과 1.0 이 섞이면 같은 값이 두 해시를 갖는다")
    void integersStayIntegers() {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("stake", 100);
        data.put("payout", 250L);

        assertThat(MigrationCanonicalJson.canonical(data))
                .isEqualTo("{\"payout\":250,\"stake\":100}");
    }

    @Test
    @DisplayName("부동소수는 거부한다 — 표기가 플랫폼마다 달라 체크섬이 갈린다")
    void floatingPointIsRejected() {
        assertThatThrownBy(() -> MigrationCanonicalJson.canonical(Map.of("v", 1.5d)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("부동소수");
    }

    @Test
    @DisplayName("중첩 객체도 같은 규칙으로 정렬된다 — params 가 중첩이라 여기서 갈리면 delivery 전량이 어긋난다")
    void nestedObjectsFollowTheSameRule() {
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("stake", 100L);
        params.put("kind", "BET_RESULT");
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("params", params);
        data.put("eventId", "noti:BET_RESULT:u:s:none");

        assertThat(MigrationCanonicalJson.canonical(data)).isEqualTo(
                "{\"eventId\":\"noti:BET_RESULT:u:s:none\","
                        + "\"params\":{\"kind\":\"BET_RESULT\",\"stake\":100}}");
    }

    @Test
    @DisplayName("자원 체크섬은 recordKey 오름차순으로 줄을 이어 붙인 결과다 — 입력 순서와 무관하다")
    void resourceChecksumIsOrderIndependent() {
        List<Map.Entry<String, String>> forward = List.of(
                new AbstractMap.SimpleEntry<>("a", "h1"),
                new AbstractMap.SimpleEntry<>("b", "h2"));
        List<Map.Entry<String, String>> reversed = List.of(
                new AbstractMap.SimpleEntry<>("b", "h2"),
                new AbstractMap.SimpleEntry<>("a", "h1"));

        String expected = MigrationCanonicalJson.sha256Hex(
                "settings:a=h1\nsettings:b=h2\n".getBytes(StandardCharsets.UTF_8));
        assertThat(MigrationCanonicalJson.resourceChecksum("settings", forward)).isEqualTo(expected);
        assertThat(MigrationCanonicalJson.resourceChecksum("settings", reversed)).isEqualTo(expected);
    }

    @Test
    @DisplayName("빈 자원도 체크섬을 갖는다 — 「행이 없다」와 「자원을 통째로 빠뜨렸다」를 구분한다")
    void emptyResourceHasAChecksum() {
        assertThat(MigrationCanonicalJson.resourceChecksum("device", List.of()))
                .isEqualTo(SHA256_EMPTY)
                .isEqualTo(MigrationCanonicalJson.emptyResourceChecksum());
    }

    @Test
    @DisplayName("보충 문자 키도 Noti TreeMap과 같은 UTF-16 순서를 따른다")
    void keysUseTheSameOrderAsNoti() {
        assertThat(MigrationCanonicalJson.canonical(Map.of("😀", 1, "Ａ", 2)))
                .isEqualTo("{\"😀\":1,\"Ａ\":2}");
    }
}
