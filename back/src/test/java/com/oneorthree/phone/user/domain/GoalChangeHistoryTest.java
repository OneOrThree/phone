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

        assertThat(settings.goalMinutesOn(YESTERDAY)).isEqualTo(60);
        assertThat(settings.goalMinutesOn(TODAY)).isEqualTo(30);
    }

    /**
     * previous 는 '가장 최근 변경 직전 값'일 뿐이라 하루 창 밖에서는 무관한 값이다(코드리뷰).
     * 지연 업로드 세션은 임의 과거 날짜로 들어오고 달성 판정에는 지급 창이 걸려 있지 않으므로,
     * 창 밖 날짜까지 previous 로 판정하면 오래된 세션이 최근 목표로 재단된다.
     */
    @Test
    @DisplayName("발효일보다 이틀 이상 이전 날짜는 previous 를 쓰지 않고 현재값으로 근사한다")
    void datesOutsideOneDayWindow_fallBackToCurrentGoal() {
        UserScreenTimeSettings settings = screenSettings(180);
        // 8/5에 120으로, 8/6에 30으로 — 연속 변경 후 previous 는 120(=8/5 값)만 남는다
        settings.changeGoal(120, YESTERDAY);
        settings.changeGoal(30, TODAY);

        // 8/4 세션이 지연 업로드되면? 그날 목표는 180이었지만 서버는 모른다 —
        // previous(120)로 판정하면 무관한 값이므로 현재값(30)으로 근사한다.
        assertThat(settings.goalMinutesOn(TODAY.minusDays(2))).isEqualTo(30);
        assertThat(settings.goalMinutesOn(TODAY.minusDays(10))).isEqualTo(30);
        // 창 안(어제)은 그대로 previous 적용
        assertThat(settings.goalMinutesOn(YESTERDAY)).isEqualTo(120);
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
