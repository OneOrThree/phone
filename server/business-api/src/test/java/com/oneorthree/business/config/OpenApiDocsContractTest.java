package com.oneorthree.business.config;

import com.jayway.jsonpath.JsonPath;
import com.oneorthree.business.support.UpstreamTestBase;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * OpenAPI 문서 엔드포인트의 노출 경계 (GROMO-2069).
 *
 * <p>{@code /v0/api-docs/public} 만 AccessTokenFilter 가 열어 둔다 — CI 가 이 경로로
 * business-api.openapi.json 을 만든다. 기본 그룹 {@code /v0/api-docs} 는 열지 않는다.
 * 실제 필터 체인으로 검증하려고 {@link UpstreamTestBase} 를 쓴다(필터를 스텁으로 갈아 끼우면
 * 검증 대상이 빠진다 — AccessTokenBoundaryTest 와 같은 이유).
 */
@DisplayName("OpenAPI 문서 노출 경계")
class OpenApiDocsContractTest extends UpstreamTestBase {

    @Test
    @DisplayName("public 그룹 스펙은 무인증으로 열리고, 공개 경로만 담는다")
    void publicSpecIsOpenAndContainsOnlyPublicPaths() throws Exception {
        String body = mockMvc.perform(get("/v0/api-docs/public"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        Map<String, Object> paths = JsonPath.read(body, "$.paths");
        assertThat(paths).isNotEmpty();
        assertThat(paths.keySet())
                .as("공개 스펙에 내부·운영 경로가 샜다")
                .allMatch(p -> !p.startsWith("/internal")
                        && !p.startsWith("/actuator") && !p.equals("/health"));
        assertThat(paths).containsKey("/friends");
    }

    @Test
    @DisplayName("기본 /v0/api-docs 는 열지 않는다 — 허용은 public 그룹 경로 하나다")
    void defaultDocsPathStaysClosed() throws Exception {
        mockMvc.perform(get("/v0/api-docs"))
                .andExpect(status().isUnauthorized());
    }

    @ParameterizedTest
    @CsvSource(delimiter = '|', value = {
            "/islands/{islandId}/shop/products|items|id title kind price currency ownerType owned available reason productVersion|id title kind price currency ownerType owned available reason productVersion",
            "/islands/{islandId}/construction-options|items|id name cost currency selectable buildable blockedReason|id name cost currency selectable buildable blockedReason",
            "/islands/{islandId}/notices|items|id title commentCount|",
            "/islands/{islandId}/quests/current|items|id occurrenceId title type windowStart windowEnd timezone date targetMinutes myRate reward settlementStatus claimable claimBlockedReason claimed bonusAmount bonusGranted version|id occurrenceId title type windowStart windowEnd timezone date targetMinutes myRate reward settlementStatus claimable claimBlockedReason claimed bonusAmount bonusGranted version",
            "/islands/{islandId}/quests/{questId}/progress|members|userId name rate measurementStatus achieved claimed|userId name rate measurementStatus achieved claimed",
            "/islands/{islandId}/statistics/fish-earnings|members|userId name earnedFish|",
            "/me/join-requests|items|id islandId islandName memberCount maxMembers status version createdAt|id islandId memberCount maxMembers status version createdAt"})
    @DisplayName("동명 중첩 DTO가 있어도 각 도메인의 공개 필드와 required를 문서화한다")
    void nestedSchemasRemainSpecificToTheirDomain(String path, String collection, String fields,
            String requiredFields) throws Exception {
        var result = mockMvc.perform(get("/v0/api-docs/public")).andExpect(status().isOk()).andReturn();
        var document = new tools.jackson.databind.ObjectMapper().readTree(result.getResponse().getContentAsString());
        var content = document.path("paths").path(path).path("get").path("responses").path("200").path("content");
        var response = content.iterator().next().path("schema");
        response = document.at(response.path("$ref").asText().substring(1));
        var item = response.path("properties").path(collection).path("items");
        var schema = document.at(item.path("$ref").asText().substring(1));
        assertThat(schema.path("properties").propertyNames()).as("%s 공개 필드", path)
                .containsExactlyInAnyOrder(fields.split(" "));
        var required = new java.util.ArrayList<String>();
        schema.path("required").forEach(value -> required.add(value.asText()));
        assertThat(required).as("%s 필수 필드", path)
                .containsExactlyInAnyOrder(requiredFields == null ? new String[0] : requiredFields.split(" "));
    }

    @Test
    @DisplayName("건설 옵션 OpenAPI는 nullable activeConstruction의 snapshot 필드를 문서화한다")
    void constructionOptionsDocumentsActiveConstruction() throws Exception {
        var result = mockMvc.perform(get("/v0/api-docs/public")).andExpect(status().isOk()).andReturn();
        var document = new tools.jackson.databind.ObjectMapper().readTree(result.getResponse().getContentAsString());
        var content = document.path("paths").path("/islands/{islandId}/construction-options")
                .path("get").path("responses").path("200").path("content");
        var response = content.iterator().next().path("schema");
        var options = document.at(response.path("$ref").asText().substring(1));
        var activeProperty = options.path("properties").path("activeConstruction");
        assertThat(activeProperty.path("type").toString()).contains("object", "null");
        var active = document.at(activeProperty.path("$ref").asText().substring(1));
        assertThat(active.path("properties").propertyNames())
                .containsExactlyInAnyOrder("buildingId", "status", "startedAt", "completesAt", "serverNow", "version");
        var required = new java.util.ArrayList<String>();
        active.path("required").forEach(value -> required.add(value.asText()));
        assertThat(required).containsExactlyInAnyOrder(
                "buildingId", "status", "startedAt", "completesAt", "serverNow", "version");
    }

    @ParameterizedTest
    @CsvSource(delimiter = '|', value = {
            "/auth/sessions|post|201|accessToken refreshToken userId onboardingComplete|",
            "/auth/sessions/guest|post|201|accessToken refreshToken userId onboardingComplete|",
            "/auth/sessions/current/refresh|post|200|accessToken refreshToken|",
            "/auth/sessions/current|delete|200|revoked|",
            "/me/settings|get|200|notifications|",
            "/me/settings|patch|200|notifications|",
            "/islands/{islandId}/host-transfer|post|200|hostUserId version|",
            "/me|delete|200|deleted|",
            "/islands/{islandId}/notices/{noticeId}|delete|200|deleted|deleted"})
    @DisplayName("동명 Result·Deleted도 각 작업의 필드와 필수 여부를 문서화한다")
    void resultSchemasRemainSpecificToTheirOperation(String path, String method, String responseStatus,
            String fields, String requiredFields) throws Exception {
        var result = mockMvc.perform(get("/v0/api-docs/public"))
                .andExpect(status().isOk()).andReturn();
        var document = new tools.jackson.databind.ObjectMapper().readTree(result.getResponse().getContentAsString());
        var content = document.path("paths").path(path).path(method).path("responses").path(responseStatus).path("content");
        var response = content.iterator().next().path("schema");
        var schema = document.at(response.path("$ref").asText().substring(1));
        assertThat(schema.path("properties").propertyNames()).as("%s %s 공개 필드", method, path)
                .containsExactlyInAnyOrder(fields.split(" "));
        var required = new java.util.ArrayList<String>();
        schema.path("required").forEach(value -> required.add(value.asText()));
        assertThat(required).as("%s %s 필수 필드", method, path)
                .containsExactlyInAnyOrder(requiredFields == null ? new String[0] : requiredFields.split(" "));
    }
}
