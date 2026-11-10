import { ApiError, CLIENT_STALE_SESSION } from '@/services/api/client';
import { t, errorText } from '@/i18n';

/** 섬 진입·가입·선택에서 사용하는 사용자 안내. 서버 내부 문구는 그대로 노출하지 않는다. */
export function islandErrorMessage(error: unknown, facility?: 'board' | 'tower'): string {
  if (!(error instanceof ApiError)) return t('errors.GENERIC');
  const messages: Record<string, string> = {
    [CLIENT_STALE_SESSION]: '',
    SESSION_IN_PROGRESS: t('islandPicker.sessionBlocksMove'),
    OBSERVATORY_LOCKED: t('ui.policy.complete_the_observatory_on_your_cur_bab29'),
    FACILITY_LOCKED:
      facility === 'board'
        ? t('ui.policy.complete_the_notice_board_to_use_thi_5b3c1')
        : facility === 'tower'
          ? t('ui.policy.complete_the_observatory_on_your_cur_bab29')
          : t('ui.policy.complete_this_facility_to_use_it_819e3'),
    MEMBER_ONLY: t('ui.policy.only_residents_can_use_this_feature__a936e'),
    BOARD_LOCKED: t('ui.policy.complete_the_notice_board_to_use_thi_5b3c1'),
    LIBRARY_LOCKED: t('ui.policy.complete_the_library_to_use_this_fea_689e9'),
    NOT_FOUND: t('ui.policy.this_content_is_no_longer_available__6668a'),
    GROUP_NOT_FOUND: t('ui.policy.this_island_is_no_longer_available_c_fc2cd'),
    GROUP_FULL: t('ui.policy.this_island_is_full_choose_another_i_57617'),
    GROUP_LIMIT_EXCEEDED: t('ui.policy.you_have_reached_the_limit_for_joine_8eb75'),
    SLUG_NOT_FOUND: t('errors.SLUG_NOT_FOUND'),
    INVITATION_EXPIRED: t('errors.INVITATION_EXPIRED'),
    STATE_CONFLICT: t('errors.STATE_CONFLICT'),
    VERSION_CONFLICT: t('errors.STATE_CONFLICT'),
    REQUEST_IN_PROGRESS: t('errors.REQUEST_IN_PROGRESS'),
    ISLAND_NOT_ARRIVED: t('errors.ISLAND_NOT_ARRIVED'),
    // 망원경 [바로 가입]의 409(GROMO-2266) — 서버 문구와 같은 글을 JSON 한 곳에서 가져온다.
    ISLAND_LIMIT_EXCEEDED: t('errors.ISLAND_LIMIT_EXCEEDED'),
    FORBIDDEN: t('ui.policy.you_do_not_have_permission_to_do_thi_8b172'),
  };
  return messages[error.code] ?? errorText(error);
}
