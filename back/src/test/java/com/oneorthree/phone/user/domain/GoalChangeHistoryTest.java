package com.oneorthree.phone.user.domain;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 목표 변경 1단계 이력(GROMO-1049) 단위 테스트.
 *
 * <p>지급·판정이 '그날의 목표'를 쓰려면 직전 목표가 정확히 '어제 유효했던 값'이어야 한다.
 * 특히 하루에 여러 번 바꿀 때 두 번째 변경이 직전 값을 덮으면 어제 기준이 지워져 과지급이 난다.</p>
 */
class GoalChangeHistoryTest {

    private static final UUID USER_ID = UUID.randomUUID();
    private static final LocalDate YESTERDAY = LocalDate.of(2026, 8, 5);
    private static final LocalDate TODAY = LocalDate.of(2026, 8, 6);

    private UserScreenTimeSettings screenSettings(int goalMinutes) {
        return UserScreenTimeSettings.builder()
                .userId(USER_ID).dailyScreenTimeGoalMinutes(goalMinutes).build();
    }

    @Test
    @DisplayName("변경 이력이 없으면 어느 날짜든 현재 목표를 쓴다(기존 유저)")
    void noHistory_fallsBackToCurrentGoal() {
        UserScreenTimeSettings settings = screenSettings(180);

        assertThat(settings.goalMinutesOn(YESTERDAY)).isEqualTo(180);
        assertThat(settings.goalMinutesOn(TODAY)).isEqualTo(180);
    }

    @Test
    @DisplayName("오늘 목표를 바꾸면 어제는 직전 목표, 오늘은 새 목표")
    void afterChange_pastDateUsesPreviousGoal() {
        UserScreenTimeSettings settings = screenSettings(180);

        settings.changeGoal(60, TODAY);

        assertThat(settings.goalMinutesOn(YESTERDAY)).isEqualTo(180);
        assertThat(settings.goalMinutesOn(TODAY)).isEqualTo(60);
        assertThat(settings.getDailyScreenTimeGoalMinutes()).isEqualTo(60);
    }

    @Test
    @DisplayName("하루에 여러 번 바꿔도 어제 목표는 첫 변경 직전 값으로 보존된다")
    void multipleChangesSameDay_keepFirstPreviousGoal() {
        UserScreenTimeSettings settings = screenSettings(180);

        settings.changeGoal(60, TODAY);
        settings.changeGoal(30, TODAY);
        settings.changeGoal(240, TODAY);

        // 두 번째 이후 변경이 previous 를 덮었다면 어제 목표가 60/30 으로 오염돼 지급액이 어긋난다
        assertThat(settings.goalMinutesOn(YESTERDAY)).isEqualTo(180);
        assertThat(settings.goalMinutesOn(TODAY)).isEqualTo(240);
    }

    @Test
    @DisplayName("날이 바뀐 뒤 다시 바꾸면 직전 목표가 그 전날 값으로 갱신된다")
    void changeOnLaterDay_rollsPreviousGoalForward() {
        UserScreenTimeSettings settings = screenSettings(180);
        settings.changeGoal(60, YESTERDAY);

        settings.changeGoal(30, TODAY);

        // 어제(8/5)는 어제 발효된 60, 그저께(8/4)는 이력 밖이라 근사값(60)을 쓴다 — 지급 창이 [어제, 오늘]이라 무관
        assertThat(settings.goalMinutesOn(YESTERDAY)).isEqualTo(60);
        assertThat(settings.goalMinutesOn(TODAY)).isEqualTo(30);
    }

    @Test
    @DisplayName("집중 목표도 같은 규칙으로 동작한다")
    void focusSettings_followSameRule() {
        UserFocusTimeSettings settings = UserFocusTimeSettings.builder()
                .userId(USER_ID).dailyFocusTimeGoalMinutes(120).build();

        settings.changeGoal(60, TODAY);
        settings.changeGoal(90, TODAY);

        assertThat(settings.goalMinutesOn(YESTERDAY)).isEqualTo(120);
        assertThat(settings.goalMinutesOn(TODAY)).isEqualTo(90);
    }
}
