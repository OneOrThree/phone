package com.oneorthree.phone.group.dto;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.oneorthree.phone.group.repository.domain.GroupChallengeStatus;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * status 와이어 브리지 회귀(GROMO-1261 · §E3 additive) — 레거시 응답에 'ENDED' 가 절대 나가면 안 된다.
 *
 * <p>구앱은 {@code GroupChallengeStatus = 'ACTIVE' | 'INACTIVE'}(group.ts:17)로 굳어 있고 종료 분기가
 * 전부 {@code === 'INACTIVE'} 비교다 — 'ENDED' 가 직렬화되는 순간 끝난 챌린지가 활성처럼 렌더된다.
 * 서버 내부는 정본 enum(ENDED)을 쓰되 와이어에서만 INACTIVE 로 낮춘다.
 * 브리지 제거는 구앱 강제 업데이트 이후(GROMO-1238 축)에 이 테스트와 함께 걷어낸다.
 */
class GroupChallengeResponseStatusWireTest {

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    @DisplayName("ENDED 는 와이어에서 'INACTIVE' 로 다운맵된다 — 'ENDED' 문자열은 절대 나가지 않는다")
    void serializesEndedAsInactive() throws JsonProcessingException {
        String json = objectMapper.writeValueAsString(GroupChallengeResponse.builder()
                .status(GroupChallengeStatus.ENDED)
                .build());

        assertThat(json).contains("\"status\":\"INACTIVE\"");
        assertThat(json).doesNotContain("ENDED");
    }

    @Test
    @DisplayName("ACTIVE 는 그대로 'ACTIVE' — 브리지는 종료 상태만 낮춘다")
    void serializesActiveAsIs() throws JsonProcessingException {
        String json = objectMapper.writeValueAsString(GroupChallengeResponse.builder()
                .status(GroupChallengeStatus.ACTIVE)
                .build());

        assertThat(json).contains("\"status\":\"ACTIVE\"");
    }

    @Test
    @DisplayName("내부 getter 는 정본 enum 그대로다 — 다운맵은 직렬화 지점(@JsonProperty) 한 곳뿐")
    void keepsInternalEnumUntouched() {
        GroupChallengeResponse response = GroupChallengeResponse.builder()
                .status(GroupChallengeStatus.ENDED)
                .build();

        assertThat(response.getStatus()).isEqualTo(GroupChallengeStatus.ENDED);
        assertThat(response.getStatusWire()).isEqualTo("INACTIVE");
    }
}
