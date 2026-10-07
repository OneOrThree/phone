package com.oneorthree.phone.internal;

import com.oneorthree.phone.focus.dto.session.FocusTutorialRewardView;
import com.oneorthree.phone.focus.dto.session.TutorialExperienceRewardView;
import com.oneorthree.phone.internal.service.FocusTutorialRewardService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/** 내부 인증 필터가 경로 사용자와 서명된 X-User-Id의 일치를 검증한다. */
@RestController
@RequiredArgsConstructor
public class InternalFocusTutorialRewardController {
    private final FocusTutorialRewardService rewards;

    @PostMapping("/internal/users/{userId}/islands/{islandId}/tutorial-reward")
    public TutorialExperienceRewardView claimExperience(@PathVariable UUID userId, @PathVariable UUID islandId) {
        return rewards.claimExperience(userId, islandId);
    }

    @PostMapping("/internal/users/{userId}/focus-sessions/{sessionId}/tutorial-reward")
    public FocusTutorialRewardView claim(@PathVariable UUID userId, @PathVariable UUID sessionId) {
        return rewards.claim(userId, sessionId);
    }
}
