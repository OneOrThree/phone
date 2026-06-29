package com.oneorthree.phone.screentime.api;

import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;

@WebMvcTest(controllers = ScreenTimeController.class)
class ScreenTimeControllerTest {

    // TODO GROMO-551: user/api/UserControllerTest.java 슬라이스 패턴 미러
    //   필드: @Autowired MockMvc, @MockitoBean ScreenTimeService, ObjectMapper
    //   검증 케이스 (POST /api/v1/screen-time):
    //   - 정상 저장 → 204  (verify screenTimeService.saveScreenTime(any(), any()))
    //   - actualScreenTimeMinutes 음수 → 400
    //   - screenTimeGoalAchieved null → 400
    //   - reportedAt null → 400
    //   - timeZone blank → 400
    //   참고: 무효 timeZone(서버측 ZoneId.of 실패)은 서비스 단 동작이므로 ScreenTimeServiceTest 에서 검증.
}
