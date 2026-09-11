package com.oneorthree.notification;

import com.ibm.icu.text.MessageFormat;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

@Component
class Renderer {

    private static final Set<String> LOCALES = Set.of("ko", "en", "ja", "zh-Hant");
    private final Store store;

    Renderer(Store store) {
        this.store = store;
    }

    RenderedPush renderBundle(List<Map<String, Object>> rows) {
        Map<String, Object> first = rows.get(0);
        String locale = (String) first.get("locale");
        if (rows.size() == 1) {
            return render(first.get("kind").toString(), locale, Json.map(first.get("payload").toString()));
        }
        long refunds = rows.stream().filter(row -> "BET_VOID_REFUND".equals(row.get("kind"))).count();
        long results = rows.size() - refunds;
        String kind = "CHALLENGE_SESSION_OPEN".equals(first.get("kind")) ? "CHALLENGE_SESSION_OPEN_BUNDLE"
                : refunds == 0 ? "BET_RESULT_BUNDLE" : results == 0 ? "BET_VOID_REFUND_BUNDLE" : "BET_MIXED_BUNDLE";
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("count", rows.size());
        params.put("resultCount", results);
        params.put("refundCount", refunds);
        params.put("groupId", first.get("group_id").toString());
        if (results == 0) {
            List<Object> reasons = rows.stream().map(row -> Json.map(row.get("payload").toString()).get("voidReason"))
                    .distinct().toList();
            if (reasons.size() == 1 && reasons.get(0) != null) {
                params.put("voidReason", reasons.get(0));
            }
        }
        return render(kind, locale, params);
    }

    RenderedPush render(String kind, String locale, Map<String, Object> params) {
        String language = LOCALES.contains(locale == null ? "" : locale) ? locale : "ko";
        Map<String, Object> template = store.one("SELECT t.*,k.silent FROM templates t JOIN kinds k ON k.id=t.kind"
                + " WHERE t.kind=? AND t.enabled AND t.locale IN (?, 'ko')"
                + " ORDER BY (t.locale=?) DESC LIMIT 1", kind, language, language);
        if (template == null) {
            throw new NotificationFailure(422, "TEMPLATE_UNAVAILABLE");
        }
        return renderTemplate(template, params);
    }

    RenderedPush renderTemplate(Map<String, Object> template, Map<String, Object> params) {
        params = renderArguments(params);
        String kind = template.get("kind").toString();
        String locale = template.get("locale").toString();
        Map<String, Object> deeplink = store.one("SELECT url_template,data_template::text FROM deeplinks WHERE id=?",
                kind);
        Map<String, String> data = new LinkedHashMap<>();
        if (deeplink != null) {
            for (Map.Entry<String, Object> entry : Json.map(deeplink.get("data_template")).entrySet()) {
                data.put(entry.getKey(), format(entry.getValue().toString(), locale, params));
            }
            if (deeplink.get("url_template") != null) {
                data.put("link", format(deeplink.get("url_template").toString(), locale, params));
            }
        }
        // 앱 라우팅 값은 등록부가 소유한다. 소스 사건의 도메인 식별자는 그대로 보존한다.
        for (String key : new String[]{"groupId", "challengeId", "sessionId", "voidReason"}) {
            if (params.get(key) != null && !("voidReason".equals(key) && "UNKNOWN".equals(params.get(key)))) {
                data.put(key, params.get(key).toString());
            }
        }
        return new RenderedPush(template.get("title") == null ? null
                : format(template.get("title").toString(), locale, params),
                format(template.get("body").toString(), locale, params), data,
                Boolean.TRUE.equals(template.get("silent")));
    }

    // 원본 사건은 그대로 저장한다. 문구 선택과 단위 계산만 렌더 시점에 파생한다.
    static Map<String, Object> renderArguments(Map<String, Object> source) {
        Map<String, Object> result = new LinkedHashMap<>(source);
        if (source.containsKey("betStatus")) {
            result.put("betOutcome", "FORFEITED".equals(source.get("betStatus")) ? "FORFEITED"
                    : Boolean.TRUE.equals(source.get("achieved")) ? "WON" : "LOST");
        }
        if (source.containsKey("voidReason") && source.get("voidReason") == null) {
            result.put("voidReason", "UNKNOWN");
        }
        if (source.get("shortfallSeconds") instanceof Number seconds) {
            long minutes = Math.max(1, (long) Math.ceil(seconds.doubleValue() / 60));
            result.put("shortfallMinutes", minutes);
            result.put("shortfallHours", minutes / 60);
            result.put("shortfallRemainder", minutes % 60);
        }
        return result;
    }

    static String format(String pattern, String locale, Map<String, Object> params) {
        MessageFormat format = new MessageFormat(pattern, Locale.forLanguageTag(locale));
        if (!params.keySet().containsAll(format.getArgumentNames())) {
            throw new NotificationFailure(422, "TEMPLATE_ARGUMENT_MISSING");
        }
        return format.format(params);
    }
}
