package com.oneorthree.phone.focus.repository;

import com.oneorthree.phone.common.support.RepositoryTestBase;
import com.oneorthree.phone.focus.repository.domain.FocusSession;
import com.oneorthree.phone.focus.repository.domain.FocusSessionPomodoro;
import com.oneorthree.phone.focus.repository.domain.FocusType;
import com.oneorthree.phone.focus.repository.domain.PomodoroSetting;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.repository.UserRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 포모도로 매핑 통합 테스트 (GROMO-675 — 스키마+매핑 선반영).
 *
 * <p>focus_session_pomodoros(세션 1:1, 프리셋 nullable FK)와 focus_sessions_pomodoro_setting 의
 * 저장/조회 매핑을 실 PostgreSQL(Testcontainers)로 검증한다. 기능 로직은 별도 티켓.
 */
class FocusSessionPomodoroRepositoryTest extends RepositoryTestBase {

    @Autowired
    private FocusSessionPomodoroRepository focusSessionPomodoroRepository;

    @Autowired
    private PomodoroSettingRepository pomodoroSettingRepository;

    @Autowired
    private FocusSessionRepository focusSessionRepository;

    @Autowired
    private UserRepository userRepository;

    @Test
    @DisplayName("포모도로 상세 저장 후 세션으로 1:1 조회 — 프리셋 연결 포함")
    void savesAndFindsByFocusSession() {
        // given: 유저 + POMODORO 세션 + 프리셋
        User user = userRepository.save(User.builder().nickname("테스터").build());
        FocusSession session = focusSessionRepository.save(FocusSession.builder()
                .user(user).startedAt(Instant.now()).focusType(FocusType.POMODORO).build());
        PomodoroSetting setting = pomodoroSettingRepository.save(PomodoroSetting.builder()
                .name("클래식 25/5").focusMinutes(25).breakMinutes(5).isDefault(true).build());

        focusSessionPomodoroRepository.save(FocusSessionPomodoro.builder()
                .focusSession(session).pomodoroSetting(setting)
                .focusMinutes(25).breakMinutes(5).setCount(4).build());
        focusSessionPomodoroRepository.flush();

        // when
        Optional<FocusSessionPomodoro> found = focusSessionPomodoroRepository.findByFocusSession(session);

        // then
        assertThat(found).isPresent();
        assertThat(found.get().getFocusMinutes()).isEqualTo(25);
        assertThat(found.get().getSetCount()).isEqualTo(4);
        assertThat(found.get().getPomodoroSetting().getId()).isEqualTo(setting.getId());
    }

    @Test
    @DisplayName("프리셋 없이(커스텀 설정) 저장 가능 — pomodoro_setting_id nullable")
    void savesWithoutPreset() {
        User user = userRepository.save(User.builder().nickname("테스터2").build());
        FocusSession session = focusSessionRepository.save(FocusSession.builder()
                .user(user).startedAt(Instant.now()).focusType(FocusType.POMODORO).build());

        focusSessionPomodoroRepository.save(FocusSessionPomodoro.builder()
                .focusSession(session).focusMinutes(50).breakMinutes(10).setCount(2).build());
        focusSessionPomodoroRepository.flush();

        Optional<FocusSessionPomodoro> found = focusSessionPomodoroRepository.findByFocusSession(session);
        assertThat(found).isPresent();
        assertThat(found.get().getPomodoroSetting()).isNull();
    }

    @Test
    @DisplayName("프리셋 목록 조회 — 소프트딜리트된 프리셋 제외")
    void findsOnlyActivePresets() {
        // given: 활성 프리셋 1 + 삭제된 프리셋 1
        pomodoroSettingRepository.save(PomodoroSetting.builder()
                .name("클래식 25/5").focusMinutes(25).breakMinutes(5).isDefault(true).build());
        pomodoroSettingRepository.save(PomodoroSetting.builder()
                .name("구버전 50/10").focusMinutes(50).breakMinutes(10).deletedAt(Instant.now()).build());
        pomodoroSettingRepository.flush();

        // when
        List<PomodoroSetting> active = pomodoroSettingRepository.findByDeletedAtIsNull();

        // then: 활성 프리셋만
        assertThat(active).extracting(PomodoroSetting::getName).containsExactly("클래식 25/5");
    }
}
