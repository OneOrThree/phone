import { getGroupDetail, getMyGroups, groupErrorCode } from '@/services/groupApi';
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
  try {
    const profile = await getMyProfile();
    // /users/me가 다른 id를 돌려주는 것은 정상 계약이 아니다. 현재 세션을 성공으로 간주하지 않는다.
    if (profile.id !== userId) return { kind: 'retry' };
  } catch (error) {
    if (groupErrorCode(error) === 'NOT_FOUND') {
      // 토큰은 살아 있지만 users 활성 행이 없는 탈퇴/비활성 세션이다. 그룹 이탈 성공으로
      // 보이지 않고 호출자의 최신 요청·계정 확인 뒤 공통 세션 정리 경계로 넘긴다.
      return { kind: 'session_recovery' };
    }
    return { kind: 'retry' };
  }

  // 둘은 함께 시작해 느린 목록이 불명확 detail의 보조 증거가 될 수 있게 하되, detail만으로
  // 결론이 나면 목록을 기다리지 않는다. allSettled wrapper를 즉시 붙여 늦은 reject도 흡수한다.
  const detailPromise = Promise.allSettled([getGroupDetail(groupId, date)]).then(
    ([result]) => result,
  );
  const groupsPromise = Promise.allSettled([getMyGroups()]).then(([result]) => result);
  const detailResult = await detailPromise;

  if (detailResult.status === 'fulfilled') {
    if (detailResult.value.id === groupId) {
      return { kind: 'detail', detail: detailResult.value };
    }
  } else if (groupErrorCode(detailResult.reason) === 'MEMBER_ONLY') {
    return { kind: 'membership_absent' };
  }

  const groupsResult = await groupsPromise;

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
