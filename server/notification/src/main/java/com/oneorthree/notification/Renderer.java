package com.oneorthree.notification;

import com.ibm.icu.text.MessageFormat;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
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
        for (String key : new String[]{"groupId"}) {
            if (params.get(key) != null) {
                data.put(key, params.get(key).toString());
            }
        }
        return new RenderedPush(template.get("title") == null ? null
                : format(template.get("title").toString(), locale, params),
                format(template.get("body").toString(), locale, params), data,
                Boolean.TRUE.equals(template.get("silent")));
    }

    static String format(String pattern, String locale, Map<String, Object> params) {
        MessageFormat format = new MessageFormat(pattern, Locale.forLanguageTag(locale));
        if (!params.keySet().containsAll(format.getArgumentNames())) {
            throw new NotificationFailure(422, "TEMPLATE_ARGUMENT_MISSING");
        }
        return format.format(params);
    }
}
