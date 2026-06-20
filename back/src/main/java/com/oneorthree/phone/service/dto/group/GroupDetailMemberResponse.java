package com.oneorthree.phone.service.dto.group;

import com.oneorthree.phone.domain.group.GroupMemberRole;
import lombok.Builder;
import lombok.Getter;

@Getter
@Builder
public class GroupDetailMemberResponse {
    private Long userId;
    private String nickname;
    private GroupMemberRole role;
    // TODO GROMO-369: Integer focusTimeMinutes 필드 추가
    //  - 오늘(UTC date) 누적 집중 시간(분)
    //  - 출처: DailyFocusStat.totalFocusMinutes (없으면 0)
}
