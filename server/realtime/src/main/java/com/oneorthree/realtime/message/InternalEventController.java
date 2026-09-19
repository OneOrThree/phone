package com.oneorthree.realtime.message;

import com.oneorthree.realtime.message.service.ChatUserFence;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.PositiveOrZero;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;
import java.util.UUID;

/**
 * Data 의 내구 사건 수신구 {@code POST /internal/events} (GROMO-1943) — 지금은 {@code user.withdrawn} 하나다.
 *
 * <p>본문은 Data outbox 의 <b>정본 봉투 그대로</b>다(알림 서버의 같은 경로와 같은 모양). 자격은
 * {@code InternalServiceTokenFilter} 의 Data 전용 토큰({@code SVC_TOKEN_DATA_TO_REALTIME})이 정하고,
 * 앱 AT·STOMP 로는 이 경로에 닿을 수 없다 — 앱 입력으로 tombstone 을 만들 수 없어야 한다.
 *
 * <p><b>멱등이다.</b> 같은 사건의 재전달(응답 유실·relay 재시도)은 같은 결과(커서 0행·tombstone 1행)로
 * 수렴하고 같은 200 을 돌려준다. 그래서 별도의 수신 기록 표를 두지 않는다.
 *
 * <p>⚠️ Data relay 에 {@code REALTIME} transport 가 아직 없다({@code OutboxRelayConfig}). Data 는 사건을
 * {@code REALTIME} 전달 행으로 내구화해 두고, transport 가 붙는 날 이 경로로 밀린 사건이 들어온다.
 */
@RestController
@RequiredArgsConstructor
public class InternalEventController {

    private final ChatUserFence chatUserFence;

    /** 정본 봉투 중 이 소비자가 읽는 필드만. 나머지(version·occurredAt 등)는 무시한다. */
    public record WithdrawnEvent(
            @NotNull @Pattern(regexp = "user\\.withdrawn") String type,
            @NotNull UUID userId,
            @NotNull @Valid Params params) {

        public record Params(@NotNull @PositiveOrZero Long authGeneration) {
        }
    }

    @PostMapping("/internal/events")
    public Map<String, Object> accept(@Valid @RequestBody WithdrawnEvent event) {
        chatUserFence.withdraw(event.userId(), event.params().authGeneration());
        return Map.of("accepted", true);
    }
}
