package com.oneorthree.phone.friend.api;

import com.oneorthree.phone.friend.dto.FriendResponse;
import com.oneorthree.phone.friend.service.FriendService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultHandlers.print;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(controllers = FriendController.class)
class FriendControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private FriendService friendService;

    private final UUID targetUserId = UUID.randomUUID();

    @Test
    @DisplayName("친구 목록 조회 → 200 + 라이브 필드 매핑 + getFriends(me, date) 위임 (GROMO-822)")
    void getFriendsReturns200WithLiveFields() throws Exception {
        FriendResponse response = FriendResponse.builder()
                .userId(targetUserId)
                .nickname("짝꿍")
                .isFocusing(true)
                .focusTimeMinutes(42)
                .focusStartedAt(Instant.parse("2026-07-03T01:00:00Z"))
                .focusTagName("전공 공부")
                .build();
        given(friendService.getFriends(any(), any())).willReturn(List.of(response));

        mockMvc.perform(get("/api/v1/friends").param("date", "2026-07-03"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].userId").value(targetUserId.toString()))
                .andExpect(jsonPath("$[0].isFocusing").value(true))  // @JsonProperty로 isFocusing 키 고정 검증
                .andExpect(jsonPath("$[0].focusTimeMinutes").value(42))
                .andExpect(jsonPath("$[0].focusTagName").value("전공 공부"))
                .andDo(print());

        // date 쿼리 파라미터가 서비스로 그대로 위임된다
        verify(friendService).getFriends(any(), eq(LocalDate.of(2026, 7, 3)));
    }

    @Test
    @DisplayName("친구 목록 조회 — date 누락 시 400 (required 계약)")
    void getFriendsMissingDateReturns400() throws Exception {
        mockMvc.perform(get("/api/v1/friends"))
                .andExpect(status().isBadRequest())
                .andDo(print());
    }
}
