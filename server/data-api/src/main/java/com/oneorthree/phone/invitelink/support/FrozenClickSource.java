package com.oneorthree.phone.invitelink.support;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 클릭 이관 <b>정지 원본</b>의 조립과 체크섬 (서비스 §7.2 · A22 ㋮).
 *
 * <h2>이 클래스가 링크 서버와 맞춰야 하는 것 셋</h2>
 * <ol>
 *   <li><b>필드 26개와 그 정규화</b> — {@code link/src/lib/migration.ts} 의 {@code frozen()} 이
 *       기준이다. 세대 셋({@code linkVersion}·{@code membershipEpoch}·{@code transitionSeq})은
 *       <b>문자열</b>이고, 시각은 {@code new Date(x).toISOString()} 즉 <b>밀리초 3자리 + {@code Z}</b> 다.
 *       마이크로초를 그대로 보내면 받는 쪽이 ms 로 깎아 다시 체크섬을 계산하므로 전량 불일치가 된다.</li>
 *   <li><b>키 순서</b> — 링크의 {@code canonical()} 은 {@code Object.entries(...).sort(localeCompare)}
 *       다. 그 순서는 <b>코드포인트 정렬과 다르다</b>: {@code clickedAt} 이 {@code clickId} 보다
 *       앞선다(기저 문자 {@code e} &lt; {@code i}). 그래서 여기서는 정렬하지 않고 <b>확정된 순서로
 *       조립</b>한다 — 런타임 collator 에 맡기면 JDK·ICU 버전에 따라 조용히 달라진다.</li>
 *   <li><b>체크섬</b> — {@code SHA-256(canonicalJson)} 의 hex. 값은 문자열·불리언·{@code null} 뿐이라
 *       canonical 은 {@code JSON.stringify} 와 같은 모양이 된다.</li>
 * </ol>
 *
 * <p>이 셋 중 하나라도 어긋나면 <b>이관 당일에</b> 전량 {@code SOURCE_CHECKSUM_MISMATCH} 로 막힌다.
 * 그래서 조립과 체크섬을 한 자리에 두고, 저장된 원본 자체를 체크섬의 입력으로 삼는다.
 */
public final class FrozenClickSource {

    /**
     * 링크의 {@code canonical()} 이 만드는 키 순서 — {@code localeCompare} 정렬 결과를 <b>고정</b>한 것.
     *
     * <p>런타임 정렬을 쓰지 않는 이유는 위 javadoc 의 ②다. 이 배열이 곧 계약이므로 필드를 더할 때는
     * 링크 쪽 {@code FrozenClick} 과 함께 바꾸고 같은 정렬로 자리를 다시 잡아야 한다.
     */
    private static final String[] CANONICAL_KEYS = {
        "appInstanceId", "claimedAt", "claimedUserId", "clickedAt", "clickId", "groupClosed",
        "groupId", "groupName", "groupNameVersion", "inviterId", "inviterName", "inviterNameVersion",
        "ipHash", "linkCreatedAt", "linkId",
        "linkStatus", "linkVersion", "matched", "matchedAt", "matchedDeviceId", "membershipEpoch",
        "os", "revokedAt", "slug", "transitionSeq", "userAgent",
    };

    /**
     * 링크 원장 한 건({@code FrozenLink}) 의 정본 키 순서 — 클릭 26필드의 <b>부분집합 15개</b>를
     * 같은 {@code localeCompare} 정렬로 다시 세운 것이다.
     *
     * <p>클릭 순서에서 잘라 쓰면 안 된다 — 정렬은 «그 집합 안에서» 이뤄지므로 부분집합의 순서가
     * 전체의 부분 순서와 같다는 보장이 없다(실제로 여기서는 같지만, 필드가 늘면 갈린다).
     */
    private static final String[] CANONICAL_LINK_KEYS = {
        "groupClosed", "groupId", "groupName", "groupNameVersion", "inviterId", "inviterName",
        "inviterNameVersion", "linkCreatedAt", "linkId",
        "linkStatus", "linkVersion", "membershipEpoch", "revokedAt", "slug", "transitionSeq",
    };

