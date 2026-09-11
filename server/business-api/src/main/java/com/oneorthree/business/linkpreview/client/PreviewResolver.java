package com.oneorthree.business.linkpreview.client;

import com.oneorthree.business.linkpreview.exception.PreviewException;
import com.oneorthree.business.linkpreview.support.DriveLink;
import com.oneorthree.business.linkpreview.support.PreviewContent;
import com.oneorthree.business.linkpreview.support.ThumbnailRenderer;
import java.io.IOException;
import java.net.URI;
import java.util.HashMap;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

@Component
public class PreviewResolver {

    private final PublicHttpClient http;
    private final ThumbnailRenderer renderer;
    private final ObjectMapper mapper;
    private final String driveApiKey;

    public PreviewResolver(PublicHttpClient http, ThumbnailRenderer renderer, ObjectMapper mapper,
            @Value("${business.drive-api-key:}") String driveApiKey) {
        this.http = http;
        this.renderer = renderer;
        this.mapper = mapper;
        this.driveApiKey = driveApiKey;
    }

    public PreviewContent resolve(URI uri) throws IOException, InterruptedException {
        var drive = DriveLink.from(uri);
        if (drive.isPresent()) {
            return drive(drive.get());
        }
        var resource = http.fetch(uri, Map.of(), false);
        String path = uri.getPath();
        String title = path == null || path.isEmpty() || path.endsWith("/")
                ? uri.getHost() : path.substring(path.lastIndexOf('/') + 1);
        String thumbnail = null;
        if (resource.body().length > 0) {
            try {
                thumbnail = "application/pdf".equals(resource.mimeType())
                        ? renderer.pdf(resource.body()) : renderer.image(resource.body());
            } catch (PreviewException | IOException e) {
                // 손상·미지원 렌더링도 원본 링크와 메타데이터 카드는 유지한다.
                thumbnail = null;
            }
        }
        return new PreviewContent(limit(title), resource.mimeType(), resource.sizeBytes(), "FILE", thumbnail);
    }

    private PreviewContent drive(DriveLink link) throws IOException {
        if (driveApiKey.isBlank()) {
            throw new PreviewException("DRIVE_NOT_CONFIGURED");
        }
        Map<String, String> headers = new HashMap<>();
        headers.put("X-Goog-Api-Key", driveApiKey);
        if (link.resourceKey() != null) {
            headers.put("X-Goog-Drive-Resource-Keys", link.fileId() + "/" + link.resourceKey());
        }
        URI metadata = URI.create("https://www.googleapis.com/drive/v3/files/" + link.fileId()
                + "?fields=name,mimeType,size,thumbnailLink,trashed&supportsAllDrives=true");
        var resource = http.fetch(metadata, headers, true);
        var node = mapper.readTree(resource.body());
        if (node.path("trashed").asBoolean(false) || !node.hasNonNull("name") || !node.hasNonNull("mimeType")) {
            throw new PreviewException("NOT_PUBLIC_OR_NOT_FOUND");
        }
        String thumbnail = null;
        if (node.hasNonNull("thumbnailLink")) {
            try {
                URI thumbnailUri = PublicAddressPolicy.parse(node.path("thumbnailLink").asText());
                thumbnail = renderer.image(http.fetch(thumbnailUri, Map.of(), false).body());
            } catch (PreviewException | IOException e) {
                // 썸네일 유효기간·미지원 형식은 파일 이름 카드를 망가뜨리지 않는다.
                thumbnail = null;
            }
        }
        Long size = node.hasNonNull("size") ? node.path("size").asLong() : null;
        return new PreviewContent(limit(node.path("name").asText()), node.path("mimeType").asText(),
                size, "GOOGLE_DRIVE", thumbnail);
    }

    private String limit(String value) {
        return value.substring(0, value.offsetByCodePoints(0, Math.min(value.codePointCount(0, value.length()), 300)));
    }
}
