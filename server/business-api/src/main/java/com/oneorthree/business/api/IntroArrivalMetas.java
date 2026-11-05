package com.oneorthree.business.api;

import com.oneorthree.business.upstream.data.dto.IntroArrivalCommand;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

/**
 * 첫 항해 체험 도착 본문의 {@code meta} 검증 (GROMO-2741). 실패해도 도착을 막지 않는다 — 틀리면 meta 만 버리고
 * 로그 한 줄만 남긴다(값은 남기지 않는다).
 */
final class IntroArrivalMetas {

    private static final JsonMapper JSON = JsonMapper.builder().build();
    private static final Pattern ANON_ID = Pattern.compile("[\\x21-\\x7E]{1,128}");

    private IntroArrivalMetas() {
    }

    /** @return 검증을 통과한 명령. 본문이 없거나 틀리면 null */
    static IntroArrivalCommand parse(String body, String clientIp) {
        if (body == null || body.isBlank()) {
            return null;
        }
        try {
            JsonNode meta = JSON.readTree(body).path("meta");
            if (!meta.isObject()) {
                return null;
            }
            JsonNode anon = meta.path("anonId");
            JsonNode tracking = meta.path("advertiserTrackingEnabled");
            JsonNode ext = meta.path("extinfo");
            if (!anon.isString() || !ANON_ID.matcher(anon.asString()).matches() || !tracking.isBoolean()
                    || !ext.isArray() || ext.size() != 16) {
                return rejected();
            }
            List<String> extinfo = new ArrayList<>(16);
            for (JsonNode item : ext) {
                // 제어 문자(특히 NUL)는 Data 의 jsonb 저장에서 실패해 도착까지 되돌리므로 버린다.
                if (!item.isString() || item.asString().length() > 128
                        || item.asString().chars().anyMatch(c -> c < 0x20)) {
                    return rejected();
                }
                extinfo.add(item.asString());
            }
            if (!("i2".equals(extinfo.get(0)) || "a2".equals(extinfo.get(0))) || extinfo.get(4).isBlank()) {
                return rejected();
            }
            return new IntroArrivalCommand(
                    new IntroArrivalCommand.Meta(anon.asString(), tracking.asBoolean(), extinfo), clientIp);
        } catch (RuntimeException e) {
            return rejected();
        }
    }

    private static IntroArrivalCommand rejected() {
        org.slf4j.LoggerFactory.getLogger(IntroArrivalMetas.class).info("첫 항해 도착 meta 형식 오류 — meta 를 버린다");
        return null;
    }
}
