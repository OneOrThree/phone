package com.oneorthree.phone.friend.api;

import com.oneorthree.phone.common.auth.AuthAttributes;
import com.oneorthree.phone.friend.dto.PinnedUserResponse;
import com.oneorthree.phone.friend.service.FriendService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

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

    // 핀하는 본인(me)과 핀 대상(targetUserId)은 반드시 서로 다른 값이어야 한다 —
    // 같은 값이면 컨트롤러가 두 인자를 뒤바꿔 넘겨도 검증이 통과한다 (GROMO-363).
    private final UUID me = UUID.randomUUID();
    private final UUID targetUserId = UUID.randomUUID();

    @Test
    @DisplayName("유저 핀 설정 → 204")
    void pinReturns204() throws Exception {
        mockMvc.perform(post("/api/v1/pins/{userId}", targetUserId)
                        .requestAttr(AuthAttributes.USER_ID, me))
                .andExpect(status().isNoContent())
                .andDo(print());

        verify(friendService).pinFriend(me, targetUserId);
    }

    @Test
    @DisplayName("유저 핀 해제 → 204")
    void unpinReturns204() throws Exception {
        mockMvc.perform(delete("/api/v1/pins/{userId}", targetUserId)
                        .requestAttr(AuthAttributes.USER_ID, me))
                .andExpect(status().isNoContent())
                .andDo(print());

        verify(friendService).unpinFriend(me, targetUserId);
    }

    @Test
    @DisplayName("핀한 유저 조회 → 200 + 응답 매핑")
    void getPinsReturns200() throws Exception {
        LocalDate date = LocalDate.of(2026, 7, 3);
        PinnedUserResponse response = PinnedUserResponse.builder()
                .userId(targetUserId)
                .nickname("짝꿍")
                .character(List.of())
                .focusTimeMinutes(42)
                .isFocusing(true)
                .build();
        given(friendService.getPinnedFriends(me, date)).willReturn(List.of(response));

        mockMvc.perform(get("/api/v1/pins")
                        .param("date", date.toString())
                        .requestAttr(AuthAttributes.USER_ID, me))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].userId").value(targetUserId.toString()))
                .andExpect(jsonPath("$[0].focusTimeMinutes").value(42))
                .andExpect(jsonPath("$[0].isFocusing").value(true))  // @JsonProperty로 isFocusing 키 고정 검증
                .andDo(print());
    }
}
