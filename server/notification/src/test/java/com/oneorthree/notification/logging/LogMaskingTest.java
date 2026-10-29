package com.oneorthree.notification.logging;

import org.junit.jupiter.api.Test;

import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertTimeoutPreemptively;

class LogMaskingTest {

    @Test
    void masksTheFourRules() {
        assertThat(LogMasking.mask("login password=secret123 ok")).isEqualTo("login password=**** ok");
        assertThat(LogMasking.mask("유저 volume.test@gmail.com")).isEqualTo("유저 vol****@****.***");
        assertThat(LogMasking.mask("010-1234-5678")).isEqualTo("010-****-5678");
        assertThat(LogMasking.mask("ssn 123456-1234567")).isEqualTo("ssn 123456-1******");
        assertThat(LogMasking.mask("email=volume.test@gmail.com")).isEqualTo("email=****");
        assertThat(LogMasking.mask(null)).isNull();
        assertThat(LogMasking.mask("")).isEmpty();
    }

    @Test
    void emailBoundariesKeepTheirMaskingResult() {
        assertThat(LogMasking.mask("-abc@x.com")).isEqualTo("-ab****@****.***");
        assertThat(LogMasking.mask(".abcd@x.com")).isEqualTo(".ab****@****.***");
        assertThat(LogMasking.mask("a@x.com,b@y.org")).isEqualTo("a****@****.***,b****@****.***");
        assertThat(LogMasking.mask("(abc@x.com).")).isEqualTo("(abc****@****.***).");
        assertThat(LogMasking.mask("x@y.com-foo@x.com")).isEqualTo("x****@****.***-fo****@****.***");
        // 직전 매치 끝에 바로 붙은 로컬 문자열도 새 이메일로 잡는다(\G)
        assertThat(LogMasking.mask("a@b.com1foo@x.com")).isEqualTo("a****@****.***1fo****@****.***");
    }

    @Test
    void longInputsAreMaskedInLinearTime() {
        String noAt = "path=/" + "a".repeat(200_000);
        String longLocal = "a".repeat(100_000) + "@x.com";
        assertTimeoutPreemptively(Duration.ofSeconds(1), () -> {
            assertThat(LogMasking.mask(noAt)).isEqualTo(noAt);
            assertThat(LogMasking.mask(longLocal)).isEqualTo("aaa****@****.***");
        });
    }
}
