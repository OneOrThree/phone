package com.oneorthree.phone.friend.api;

import com.oneorthree.phone.friend.dto.PinnedFriendResponse;
import com.oneorthree.phone.friend.service.FriendService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultHandlers.print;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(controllers = PinController.class)
class PinControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private FriendService friendService;

    private final UUID targetUserId = UUID.randomUUID();

    @Test
    @DisplayName("유저 핀 설정 → 204")
    void pinReturns204() throws Exception {
        mockMvc.perform(post("/api/v1/pins/{userId}", targetUserId))
                .andExpect(status().isNoContent())
                .andDo(print());

        verify(friendService).pinFriend(any(), eq(targetUserId));
    }

    @Test
    @DisplayName("유저 핀 해제 → 204")
    void unpinReturns204() throws Exception {
        mockMvc.perform(delete("/api/v1/pins/{userId}", targetUserId))
                .andExpect(status().isNoContent())
                .andDo(print());

        verify(friendService).unpinFriend(any(), eq(targetUserId));
    }

    @Test
    @DisplayName("핀한 유저 조회 → 200 + 응답 매핑")
    void getPinsReturns200() throws Exception {
        PinnedFriendResponse response = PinnedFriendResponse.builder()
                .userId(targetUserId)
                .nickname("짝꿍")
                .character(List.of())
                .focusTimeMinutes(42)
                .isFocusing(true)
                .build();
        given(friendService.getPinnedFriends(any(), any())).willReturn(List.of(response));

        mockMvc.perform(get("/api/v1/pins").param("date", "2026-07-03"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].userId").value(targetUserId.toString()))
                .andExpect(jsonPath("$[0].focusTimeMinutes").value(42))
                .andExpect(jsonPath("$[0].isFocusing").value(true))  // @JsonProperty로 isFocusing 키 고정 검증
                .andDo(print());
    }
}
