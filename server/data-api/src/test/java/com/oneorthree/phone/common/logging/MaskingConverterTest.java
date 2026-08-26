package com.oneorthree.phone.common.logging;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class MaskingConverterTest {

    @Test
    @DisplayName("이메일은 앞 3자만 남기고 마스킹한다")
    void 이메일_마스킹() {
        String masked = MaskingConverter.mask("유저 volume.test@gmail.com 로그인");

        assertThat(masked).contains("vol****@****.***");
        assertThat(masked).doesNotContain("gmail");
        assertThat(masked).doesNotContain("volume.test@");
    }

    @Test
    @DisplayName("한국 휴대폰은 가운데를 마스킹하고 앞자리·뒷4자리를 남긴다")
    void 휴대폰_마스킹() {
        assertThat(MaskingConverter.mask("phone 010-1234-5678"))
                .contains("010-****-5678")
                .doesNotContain("1234");
        // 구분자 없는 형태도 마스킹
        assertThat(MaskingConverter.mask("01012345678"))
                .contains("010-****-5678");
    }

    @Test
    @DisplayName("주민등록번호는 뒷자리를 마스킹한다")
    void 주민번호_마스킹() {
        assertThat(MaskingConverter.mask("ssn 123456-1234567"))
                .contains("123456-1******")
                .doesNotContain("1234567");
    }

    @Test
    @DisplayName("민감 키=값(password 등)은 값을 마스킹한다")
    void 민감키_마스킹() {
        String masked = MaskingConverter.mask("login password=secret123 ok");

        assertThat(masked).contains("password=****");
        assertThat(masked).doesNotContain("secret123");
    }

    @Test
    @DisplayName("민감 키(email=)는 이메일 패턴보다 먼저 처리돼 이중 마스킹되지 않는다")
    void 민감키가_이메일보다_먼저_처리된다() {
        String masked = MaskingConverter.mask("email=volume.test@gmail.com");

        assertThat(masked).contains("email=****");
        assertThat(masked).doesNotContain("gmail");
        // 이메일 패턴이 다시 잡아 "vol****@****.***" 같은 흔적을 남기지 않음
        assertThat(masked).doesNotContain("@****.***");
    }

    @Test
    @DisplayName("null·빈문자열은 그대로 반환한다")
    void null_빈문자_통과() {
        assertThat(MaskingConverter.mask(null)).isNull();
        assertThat(MaskingConverter.mask("")).isEmpty();
    }

    @Test
    @DisplayName("정상 숫자·UUID는 마스킹되지 않는다 (오탐 회귀 방지)")
    void 정상값은_훼손되지_않는다() {
        // user-activity payload의 일반 수치
        assertThat(MaskingConverter.mask("duration_seconds=1500 goal_minutes=25"))
                .isEqualTo("duration_seconds=1500 goal_minutes=25");
        // user_id(UUID v7)
        String uuid = "019700e8-1c2a-7def-8000-abc123456789";
        assertThat(MaskingConverter.mask("user_id=" + uuid)).contains(uuid);
    }
}
