package com.oneorthree.phone.focus.dto.session;

import java.util.UUID;

/** 세션 없는 체험 보상. granted는 같은 섬 수령의 재확인을 포함한다. */
public record TutorialExperienceRewardView(UUID islandId, String status) {
}
