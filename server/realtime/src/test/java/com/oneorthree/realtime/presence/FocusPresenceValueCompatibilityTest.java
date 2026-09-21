package com.oneorthree.realtime.presence;

import com.oneorthree.realtime.TestcontainersConfiguration;
import com.oneorthree.realtime.common.redis.RedisKeys;
import com.oneorthree.realtime.message.exception.ChatErrorCode;
import com.oneorthree.realtime.message.exception.ChatException;
import com.oneorthree.realtime.message.service.ChatAccessGuard;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.test.context.ActiveProfiles;

import java.time.Duration;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Data 가 리스 값의 <b>모양을 바꿔도</b> 채팅의 판정은 그대로다 (GROMO-2003).
 *
 * <p>값은 이미 두 번 바뀌었다 — 세션 id 문자열 → 순번(GROMO-1743) → {@code 순번:controlVersion:상태}
 * (GROMO-2003). 이쪽은 {@code RedisKeys#focusPresence} 의 주석대로 <b>존재 여부만</b> 보기로 했고,
 * 그 약속이 지켜지는 한 어떤 모양이 와도 판정이 같아야 한다.
 *
 * <p>특히 지금 값은 {@code active} 와 {@code paused} 를 <b>구분해 담는다.</b> 그래도 둘 다 차단이다 —
 * 휴식 중 채팅 허용은 미결 제품 결정 FR-D04 이고(focus-rest-session LLD §6), 그 결정 전에 값을 읽어
 * 「휴식이면 열어 준다」로 앞서가면 정책이 코드에 조용히 박힌다. 이 테스트가 그 앞서감을 막는다.
 *
 * <p>목이 아니라 <b>진짜 Redis</b> 를 쓰는 것이 이 클래스의 전부다. {@code ChatAccessGuardTest} 는
 * {@link FocusPresenceReader} 를 목으로 두므로 값의 모양을 한 글자도 검증하지 못한다.
 */
@SpringBootTest
@ActiveProfiles("ci")
@Import(TestcontainersConfiguration.class)
class FocusPresenceValueCompatibilityTest {

    @Autowired
    private StringRedisTemplate redis;

    @Autowired
    private FocusPresenceReader focusPresenceReader;

    @Autowired
    private ChatAccessGuard accessGuard;

    private UUID userId;

    @BeforeEach
    void setUp() {
        userId = UUID.randomUUID();
    }

    @AfterEach
    void clear() {
        redis.delete(RedisKeys.focusPresence(userId));
    }

    @Test
    @DisplayName("리스가 없으면 집중 중이 아니다 — 통과한다")
    void noLeaseMeansNotFocusing() {
        assertThat(focusPresenceReader.isFocusing(userId)).isFalse();
        assertThatCode(() -> accessGuard.requireNotFocusing(userId)).doesNotThrowAnyException();
    }

    @Test
    @DisplayName("집중 중이면 차단한다 — 값에 상태가 실려도 판정은 존재 여부다")
    void activeLeaseBlocks() {
        setLease("4212:1:active");

        assertThat(focusPresenceReader.isFocusing(userId)).isTrue();
        assertThatThrownBy(() -> accessGuard.requireNotFocusing(userId))
                .isInstanceOf(ChatException.class)
                .extracting(e -> ((ChatException) e).getErrorCode())
                .isEqualTo(ChatErrorCode.FOCUS_IN_PROGRESS);
    }

    @Test
    @DisplayName("휴식 중도 «똑같이» 차단한다 — FR-D04 가 결정되기 전에 앞서가지 않는다")
    void pausedLeaseBlocksTheSameWay() {
        setLease("4212:2:paused");

        assertThat(focusPresenceReader.isFocusing(userId)).isTrue();
        assertThatThrownBy(() -> accessGuard.requireNotFocusing(userId))
                .isInstanceOf(ChatException.class)
                .extracting(e -> ((ChatException) e).getErrorCode())
                .isEqualTo(ChatErrorCode.FOCUS_IN_PROGRESS);
    }

    @Test
    @DisplayName("배포 전 두 세대의 값도 그대로 차단한다 — 배포 순간에 규칙이 풀리면 안 된다")
    void olderValueShapesStillBlock() {
        // GROMO-1743~2003 사이: 순번 단독.
        setLease("4212");
        assertThat(focusPresenceReader.isFocusing(userId)).isTrue();

        // V77 이전: 세션 id 문자열.
        setLease("019f16a0-0000-7000-8000-000000000001");
        assertThat(focusPresenceReader.isFocusing(userId)).isTrue();
    }

    private void setLease(String value) {
        redis.opsForValue().set(RedisKeys.focusPresence(userId), value, Duration.ofMinutes(5));
    }
}
