package com.oneorthree.phone.user.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

/**
 * 유저별 스크린타임 권한·목표 설정 (users 1:1).
 * GROMO-561 로 슬림화 — 스크린타임 권한/목표만 남기고 타임존·알림·리포트 필드는
 * users / user_notification_settings 로 분리.
 */
@Entity
@Table(name = "user_screen_time_settings")
@Getter
@Setter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class UserScreenTimeSettings {

    @Id
    @Column(name = "user_id")
    private UUID userId;

    @Column(name = "is_screen_time_permission_granted", nullable = false)
    @Builder.Default
    private boolean screenTimePermissionGranted = false;

    // 목표 변경은 changeGoal() 로만 — setter 를 막아 이력(previousGoalMinutes) 이 새는 경로를 없앤다.
    @Setter(AccessLevel.NONE)
    @Column(nullable = false)
    @Builder.Default
    private int dailyScreenTimeGoalMinutes = 0;

    // 직전 목표(분) — 오늘 처음 목표를 바꾸기 전의 값 = '어제 유효했던 목표'. 아직 바꾼 적 없으면 null.
    @Setter(AccessLevel.NONE)
    private Integer previousGoalMinutes;

    // 현재 목표가 유효해진 날짜(유저 로컬). 이 날짜 이전 날의 지급·판정은 previousGoalMinutes 를 쓴다.
    @Setter(AccessLevel.NONE)
    private LocalDate goalEffectiveFrom;

    @UpdateTimestamp
    private Instant updatedAt;

    private Instant deletedAt;

    /**
     * 목표 변경(GROMO-1049) — 지급·판정이 '그날의 목표'를 쓰도록 직전 값을 한 단계 보존한다.
     *
     * <p>보존은 <b>오늘의 첫 변경일 때만</b> 한다. 하루에 여러 번 바꿔도 previousGoalMinutes 가
     * 계속 덮이지 않아야 '어제 유효했던 목표'가 살아남는다(두 번째 변경이 덮으면 어제 기준이 지워져
     * 과지급이 난다).</p>
     *
     * @param newGoalMinutes 새 목표(분)
     * @param today          유저 로컬 기준 오늘
     */
    public void changeGoal(int newGoalMinutes, LocalDate today) {
        // 발효일이 today 와 '다르면' 새 전환으로 본다(코드리뷰) — isBefore 만 보면 국가 변경으로
        // 로컬 날짜가 뒤로 갈 때(KR→GB) 미래로 남은 발효일을 '오늘 이미 바꿈'으로 오인해,
        // 새 로컬 오늘이 previous 로 판정되는 구간이 생긴다.
        if (goalEffectiveFrom == null || !goalEffectiveFrom.isEqual(today)) {
            previousGoalMinutes = dailyScreenTimeGoalMinutes;
            goalEffectiveFrom = today;
        }
        dailyScreenTimeGoalMinutes = newGoalMinutes;
    }

    /**
     * 목표는 그대로 두고 발효일만 새 로컬 오늘로 옮긴다 — 국가 변경으로 유저 로컬 날짜가
     * 움직였을 때, 목표 변경과 무관하게 먼저 호출한다.
     *
     * <p>{@link #changeGoal}을 현재값으로 부르는 방식은 쓰지 않는다 — previousGoalMinutes 가
     * 현재값으로 덮여 <b>진짜 직전 목표가 사라진다</b>(120→60 변경 직후 국가를 바꾸면 previous 가
     * 60이 돼, 아직 지급 창 안에 있는 그 전날이 60으로 지급된다).</p>
     *
     * <p>옮기는 대상은 딱 둘이다(코드리뷰) — <b>임의의 과거 전환은 건드리지 않는다</b>.
     * 닉네임 저장이 countryCode 를 늘 함께 보내는 탓에, 며칠 전 전환까지 오늘로 당기면 그 사이
     * 날들이 '변경 전'으로 잘못 라벨링된다.</p>
     * <ul>
     *   <li><b>미래로 남은 발효일</b> — 로컬 날짜가 뒤로 간 경우(KR→GB). 그대로 두면 새 로컬 오늘이
     *       직전 목표로 판정된다.</li>
     *   <li><b>옛 존의 '오늘'에 일어난 전환</b> — 로컬 날짜가 앞으로 간 경우(GB→KR). 전환은 옛 존
     *       오늘에 있었는데 새 존에서는 그 날이 이미 어제라, 그대로 두면 그날의 지연 리포트가 새
     *       목표로 판정된다(클라는 옛 목표로 계산해 보냈다).</li>
     * </ul>
     *
     * @param oldLocalToday 국가 변경 <b>전</b> 존 기준 오늘(국가가 안 바뀌었으면 newLocalToday 와 같다)
     * @param newLocalToday 국가 변경 <b>후</b> 존 기준 오늘
     */
    public void realignEffectiveDate(LocalDate oldLocalToday, LocalDate newLocalToday) {
        if (goalEffectiveFrom == null) {
            return;
        }
        if (goalEffectiveFrom.isAfter(newLocalToday) || goalEffectiveFrom.isEqual(oldLocalToday)) {
            goalEffectiveFrom = newLocalToday;
        }
    }

    /**
     * 주어진 날짜에 유효했던 목표(분). 이력이 없으면 현재값으로 근사한다(기존 유저·미변경 유저).
     *
     * <p>previous 는 <b>발효일 직전 하루</b>에만 적용한다(코드리뷰). 이 필드는 '가장 최근 변경
     * 직전 값'일 뿐이라, 며칠 연속 목표를 바꾼 뒤 오래된 날짜를 물으면 무관한 최근 목표를 돌려준다.
     * 지연 업로드 세션은 임의 과거 날짜로 들어올 수 있고 달성 판정에는 지급 창([어제, 오늘])이
     * 걸려 있지 않으므로, 1일 유효 창 밖은 알 수 없다고 보고 현재값으로 근사한다(기존 동작).</p>
     */
    public int goalMinutesOn(LocalDate date) {
        if (goalEffectiveFrom != null && previousGoalMinutes != null
                && date.isBefore(goalEffectiveFrom)
                && !date.isBefore(goalEffectiveFrom.minusDays(1))) {
            return previousGoalMinutes;
        }
        return dailyScreenTimeGoalMinutes;
    }
}
