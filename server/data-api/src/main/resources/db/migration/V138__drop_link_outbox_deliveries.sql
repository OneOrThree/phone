-- ════════════════════════════════════════════════════════════════════
-- V138 — 받는 서버가 없는 LINK 전달 행 정리 (GROMO-2407) — 데이터만, DDL 없음
-- ════════════════════════════════════════════════════════════════════
-- data-api relay 는 link.* 7종을 LINK_BASE_URL 의 /internal/events 로 보냈지만 그 경로를 구현한 서버가 없다
-- (A23). 그래서 LINK 전달은 전부 영구 실패로 최대 백오프까지 재시도되며 쌓였다. 같은 변경에서 application-satellites.yml 의
-- link.* endpoint 를 모두 걷어 relay 가 LINK 행을 더는 집지 않는다(SCORE 와 같은 «적고 보내지 않는» 대상).
--
-- 시도했다 실패한 LINK 행(attempt_count > 0)은 탈퇴자 표시 이름 파기(eraseParamOfResendSafe)에서 «다시 나가야 하는 행» 으로
-- 빠진다. 그 payload 의 inviterDisplayName 이 파기되지 않고 남으므로, 더 보낼 곳이 없는 지금 행째 지운다.
--
-- ① LINK 전달 행을 모두 지운다. 이후에 적히는 LINK 행(producer 는 링크 구현 PR, LLD §9.2 까지 유지)은 이 정리의 대상이 아니다.
-- ② ① 로 전달 행이 하나도 안 남은 봉투를 지운다. 대상은 LINK 전달만 만드는 사건 종류로 한정한다 — 목록은
--    LinkMembershipEventService 의 EVENT_* 5종과 InternalInviteLinkService.EVENT_CLAIM_CONFIRMED 다.
--    다른 대상의 전달이 하나라도 남은 봉투는 NOT EXISTS 가 막는다.
--
-- 일부러 남기는 것:
--   · user.withdrawn — LINK 말고 KAFKA·REALTIME·SCORE 전달이 같은 봉투에 달려 있어 목록에 넣지 않는다(① 로 LINK 행만 빠진다).
--   · 종류 제한 없는 «전달 행 없는 봉투» 일괄 삭제는 하지 않는다 — focus.golden 은 전달 행이 없는 채로
--     FocusFishPayoutQuery 가 통계 원장으로 읽는다.
-- aggregate_versions 는 건드리지 않는다. 지운 봉투가 비운 version 은 «단조 증가» 만 요구하는 소비자와 relay 에 영향이 없다(A21 ①).

DELETE FROM public.event_outbox_deliveries
WHERE target = 'LINK';

DELETE FROM public.event_outbox o
WHERE o.type IN (
        'link.revoked',
        'link.joined',
        'group.closed',
        'group.renamed',
        'user.displayNameChanged',
        'link.claimConfirmed')
  AND NOT EXISTS (
        SELECT 1 FROM public.event_outbox_deliveries d
        WHERE d.outbox_id = o.id);
