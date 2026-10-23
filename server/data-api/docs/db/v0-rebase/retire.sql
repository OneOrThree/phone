-- Catus V0 전환: 현재 사용자·섬·집중 데이터는 보존한다.
-- 구 API가 사라지면 종료할 수 없는 상세 없는 마커만 0초로 마감한다. 보상·통계는 만들지 않는다.
UPDATE public.focus_sessions s SET ended_at = s.started_at, status = 'AUTO_CLOSED'
WHERE s.ended_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM public.focus_session_details d WHERE d.session_id = s.id);
-- LINK 전달 작업과 다른 위성이 참조하지 않는 폐기6종 원본만 제거한다. user.withdrawn은 보존한다.
DELETE FROM public.event_outbox_deliveries WHERE target = 'LINK';
DELETE FROM public.event_outbox e
WHERE e.type IN ('link.revoked', 'link.joined', 'link.claimConfirmed',
                 'group.closed', 'group.renamed', 'user.displayNameChanged')
  AND NOT EXISTS (SELECT 1 FROM public.event_outbox_deliveries d WHERE d.outbox_id = e.id);
ALTER TABLE public.event_outbox_deliveries
    DROP CONSTRAINT event_outbox_deliveries_target_check,
    ADD CONSTRAINT event_outbox_deliveries_target_check
        CHECK (target IN ('KAFKA', 'NOTI', 'REALTIME', 'SCORE'));
ALTER TABLE public.users
    DROP COLUMN occupation,
    DROP COLUMN tier_level,
    DROP COLUMN stat_visibility,
    DROP COLUMN character_trial_anchor_at,
    DROP COLUMN is_bot,
    DROP COLUMN device_token,
    DROP COLUMN refresh_token_hash,
    DROP COLUMN last_active_at;
ALTER TABLE public.auth_sessions
    DROP COLUMN legacy,
    DROP COLUMN legacy_device_token;
ALTER TABLE public.focus_sessions
    DROP COLUMN focus_tag_id;
ALTER TABLE public.group_members
    DROP COLUMN transition_seq,
    DROP COLUMN snapshot_version;
DROP TABLE
    public.bot_profiles,
    public.character_equipment,
    public.character_generation,
    public.currency_transactions,
    public.daily_screen_time_stats,
    public.default_tags,
    public.focus_session_pomodoros,
    public.focus_sessions_pomodoro_setting,
    public.group_challenge_bet_participants,
    public.group_challenge_bet_sessions,
    public.group_challenge_bets,
    public.group_challenge_durations,
    public.group_challenge_members,
    public.group_challenge_windows,
    public.group_challenges,
    public.invite_claim_confirmations,
    public.invite_claim_intents,
    public.invite_click_frozen_rows,
    public.invite_click_migrations,
    public.invite_link_clicks,
    public.invite_link_frozen_rows,
    public.items,
    public.league_arenas,
    public.league_rank_snapshots,
    public.league_tier_configs,
    public.league_weekly_results,
    public.notification_result_bundle_manifests,
    public.notification_result_bundle_members,
    public.notification_result_bundle_slots,
    public.notification_sent_logs,
    public.occupation_default_tags,
    public.occupations,
    public.pinned_users,
    public.sea_focus_totals,
    public.sea_reward_tiers,
    public.user_focus_tags,
    public.user_focus_time_settings,
    public.user_items,
    public.user_screen_time_settings,
    public.user_streaks,
    public.user_wallets;

-- 섬 행과 FK 연결을 유지한 채 테이블 이름만 변경한다.
ALTER TABLE public.groups RENAME TO islands;
