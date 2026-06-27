package com.oneorthree.phone.user.api;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.oneorthree.phone.user.service.UserService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.Collections;
import java.util.Map;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultHandlers.print;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(controllers = UserController.class)
class UserControllerTest {

    @Autowired
    private MockMvc mockMvc;

    private final ObjectMapper objectMapper = new ObjectMapper();

    @MockitoBean
    private UserService userService;

    @Test
    @DisplayName("디바이스 토큰 등록 성공 → 204")
    void registerDeviceTokenReturns204() throws Exception {
        mockMvc.perform(put("/api/v1/users/me/device-token")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("deviceToken", "apns-device-token"))))
                .andExpect(status().isNoContent())
                .andDo(print());

        verify(userService).registerDeviceToken(any(), eq("apns-device-token"));
    }

    @Test
    @DisplayName("deviceToken 누락(blank) → 400")
    void registerDeviceTokenBlankReturns400() throws Exception {
        mockMvc.perform(put("/api/v1/users/me/device-token")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Collections.singletonMap("deviceToken", ""))))
                .andExpect(status().isBadRequest())
                .andDo(print());
    }
}
