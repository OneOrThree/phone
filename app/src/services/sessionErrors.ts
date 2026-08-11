import { Alert } from 'react-native';
import { triggerLogout } from '@/services/api';

// 유저 부재(활성 users 행 없음) 전용 서버 코드와 **그 유일한 처방**을 한자리에 둔다(GROMO-1247).
//
// 왜 도메인 래퍼(groupApi.ts)가 아닌가 — 이 코드는 그룹 계약이 아니라 모든 도메인의 공통 전제다.
// 서버는 요청자 조회(requireActiveUser)에서 던지므로 group·focus·league 어느 엔드포인트에서도
// 오고, 앱의 처방도 화면별 문구가 아니라 **세션 정리** 하나뿐이다. groupApi에 두면 다른 도메인이
// 이 코드를 다룰 때 그룹 모듈을 import하게 되고, 처방은 호출부마다 다시 쓰이며 갈린다 —
// 지금 9곳이 유저 부재를 "사라진 그룹"이라고 말하는 그 갈림이 정확히 그렇게 생겼다.
export const USER_NOT_FOUND = 'USER_NOT_FOUND';

// ⚠️ 기존 'NOT_FOUND'는 어디서도 지우지 않는다. 서버가 코드를 나누기 **전에 앱이 먼저 배포**되므로
//    브리지 기간엔 유저 부재가 여전히 NOT_FOUND로 온다 — 화면은 두 코드를 병기해 분기하고,
//    그룹/챌린지 부재 쪽 문구·동작은 그대로 둔다.

// 유저 부재 안내 — 문구·형태는 GROMO-1241(GroupCreateScreen)이 세운 정본 그대로다.
// 유효 JWT라 401 인터셉터도 안 타고 재시도로 절대 안 풀린다. 유일한 탈출구가 재로그인이라
// 취소 없는 단일 확인으로 로그아웃까지 유도한다(AccountScreen 탈퇴 성공 경로의 triggerLogout 선례).
//
// ⚠️ cancelable:false — iOS는 바깥 탭 닫기가 없지만, 취소 불가 의도를 명시해 두면 안드로이드
//    지원 시 백 버튼 무콜백 닫힘(로그아웃 미실행 잔류)을 막는다(#530 codex 리뷰).
// ⚠️ 로그아웃을 버튼 핸들러에서 부르는 건 사용자가 안내를 읽고 확인한 뒤 세션을 정리하는 UX
//    순서다. 로그아웃 언마운트는 App.tsx의 user state 스왑(최상위 조건부 렌더)이라 화면의
//    beforeRemove 가드·진행 중 요청과 무관하다(#530 claude 리뷰).
// ⚠️ 세대(triggerLogout(expectedGeneration))는 넘기지 않는다 — 확인 탭까지 시간이 열려 있어
//    요청 시각의 세대는 이미 낡았다. 요청 응답만으로 자동 로그아웃하는 경로(groupRoomNotFound)만
//    세대를 넘긴다.
export function promptSessionExpired(): void {
  Alert.alert(
    '로그인이 필요해요',
    '로그인 정보가 만료됐어요. 다시 로그인해주세요.',
    [{ text: '확인', onPress: () => triggerLogout() }],
    { cancelable: false },
  );
}
