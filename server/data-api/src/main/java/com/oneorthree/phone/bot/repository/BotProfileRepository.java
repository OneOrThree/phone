package com.oneorthree.phone.bot.repository;

import com.oneorthree.phone.bot.repository.domain.BotProfile;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.UUID;

/**
 * 봇 성향 조회 (GROMO-1565).
 *
 * <p>{@code findAll()} 로 전량을 읽는다 — 봇은 190명 고정이고 매 tick 전원의 상태를 판정해야 해서
 * 페이징이 의미가 없다. 규모가 크게 늘면 그때 잘라 읽는다.
 */
public interface BotProfileRepository extends JpaRepository<BotProfile, UUID> {
}
