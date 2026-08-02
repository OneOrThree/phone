package com.oneorthree.phone.character.client;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

import java.time.Duration;
import java.util.List;
import java.util.Map;

/**
 * OpenAI omni-moderation 호출 클라이언트 (누끼 유해 이미지 검사, T9).
 *
 * <p>선례(auth/notification 의 RestClient 직조립)를 따라 생성자에서 RestClient 를 조립한다.
 * 발송: {@code POST https://api.openai.com/v1/moderations}, {@code Authorization: Bearer <key>}.
 * omni-moderation 은 무료 호출이다.</p>
 *
 * <p>200 응답이면 파싱한 결과를 반환하고, 그 외 모든 경우(키 미설정·네트워크·타임아웃·5xx·
 * 응답 파싱 실패)는 예외를 던진다 — 최종 fail-closed 차단 판단은 호출측(서비스)이 한다.</p>
 */
@Slf4j
@Component
public class OpenAiModerationClient {

    private static final String MODERATION_URL = "https://api.openai.com/v1/moderations";
    private static final String MODEL = "omni-moderation-latest";
    private static final Duration CONNECT_TIMEOUT = Duration.ofSeconds(3);
    private static final Duration READ_TIMEOUT = Duration.ofSeconds(10);

    private final RestClient restClient;
    private final String apiKey;

    public OpenAiModerationClient(
            // 프로퍼티 키는 env 자동 변환(OPENAI_API_KEY)과 일치해야 함 — base application.yml 이
            // gitignore 라 배포 이미지에 없어도 env 만으로 해석되도록(FCM 선례). 기본값 : 은 미설정 시
            // 기동을 막지 않기 위함이며, 미설정 상태의 실제 차단은 moderate() 에서 fail-closed 로 처리한다.
            @Value("${openai.api-key:}") String apiKey) {
        this.apiKey = apiKey;
        // 타임아웃 미설정 시 무한 대기 위험 — 연결 3s / 응답 10s 로 상한을 둔다.
        SimpleClientHttpRequestFactory requestFactory = new SimpleClientHttpRequestFactory();
        requestFactory.setConnectTimeout(CONNECT_TIMEOUT);
        requestFactory.setReadTimeout(READ_TIMEOUT);
        this.restClient = RestClient.builder()
                .requestFactory(requestFactory)
                .build();
    }

    /**
     * base64 PNG 를 OpenAI omni-moderation 으로 검사한다.
     *
     * @param base64Png data URI 프리픽스 없는 순수 base64 PNG
     * @return 유해 여부(flagged)와 true 로 판정된 카테고리 목록
     * @throws RuntimeException 키 미설정·HTTP 오류·타임아웃·응답 파싱 실패 등 검사 불가 상황
     */
    public OpenAiModerationResult moderate(String base64Png) {
        if (apiKey == null || apiKey.isBlank()) {
            throw new IllegalStateException("OPENAI_API_KEY 미설정 — 이미지 모더레이션을 수행할 수 없습니다.");
        }

        String dataUri = "data:image/png;base64," + base64Png;
        // .retrieve() 는 4xx/5xx 에서 RestClientResponseException, 네트워크/타임아웃에서 예외를 던진다 —
        // 모두 호출측으로 전파해 fail-closed 로 이어진다.
        OpenAiModerationResponse response = restClient.post()
                .uri(MODERATION_URL)
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + apiKey)
                .contentType(MediaType.APPLICATION_JSON)
                .body(buildRequestBody(dataUri))
                .retrieve()
                .body(OpenAiModerationResponse.class);

        if (response == null || response.results() == null || response.results().isEmpty()) {
            throw new IllegalStateException("OpenAI 모더레이션 응답이 비어 있습니다.");
        }

        Result result = response.results().get(0);
        // flagged 누락(null)은 판정 불명 — fail-closed 정책상 통과시키지 않고 예외로 차단한다.
        if (result.flagged() == null) {
            throw new IllegalStateException("OpenAI 모더레이션 응답에 flagged 판정이 없습니다.");
        }
        return new OpenAiModerationResult(result.flagged(), extractFlaggedCategories(result.categories()));
    }

    /**
     * 요청 본문 조립.
     * {@code { "model": "...", "input": [ { "type": "image_url", "image_url": { "url": "data:..." } } ] } }
     */
    private Map<String, Object> buildRequestBody(String dataUri) {
        Map<String, Object> imageUrl = Map.of("url", dataUri);
        Map<String, Object> inputItem = Map.of("type", "image_url", "image_url", imageUrl);
        return Map.of("model", MODEL, "input", List.of(inputItem));
    }

    /** categories 맵에서 true 인 카테고리 키만 모은다(sexual·sexual/minors·violence·self-harm 계열 등). */
    private List<String> extractFlaggedCategories(Map<String, Boolean> categories) {
        if (categories == null) {
            return List.of();
        }
        return categories.entrySet().stream()
                .filter(entry -> Boolean.TRUE.equals(entry.getValue()))
                .map(Map.Entry::getKey)
                .toList();
    }

    /** 클라이언트 내부 결과 표현 — 서비스가 응답 DTO 로 변환한다. */
    public record OpenAiModerationResult(boolean flagged, List<String> flaggedCategories) {
    }

    /** OpenAI /v1/moderations 응답 중 필요한 필드만 매핑(나머지 category_scores 등은 무시). */
    record OpenAiModerationResponse(List<Result> results) {
    }

    /** results[0] — flagged 와 카테고리별 boolean 맵. flagged 는 누락 판별을 위해 nullable 로 둔다. */
    record Result(Boolean flagged, Map<String, Boolean> categories) {
    }
}
