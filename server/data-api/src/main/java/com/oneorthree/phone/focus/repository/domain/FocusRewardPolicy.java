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

    /** 개인 지갑 몫(%) — D5-귀속-개정의 0. 나머지가 섬 통장 몫이다. */
    @Column(name = "personal_share_percent", nullable = false)
    private int personalSharePercent;

    @Column(name = "published_at", nullable = false, columnDefinition = "timestamptz not null default now()")
    private Instant publishedAt;
}
