package com.oneorthree.phone.invitelink;

import com.oneorthree.phone.common.support.IntegrationTestBase;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * AASA 서빙 테스트 (계약 ⑤).
 *
 * <p>Universal Links 는 이 파일 하나로 켜지고 꺼진다. content-type 이 어긋나거나 인증이 걸리면
 * iOS 는 <b>조용히</b> 무시하고 링크는 사파리로 열린다 — 증상이 안 보이는 종류의 고장이라 계약으로 잠근다.
 */
@AutoConfigureMockMvc
class WellKnownTest extends IntegrationTestBase {

    @Autowired
    MockMvc mockMvc;

    @Test
    @DisplayName("AASA 는 무인증 200 application/json 이고 appID·경로가 계약과 같다")
    void servesAasaAsJson() throws Exception {
        mockMvc.perform(get("/.well-known/apple-app-site-association"))
                .andExpect(status().isOk())
                .andExpect(content().contentTypeCompatibleWith("application/json"))
                .andExpect(jsonPath("$.applinks.details[0].appIDs[0]")
                        .value("P6Z68QUK9M.com.oneorthree.gromo"))
                .andExpect(jsonPath("$.applinks.details[0].components[0]./").value("/l/*"))
                .andExpect(jsonPath("$.applinks.apps").isEmpty());
    }
}
