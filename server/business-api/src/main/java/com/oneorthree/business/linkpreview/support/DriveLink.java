package com.oneorthree.business.linkpreview.support;

import com.oneorthree.business.linkpreview.exception.PreviewException;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.regex.Pattern;

public record DriveLink(String fileId, String resourceKey) {

    private static final Pattern PATH = Pattern.compile(
            "^/(?:file|document|spreadsheets|presentation)/d/([A-Za-z0-9_-]+)(?:/.*)?$");
    private static final Set<String> HOSTS = Set.of("drive.google.com", "docs.google.com");

    public static Optional<DriveLink> from(URI uri) {
        if (!HOSTS.contains(uri.getHost().toLowerCase(Locale.ROOT))) {
            return Optional.empty();
        }
        Map<String, String> query = new HashMap<>();
        if (uri.getRawQuery() != null) {
            for (String item : uri.getRawQuery().split("&")) {
                String[] pair = item.split("=", 2);
                if (pair.length == 2) {
                    query.put(pair[0], URLDecoder.decode(pair[1], StandardCharsets.UTF_8));
                }
            }
        }
        var matcher = PATH.matcher(uri.getPath());
        String id = matcher.matches() ? matcher.group(1) : null;
        if (id == null && Set.of("/open", "/uc").contains(uri.getPath())) {
            id = query.get("id");
        }
        String key = query.get("resourcekey");
        if (id == null || !id.matches("[A-Za-z0-9_-]{1,200}")
                || (key != null && !key.matches("[A-Za-z0-9_-]{1,200}"))) {
            throw new PreviewException("UNSUPPORTED_DRIVE_LINK");
        }
        return Optional.of(new DriveLink(id, key));
    }
}
