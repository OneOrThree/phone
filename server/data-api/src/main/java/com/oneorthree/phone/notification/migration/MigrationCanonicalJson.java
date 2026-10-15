package com.oneorthree.phone.notification.migration;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;

/**
 * 이관 레코드의 <b>정규형 JSON</b>과 그 SHA-256 — 두 서비스가 같은 바이트를 봐야 체크섬이 맞는다.
 *
 * <h2>정규형의 세 규칙</h2>
 * <ol>
 *   <li><b>키는 Java UTF-16 오름차순</b>. {@code String.compareTo} 는 UTF-16 단위 비교라 보충 문자에서
 *       코드포인트 순서와 갈린다. Noti Json.hash의 TreeMap과 같은 String.compareTo를 사용한다.</li>
 *   <li><b>공백 없음</b>. 구분자는 {@code ,} 와 {@code :} 뿐이다.</li>
 *   <li><b>UTF-8 바이트</b>. 비 ASCII 는 {@code \\u} 로 이스케이프하지 않고 그대로 쓴다 — 닉네임·
 *       그룹명이 한글이라 이 선택이 체크섬을 가른다. 제어문자(U+0000~U+001F)만 이스케이프한다.</li>
 * </ol>
 *
 * <h2>왜 Jackson 을 쓰지 않는가</h2>
 * 체크섬이 맞는지가 이관 검증의 전부인데, 라이브러리의 기본 직렬화는 버전에 따라 숫자 표기·
 * 이스케이프 정책이 바뀔 수 있다. 여기서 하는 일은 몇 십 줄이고, 그 몇 십 줄이 <b>계약 그 자체</b>다.
 */
public final class MigrationCanonicalJson {

    private MigrationCanonicalJson() {
    }

    /**
     * 값 하나를 정규형 JSON 문자열로 만든다.
     *
     * @param value 맵·리스트·문자열·수·불리언·{@code null}
     * @return 공백 없는 정규형 JSON
     */
    public static String canonical(Object value) {
        StringBuilder out = new StringBuilder();
        write(value, out);
        return out.toString();
    }

    /**
     * 정규형 JSON 의 SHA-256 hex.
     *
     * @param value 직렬화할 값
     * @return 소문자 hex 64자
     */
    public static String hash(Object value) {
        return sha256Hex(canonical(value).getBytes(StandardCharsets.UTF_8));
    }

    /**
     * 바이트열의 SHA-256 hex — 자원 체크섬이 이어 붙인 문자열에 이것을 쓴다.
     *
     * @param bytes 원본 바이트
     * @return 소문자 hex 64자
     */
    public static String sha256Hex(byte[] bytes) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(bytes);
            StringBuilder hex = new StringBuilder(digest.length * 2);
            for (byte b : digest) {
                hex.append(Character.forDigit((b >> 4) & 0xF, 16));
                hex.append(Character.forDigit(b & 0xF, 16));
            }
            return hex.toString();
        } catch (NoSuchAlgorithmException e) {
            // SHA-256 은 모든 JRE 가 반드시 제공한다. 여기 오면 런타임이 깨진 것이다.
            throw new IllegalStateException("SHA-256 을 쓸 수 없습니다.", e);
        }
    }

    /** 빈 자원의 체크섬 — 「행이 없다」도 검증 대상이다(빼면 «자원 자체를 빠뜨린 것»과 구분되지 않는다). */
    public static String emptyResourceChecksum() {
        return sha256Hex(new byte[0]);
    }

    /**
     * 자원 체크섬 — {@code "<resource>:<recordKey>=<recordChecksum>\n"} 을 <b>recordKey 오름차순</b>으로
     * 이어 붙인 문자열의 SHA-256.
     *
     * @param resource 자원 이름
     * @param entries  {@code recordKey → recordChecksum}
     * @return 소문자 hex 64자. 비었으면 {@link #emptyResourceChecksum()}
     */
    public static String resourceChecksum(String resource, List<Map.Entry<String, String>> entries) {
        if (entries.isEmpty()) {
            return emptyResourceChecksum();
        }
        List<Map.Entry<String, String>> sorted = new ArrayList<>(entries);
        sorted.sort(Comparator.comparing(Map.Entry::getKey, String::compareTo));
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        for (Map.Entry<String, String> entry : sorted) {
            byte[] line = (resource + ":" + entry.getKey() + "=" + entry.getValue() + "\n")
                    .getBytes(StandardCharsets.UTF_8);
            buffer.write(line, 0, line.length);
        }
        return sha256Hex(buffer.toByteArray());
    }

    private static void write(Object value, StringBuilder out) {
        if (value == null) {
            out.append("null");
        } else if (value instanceof Map<?, ?> map) {
            writeObject(map, out);
        } else if (value instanceof Iterable<?> list) {
            writeArray(list, out);
        } else if (value instanceof Boolean bool) {
            out.append(bool.booleanValue());
        } else if (value instanceof Number number) {
            writeNumber(number, out);
        } else {
            writeString(String.valueOf(value), out);
        }
    }

    private static void writeObject(Map<?, ?> map, StringBuilder out) {
        List<String> keys = new ArrayList<>(map.size());
        map.keySet().forEach(key -> keys.add(String.valueOf(key)));
        keys.sort(String::compareTo);
        out.append('{');
        boolean first = true;
        for (String key : keys) {
            if (!first) {
                out.append(',');
            }
            first = false;
            writeString(key, out);
            out.append(':');
            write(map.get(key), out);
        }
        out.append('}');
    }

    private static void writeArray(Iterable<?> list, StringBuilder out) {
        out.append('[');
        boolean first = true;
        for (Object item : list) {
            if (!first) {
                out.append(',');
            }
            first = false;
            write(item, out);
        }
        out.append(']');
    }

    /**
     * 수 — 정수는 정수로 쓴다.
     *
     * <p>{@code Integer} 를 {@code 1.0} 으로 쓰면 같은 값이 두 표기를 갖게 되어 체크섬이 갈린다.
     * 부동소수는 애초에 싣지 않는다(코인·초·버전은 전부 정수다) — 들어오면 표기가 플랫폼마다
     * 달라지므로 그 자체가 계약 위반이라 여기서 막는다.
     */
    private static void writeNumber(Number number, StringBuilder out) {
        if (number instanceof Double || number instanceof Float) {
            throw new IllegalArgumentException(
                    "이관 레코드에 부동소수를 실을 수 없습니다 — 표기가 플랫폼마다 달라 체크섬이 갈립니다: " + number);
        }
        out.append(number.longValue());
    }

    private static void writeString(String value, StringBuilder out) {
        out.append('"');
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            switch (c) {
                case '"' -> out.append("\\\"");
                case '\\' -> out.append("\\\\");
                case '\b' -> out.append("\\b");
                case '\f' -> out.append("\\f");
                case '\n' -> out.append("\\n");
                case '\r' -> out.append("\\r");
                case '\t' -> out.append("\\t");
                default -> {
                    if (c < 0x20) {
                        out.append(String.format("\\u%04X", (int) c));
                    } else {
                        // 비 ASCII 는 그대로 — UTF-8 바이트가 정규형이다.
                        out.append(c);
                    }
                }
            }
        }
        out.append('"');
    }
}
