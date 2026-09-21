package com.oneorthree.phone.focus.repository.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;

/**
 * 집중 보상 정책 revision (GROMO-1924, 선행 조건 #6) — FR-D01 의 「산식은 revision 있는 서버 정책 설정으로
 * 관리(60·480·10·5 를 코드 상수로 박지 않음)」다.
 *
 * <p>값의 출처: 2026-09-18 결정 D5(유효 집중 60초당 1마리 · 주민·섬별 하루 480마리 상한)와 2026-09-19
 * D5-귀속-개정(섬 통장 100% · 개인 0%, 비율은 운영값 — 종전 D5-귀속 50/50 대체). 첫 revision 은 V67 이
 * 넣는다. 운영이 값을 바꾸려면 새
 * revision 행을 넣는다 — 가장 큰 revision 이 현재 정책이고, 세션은 <b>시작할 때</b> 그 revision 을
 * {@code focus_session_details.policy_revision} 에 고정한다(LLD §3 「운영 설정 변경이 진행 세션의
 * 지급률을 바꾸지 않게」). 그래서 행을 고치거나 지우지 않는다.
 *
 * <p>퀘스트 보상(+10·×5)은 퀘스트 정산의 몫이라 여기 없다 — 집중 finish 는 그 값을 쓰지 않는다.
 */
@Entity
@Table(name = "focus_reward_policies")
@Getter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class FocusRewardPolicy {

    @Id
    private int revision;

    /** 이 초만큼의 순수 집중마다 물고기 1마리 — D5 의 60. */
    @Column(name = "seconds_per_fish", nullable = false)
    private int secondsPerFish;

    /** 주민·섬별 하루 상한 — D5 의 480. 상한에 닿아도 집중 기록은 쌓인다. */
    @Column(name = "daily_cap_fish", nullable = false)
    private int dailyCapFish;

    /**
     * 개인 지갑 몫(%) — <b>0 고정</b>이다. 나머지(= 전부)가 섬 통장 몫이다.
     *
     * <p>2026-09-21 결정 재화-단일·개인적립-차단으로 개인 물고기 지갑은 폐기됐고, GROMO-2045 의 V97 이
     * V67 의 {@code CHECK 0..100} 을 {@code CHECK = 0} 으로 좁혀 <b>DB 가</b> 그 결정을 지킨다. 어차피
     * 이 값을 읽는 코드는 없다(정산은 {@code FocusSessionLifecycleService} 가 {@code personalFishAdded=0}
     * 을 박아 쓰고, 적립은 {@code FocusRewardAccrualService} 가 섬 통장에만 넣는다) — 제약은 이 열이
     * «다시 배선될» 때 조용히 열리지 않게 하는 최후 방어선이다.
     */
    @Column(name = "personal_share_percent", nullable = false)
    private int personalSharePercent;

    @Column(name = "published_at", nullable = false, columnDefinition = "timestamptz not null default now()")
    private Instant publishedAt;

    /** 황금 물고기 한 번의 섬 적립량 — 기획 정본의 50 (GROMO-1956, V91). */
    @Column(name = "golden_fish_reward", nullable = false)
    private int goldenFishReward;

    /** 확률표가 세는 ACTIVE 인원 상한 — 기획 정본의 5. 그 이상은 5명과 같은 확률이다. */
    @Column(name = "golden_max_members", nullable = false)
    private int goldenMaxMembers;

    /**
     * ACTIVE 인원 2명부터의 1분당 당첨 확률(ppm)을 쉼표로 이은 표 — 기본값
     * {@code 4000,12000,24000,40000}(2명 0.4% · 3명 1.2% · 4명 2.4% · 5명 이상 4%).
     * 읽을 때는 {@link #goldenChancePpm(int)} 을 쓴다.
     */
    @Column(name = "golden_chance_ppm", nullable = false)
    private String goldenChanceTable;

    /**
     * ACTIVE 인원 {@code members} 명일 때의 1분당 당첨 확률(ppm, {@code GoldenFishDraw.SCALE} 분의 몇).
     *
     * <p>2명 미만은 0 이다 — 「혼자 집중할 때는 나타나지 않는다」(기획 정본). 인원은
     * {@link #goldenMaxMembers} 까지만 세고, 표가 그보다 짧으면 마지막 값을 쓴다(운영이 상한만 올리고
     * 표를 늘리지 않아도 «더 좋아지지» 않게 — 지어낸 확률을 만들지 않는다).
     *
     * @param members 추첨 순간의 ACTIVE 주민 수
     * @return 확률(ppm). 추첨하지 않으면 0
     */
    public int goldenChancePpm(int members) {
        if (members < 2 || goldenMaxMembers < 2 || goldenChanceTable == null) {
            return 0;
        }
        String[] table = goldenChanceTable.split(",");
        if (table.length == 0) {
            return 0;
        }
        int index = Math.min(Math.min(members, goldenMaxMembers) - 2, table.length - 1);
        return Integer.parseInt(table[index].strip());
    }
}