    /** {@code new Date(x).toISOString()} 와 같은 모양 — 밀리초 3자리 고정 + {@code Z}. */
    private static final DateTimeFormatter ISO_MILLIS =
            DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC);

    private FrozenClickSource() {
    }

    /**
     * 정지 원본 하나를 <b>정본 키 순서로</b> 조립한다.
     *
     * @param values 키 → 값. {@link #CANONICAL_KEYS} 에 없는 키가 있으면 계약이 어긋난 것이라 즉시 실패한다
     * @return 정본 순서의 불변 맵
     */
    public static Map<String, Object> canonicalize(Map<String, Object> values) {
        return order(values, CANONICAL_KEYS);
    }

    private static Map<String, Object> order(Map<String, Object> values, String[] keys) {
        Map<String, Object> ordered = new LinkedHashMap<>();
        for (String key : keys) {
            if (!values.containsKey(key)) {
                throw new IllegalArgumentException("정지 원본에 필드가 빠졌습니다: " + key);
            }
            ordered.put(key, values.get(key));
        }
        if (values.size() != keys.length) {
            // 모르는 키를 조용히 버리면 체크섬은 통과하는데 링크 쪽 frozen() 이 그 값을 요구하는
            // 상황이 생긴다 — 어긋남을 조립 시점에 드러낸다.
            throw new IllegalArgumentException(
                    "정지 원본에 계약 밖 필드가 있습니다 — 기대 " + keys.length + ", 실제 " + values.size());
        }
        return java.util.Collections.unmodifiableMap(ordered);
    }

    /**
     * 링크 원장 한 건을 <b>정본 키 순서로</b> 조립한다 (A22 ㊏).
     *
     * @param values 키 → 값
     * @return 정본 순서의 불변 맵
     */
    public static Map<String, Object> canonicalizeLink(Map<String, Object> values) {
        return order(values, CANONICAL_LINK_KEYS);
    }

    /**
     * manifest 체크섬 — 링크 서버의 최종 검증이 대조하는 값이다.
     *
     * <p>{@code [{"<idField>":"...","sourceChecksum":"..."}]} 의 canonical JSON 을 SHA-256 한다.
     * <b>순서가 계약</b>이고 그 순서는 DB 의 uuid 오름차순이므로, 목록을 여기서 다시 정렬하지 않는다 —
     * {@code UUID.compareTo} 는 부호 있는 long 비교라 상위 비트가 선 uuid 에서 DB 와 갈린다.
     *
     * @param idField {@code clickId} 또는 {@code linkId}
     * @param entries DB 순서 그대로의 {@code (id, checksum)} 쌍
     * @return 64자 hex
     */
    public static String manifestChecksum(String idField, List<ManifestPair> entries) {
        StringBuilder json = new StringBuilder("[");
        for (int i = 0; i < entries.size(); i++) {
            if (i > 0) {
                json.append(',');
            }
            Map<String, Object> entry = new LinkedHashMap<>();
            entry.put(idField, entries.get(i).id());
            entry.put("sourceChecksum", entries.get(i).checksum());
            // 두 키 모두 localeCompare 정렬에서 idField < sourceChecksum 이다(c·l < s).
            json.append(canonicalJson(entry));
        }
        return sha256Hex(json.append(']').toString());
    }

    /**
     * manifest 한 쌍.
     *
     * @param id       클릭 또는 링크의 id 문자열
     * @param checksum 그 행의 원본 체크섬
     */
    public record ManifestPair(String id, String checksum) {
    }

    /**
     * 시각을 링크 쪽 정규화와 <b>같은 모양</b>으로 만든다.
     *
     * @param value 시각. {@code null} 이면 그대로 {@code null}
     * @return {@code 2026-09-11T01:02:03.123Z} 형태. 마이크로초는 <b>버린다</b> — 받는 쪽
     *     {@code new Date()} 가 어차피 ms 로 깎으므로, 남겨 두면 체크섬이 전량 어긋난다
     */
    public static String timestamp(Instant value) {
        return value == null ? null : ISO_MILLIS.format(value);
    }

    /**
     * 링크의 {@code checksum()} 과 같은 값 — {@code SHA-256(canonicalJson)} 의 hex.
     *
     * @param source {@link #canonicalize} 가 만든 맵
     * @return 64자 hex
     */
    public static String checksum(Map<String, Object> source) {
        return sha256Hex(canonicalJson(source));
    }

    private static String sha256Hex(String value) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 미지원", e);
        }
    }

    /**
     * 링크의 {@code canonical()} 과 같은 문자열.
     *
     * <p>값이 문자열·불리언·{@code null} 뿐이라 {@code JSON.stringify} 와 같은 결과가 된다. 숫자를
     * 넣으면 JS 의 숫자 표기와 어긋날 수 있어 <b>받지 않는다</b> — 세대 셋이 문자열인 이유이기도 하다.
     *
     * @param source 정본 순서의 맵
     * @return canonical JSON
     */
    static String canonicalJson(Map<String, Object> source) {
        StringBuilder json = new StringBuilder("{");
        boolean first = true;
        for (Map.Entry<String, Object> entry : source.entrySet()) {
            if (!first) {
                json.append(',');
            }
            first = false;
            json.append(quote(entry.getKey())).append(':').append(literal(entry.getValue()));
        }
        return json.append('}').toString();
    }

    private static String literal(Object value) {
        if (value == null) {
            return "null";
        }
        if (value instanceof Boolean bool) {
            return bool.toString();
        }
        if (value instanceof String text) {
            return quote(text);
        }
        throw new IllegalArgumentException(
                "정지 원본은 문자열·불리언·null 만 담는다 — " + value.getClass().getName());
    }

    /** {@code JSON.stringify} 의 문자열 이스케이프와 같은 규칙. */
    private static String quote(String text) {
        StringBuilder quoted = new StringBuilder("\"");
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            switch (c) {
                case '"' -> quoted.append("\\\"");
                case '\\' -> quoted.append("\\\\");
                case '\b' -> quoted.append("\\b");
                case '\f' -> quoted.append("\\f");
                case '\n' -> quoted.append("\\n");
                case '\r' -> quoted.append("\\r");
                case '\t' -> quoted.append("\\t");
                default -> {
                    if (c < 0x20) {
                        quoted.append(String.format("\\u%04x", (int) c));
                    } else {
                        quoted.append(c);
                    }
                }
            }
        }
        return quoted.append('"').toString();
    }
}
