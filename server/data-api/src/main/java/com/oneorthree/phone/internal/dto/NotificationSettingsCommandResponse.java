package com.oneorthree.phone.internal.dto;

import com.oneorthree.phone.user.dto.NotificationSettingsResponse;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/** 영속 receipt에 저장한 원 명령. 재시도도 동일 patch와 baseline으로 직접 적용을 확인한다. */
public record NotificationSettingsCommandResponse(UUID commandId, String eventId, long version,
                                                   List<String> mask, Map<String, Boolean> patch,
                                                   NotificationSettingsResponse baseline,
                                                   long authGeneration, Result result) {
    public NotificationSettingsCommandResponse {
        mask = List.copyOf(mask);
        patch = Map.copyOf(patch);
    }

    /** 공개 결과는 내구 명령의 결과이며 재생 시 현재 mirror 값으로 바꾸지 않는다. */
    public record Result(boolean notifications) {
    }
}
