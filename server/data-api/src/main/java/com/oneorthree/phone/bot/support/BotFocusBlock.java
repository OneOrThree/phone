package com.oneorthree.phone.bot.support;

import java.util.UUID;

/**
 * 봇이 하루 중 한 번 앉아 있는 구간 (GROMO-1565).
 *
 * <p>시각은 <b>그 스케줄 기준일 00시(KST)로부터의 분</b> 이다. 야간형은 자정을 넘기므로
 * {@code endMinute} 가 1440 을 넘을 수 있다 — 어제 날짜로 생성한 블록을 오늘 새벽에 판정할 때는
 * 호출측이 분에 1440 을 더해 비교한다({@code BotSimulator}).
 *
 * @param startMinute 시작 분
 * @param endMinute   종료 분(미포함)
 * @param focusTagId  이 블록에서 집중할 과목 — {@code user_focus_tags.id}
 */
public record BotFocusBlock(int startMinute, int endMinute, UUID focusTagId) {

    /**
     * 그 시각이 이 블록 안인지 본다.
     *
     * @param minuteOfDay 기준일 00시(KST)부터의 분. 자정을 넘긴 블록과 비교할 때는 호출측이 1440 을 더해 넘긴다
     * @return 시작 시각 이상 종료 시각 미만이면 true — 종료 분 자체는 포함하지 않는다
     */
    public boolean contains(int minuteOfDay) {
        return startMinute <= minuteOfDay && minuteOfDay < endMinute;
    }

    /**
     * 블록 길이를 잰다.
     *
     * @return 순수 집중 분 — 블록 사이 휴식은 들어 있지 않다
     */
    public int lengthMinutes() {
        return endMinute - startMinute;
    }
}
