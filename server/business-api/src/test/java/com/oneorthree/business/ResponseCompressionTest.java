package com.oneorthree.business;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.EnableAutoConfiguration;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.zip.GZIPInputStream;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(classes = ResponseCompressionTest.TestApplication.class,
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = "management.server.port=0")
class ResponseCompressionTest {

    private final HttpClient client = HttpClient.newHttpClient();

    @Value("${local.server.port}")
    private int port;

    @Test
    void compressesOnlyLargeJsonWhenClientAcceptsGzip() throws Exception {
        var small = get("/probe/json?length=2036", "gzip");
        assertThat(small.headers().firstValue("Content-Encoding")).isEmpty();
        assertThat(small.body()).hasSize(2047);

        var large = get("/probe/json?length=2037", "gzip");
        assertThat(large.headers().firstValue("Content-Encoding")).hasValue("gzip");
        assertThat(large.headers().firstValue("Vary")).hasValueSatisfying(
                value -> assertThat(value).containsIgnoringCase("Accept-Encoding"));
        var identity = get("/probe/json?length=2037", "identity");
        assertThat(identity.headers().firstValue("Content-Encoding")).isEmpty();
        assertThat(unzip(large.body())).isEqualTo(new String(identity.body(), StandardCharsets.UTF_8));
    }

    @Test
    void keepsLargeBinaryUncompressed() throws Exception {
        var response = get("/probe/image", "gzip");
        assertThat(response.headers().firstValue("Content-Encoding")).isEmpty();
        assertThat(response.body()).hasSize(4096);
    }

    private HttpResponse<byte[]> get(String path, String acceptEncoding) throws Exception {
        var request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path))
                .header("Accept-Encoding", acceptEncoding).build();
        return client.send(request, HttpResponse.BodyHandlers.ofByteArray());
    }

    private String unzip(byte[] bytes) throws IOException {
        try (var input = new GZIPInputStream(new ByteArrayInputStream(bytes))) {
            return new String(input.readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    @Configuration
    @EnableAutoConfiguration
    @Import(ProbeController.class)
    static class TestApplication {
    }

    @RestController
    static class ProbeController {
        @GetMapping(value = "/probe/json", produces = MediaType.APPLICATION_JSON_VALUE)
        Map<String, String> json(@RequestParam int length) {
            return Map.of("data", "x".repeat(length));
        }

        @GetMapping(value = "/probe/image", produces = MediaType.IMAGE_PNG_VALUE)
        ResponseEntity<byte[]> image() {
            return ResponseEntity.ok().contentType(MediaType.IMAGE_PNG).body(new byte[4096]);
        }
    }
}
