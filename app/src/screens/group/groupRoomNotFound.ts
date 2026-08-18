import { getAuthSessionGeneration, triggerLogout } from '@/services/api';
import { getGroupDetail, getMyGroups, groupErrorCode } from '@/services/groupApi';
import { USER_NOT_FOUND } from '@/services/sessionErrors';
import { getMyProfile } from '@/services/userApi';
import type { GroupDetailResponse } from '@/types/dto/group';

export type GroupRoomNotFoundResolution =
  | { kind: 'detail'; detail: GroupDetailResponse }
  | { kind: 'membership_absent' }
  | { kind: 'session_recovery' }
  | { kind: 'retry' };

// getGroupDetail의 NOT_FOUND는 서버에서 활성 사용자 부재와 그룹 부재가 같은 code를 쓴다.
// 따라서 소속 없음으로 바로 수렴하지 않고, 인증 정본을 먼저 확인한 뒤 최신 detail/전체 목록으로
// scope를 좁힌다. 재확인 실패나 서로 모순된 응답은 성공으로 추정하지 않고 retry에 남긴다.
export async function resolveGroupRoomNotFound({
  groupId,
  date,
  userId,
}: {
  groupId: string;
  date: string;
  userId: string;
}): Promise<GroupRoomNotFoundResolution> {
  // 재확인 도중 같은 UUID의 게스트→소셜 승격이 완료될 수 있다. userId 비교만으로는 구분되지
  // 않으므로 요청 시작 세대를 로그아웃 경계까지 전달해 오래된 NOT_FOUND를 폐기한다.
  const requestSessionGeneration = getAuthSessionGeneration();
  try {
    const profile = await getMyProfile();
    // /users/me가 다른 id를 돌려주는 것은 정상 계약이 아니다. 현재 세션을 성공으로 간주하지 않는다.
    if (profile.id !== userId) return { kind: 'retry' };
  } catch (error) {
    // 신구 코드를 병기한다(GROMO-1247) — 서버가 유저 부재를 USER_NOT_FOUND로 나누면 /users/me도
    // 그 코드로 답한다. NOT_FOUND만 보면 그 순간부터 이 재확인이 세션 이상을 영영 못 알아채고
    // 'retry'로만 수렴한다(무한 재시도). 반대로 브리지 기간엔 NOT_FOUND가 계속 온다.
    const code = groupErrorCode(error);
    if (code === 'NOT_FOUND' || code === USER_NOT_FOUND) {
      // 토큰은 살아 있지만 users 활성 행이 없는 탈퇴/비활성 세션이다. 그룹 이탈 성공으로
      // 보이지 않고 앱의 공통 세션 정리 경계로 넘긴다.
      triggerLogout(requestSessionGeneration);
      return { kind: 'session_recovery' };
    }
    return { kind: 'retry' };
  }

  const [detailResult, groupsResult] = await Promise.allSettled([
    getGroupDetail(groupId, date),
    getMyGroups(),
  ]);

  if (detailResult.status === 'fulfilled') {
    if (detailResult.value.id === groupId) {
      return { kind: 'detail', detail: detailResult.value };
    }
  } else if (groupErrorCode(detailResult.reason) === 'MEMBER_ONLY') {
    return { kind: 'membership_absent' };
  }

  // 성공한 전체 목록에서 target이 사라졌다면 그룹 부재·미소속 scope가 확정된다.
  // target이 남아 있거나 목록을 못 받았으면 detail 실패와 모순/불명 상태라 retry한다.
  if (
    groupsResult.status === 'fulfilled' &&
    Array.isArray(groupsResult.value) &&
    !groupsResult.value.some((group) => group.groupId === groupId)
  ) {
    return { kind: 'membership_absent' };
  }

  return { kind: 'retry' };
}
