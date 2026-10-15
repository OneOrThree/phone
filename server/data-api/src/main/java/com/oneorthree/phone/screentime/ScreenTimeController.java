package com.oneorthree.phone.screentime;

import com.oneorthree.phone.common.auth.LoginUser;
import com.oneorthree.phone.screentime.service.ScreenTimeService;
import com.oneorthree.phone.screentime.dto.ScreenTimeRequest;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/**
 * 기기가 측정한 하루 스크린타임 보고를 받는 창구.
 *
 * <p>달성 여부는 앱이 그날의 목표로 계산해 보내고 서버는 재판정하지 않는다 — 서버는 과거 날짜의
 * 당시 목표를 알 수 없기 때문이다. 다만 보고 시각이 어느 날짜에 속하는지는 서버가
 * {@link com.oneorthree.phone.common.util.ZonePolicy#KST} 로 다시 환산한다.
 */
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class ScreenTimeController implements ScreenTimeControllerDocs {

    private final ScreenTimeService screenTimeService;

    /**
     * 하루치 스크린타임 보고를 저장한다.
     *
     * @param request 측정값과 달성 여부, 보고 시각. 날짜 버킷은 기기 로컬이 아니라
     *                reportedAt 을 KST 로 환산해 정한다
     * @param userId  보고 주체
     * @return 본문 없는 204. 같은 날짜에 여러 번 보고해도 덮어쓰기라 결과가 같고,
     *         목표 달성 알림·재화 지급은 마감 보고에서 미달성→달성으로 넘어가는 순간 한 번만 일어난다
     */
    @PostMapping("/screen-time")
    public ResponseEntity<Void> saveScreenTime(
            @Valid @RequestBody ScreenTimeRequest request,
            @LoginUser UUID userId) {
        screenTimeService.saveScreenTime(userId, request);
        return ResponseEntity.noContent().build();
    }
}
