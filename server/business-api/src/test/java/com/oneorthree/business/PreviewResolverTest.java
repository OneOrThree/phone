package com.oneorthree.business;

import com.oneorthree.business.linkpreview.client.PreviewResolver;
import com.oneorthree.business.linkpreview.client.PublicHttpClient;
import com.oneorthree.business.linkpreview.exception.PreviewException;
import com.oneorthree.business.linkpreview.support.ThumbnailRenderer;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import tools.jackson.databind.json.JsonMapper;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class PreviewResolverTest {
    final PublicHttpClient http = mock(PublicHttpClient.class);
    final ThumbnailRenderer renderer = mock(ThumbnailRenderer.class);
    final PreviewResolver resolver = new PreviewResolver(http, renderer, JsonMapper.builder().build(), "test-key");

    @Test
    void driveWithoutThumbnailStillReturnsMetadataAndPreservesResourceKey() throws Exception {
        when(http.fetch(any(), anyMap(), eq(true))).thenReturn(new PublicHttpClient.Resource("application/json", null,
                "{\"name\":\"강의 자료\",\"mimeType\":\"application/pdf\",\"size\":\"123\"}".getBytes(StandardCharsets.UTF_8)));
        var result = resolver.resolve(URI.create("https://drive.google.com/file/d/abc/view?resourcekey=r-key"));
        assertThat(result.title()).isEqualTo("강의 자료");
        assertThat(result.sizeBytes()).isEqualTo(123L);
        assertThat(result.thumbnailBase64()).isNull();
        verify(http).fetch(argThat(uri -> "www.googleapis.com".equals(uri.getHost()) && !uri.toString().contains("test-key")),
                eq(Map.of("X-Goog-Api-Key", "test-key", "X-Goog-Drive-Resource-Keys", "abc/r-key")), eq(true));
        verifyNoInteractions(renderer);
    }

    @Test
    void inaccessibleDriveDoesNotCrawlLoginPage() throws Exception {
        when(http.fetch(any(), anyMap(), eq(true))).thenThrow(new PreviewException("NOT_PUBLIC_OR_NOT_FOUND"));
        assertThatThrownBy(() -> resolver.resolve(URI.create("https://drive.google.com/file/d/private/view")))
                .isInstanceOf(PreviewException.class).hasMessage("NOT_PUBLIC_OR_NOT_FOUND");
        verify(http, times(1)).fetch(any(), anyMap(), anyBoolean());
    }

    @Test
    void missingKeyFailsOnlyDriveWhileGenericFileKeepsMetadata() throws Exception {
        var withoutKey = new PreviewResolver(http, renderer, JsonMapper.builder().build(), "");
        assertThatThrownBy(() -> withoutKey.resolve(URI.create("https://drive.google.com/file/d/a/view")))
                .hasMessage("DRIVE_NOT_CONFIGURED");
        when(http.fetch(any(), anyMap(), eq(false))).thenReturn(new PublicHttpClient.Resource("application/zip", 999L, new byte[0]));
        var file = withoutKey.resolve(URI.create("https://example.com/a.zip"));
        assertThat(file.title()).isEqualTo("a.zip");
        assertThat(file.thumbnailBase64()).isNull();
    }

    @ParameterizedTest
    @ValueSource(strings = {"https://example.com", "https://example.com?x=1", "https://example.com/"})
    void usesHostForLinksWithoutFileName(String url) throws Exception {
        when(http.fetch(any(), anyMap(), eq(false)))
                .thenReturn(new PublicHttpClient.Resource("text/html", null, new byte[0]));
        assertThat(resolver.resolve(URI.create(url)).title()).isEqualTo("example.com");
    }

    @Test
    void truncatesFileAndDriveTitlesAtCodePointBoundary() throws Exception {
        String title = "a".repeat(299) + "😀" + "extra";
        when(http.fetch(any(), anyMap(), eq(false)))
                .thenReturn(new PublicHttpClient.Resource("application/zip", null, new byte[0]));
        when(http.fetch(any(), anyMap(), eq(true)))
                .thenReturn(new PublicHttpClient.Resource("application/json", null,
                        ("{\"name\":\"" + title + "\",\"mimeType\":\"application/pdf\"}").getBytes(StandardCharsets.UTF_8)));
        assertThat(resolver.resolve(URI.create("https://example.com/" + title)).title())
                .isEqualTo("a".repeat(299) + "😀");
        assertThat(resolver.resolve(URI.create("https://docs.google.com/document/d/abc/edit")).title())
                .isEqualTo("a".repeat(299) + "😀");
    }

    @Test
    void brokenPdfFallsBackToFileCard() throws Exception {
        when(http.fetch(any(), anyMap(), eq(false))).thenReturn(new PublicHttpClient.Resource("application/pdf", 10L, new byte[]{1}));
        when(renderer.pdf(any())).thenThrow(new PreviewException("RENDER_TIMEOUT"));
        var result = resolver.resolve(URI.create("https://example.com/a.pdf"));
        assertThat(result.title()).isEqualTo("a.pdf");
        assertThat(result.thumbnailBase64()).isNull();
    }
}
