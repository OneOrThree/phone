import { ApiError, CLIENT_STALE_SESSION } from '@/services/api/client';

/** 섬 진입·가입·선택에서 사용하는 사용자 안내. 서버 내부 문구는 그대로 노출하지 않는다. */
export function islandErrorMessage(error: unknown, facility?: 'board' | 'tower'): string {
  if (!(error instanceof ApiError)) return '연결을 확인한 뒤 다시 시도해 주세요.';
  const messages: Record<string, string> = {
    [CLIENT_STALE_SESSION]: '',
    SESSION_IN_PROGRESS: '집중이나 휴식을 마친 뒤 섬을 이동해 주세요.',
    OBSERVATORY_LOCKED: '현재 섬의 전망대를 완공한 뒤 이동할 수 있어요.',
    FACILITY_LOCKED:
      facility === 'board'
        ? '게시판을 완공한 뒤 이용할 수 있어요.'
        : facility === 'tower'
          ? '현재 섬의 전망대를 완공한 뒤 이동할 수 있어요.'
          : '시설을 완공한 뒤 이용할 수 있어요.',
    MEMBER_ONLY: '이 섬의 주민만 이용할 수 있어요. 소속을 다시 확인해 주세요.',
    BOARD_LOCKED: '게시판을 완공한 뒤 이용할 수 있어요.',
    LIBRARY_LOCKED: '도서관을 완공한 뒤 이용할 수 있어요.',
    NOT_FOUND: '더 이상 볼 수 없는 내용이에요. 다시 불러와 주세요.',
    GROUP_NOT_FOUND: '더 이상 이용할 수 없는 섬이에요. 다른 섬을 선택해 주세요.',
    GROUP_FULL: '섬의 정원이 찼어요. 다른 섬을 선택해 주세요.',
    GROUP_LIMIT_EXCEEDED: '가입할 수 있는 섬 수를 모두 채웠어요.',
    SLUG_NOT_FOUND: '초대 코드를 다시 확인해 주세요.',
    INVITATION_EXPIRED: '만료된 초대예요. 새 초대를 받아 주세요.',
    STATE_CONFLICT: '섬 정보가 바뀌었어요. 최신 상태로 다시 시도해 주세요.',
    VERSION_CONFLICT: '섬 정보가 바뀌었어요. 최신 상태로 다시 시도해 주세요.',
    REQUEST_IN_PROGRESS: '처리 중이에요. 잠시 뒤 다시 시도해 주세요.',
    FORBIDDEN: '이 작업을 할 권한이 없어요. 소속을 다시 확인해 주세요.',
  };
  return messages[error.code] ?? '연결을 확인한 뒤 다시 시도해 주세요.';
}
