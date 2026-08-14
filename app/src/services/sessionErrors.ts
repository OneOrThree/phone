import { Alert } from 'react-native';
import { getAuthSessionGeneration, triggerLogout } from '@/services/api';
import { OVERLAY_PRIORITY, getOverlaySlotActions } from '@/store/OverlaySlotContext';

// 이 안내가 떠 있는 동안 점유할 자리의 이름.
const SESSION_EXPIRED_SLOT_ID = 'session.expired';

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
// ⚠️ `requestSessionGeneration` 은 **요청을 띄우기 직전**의 `getAuthSessionGeneration()` 이다.
//    필수 인자로 둔 이유: 빠뜨리면 조용히 틀리기 때문이다. 게스트→소셜 승격(triggerRelogin)이
//    이 응답 **뒤에** 완료되면 죽은 세션의 404가 **새로 성립한 세션**을 로그아웃시키고,
//    막더라도 방금 로그인한 사용자에게 만료 안내가 뜬다(아래 ①②가 각각 막는다).
//    세대는 '낡아서 버릴 값'이 아니라 **이 응답이 어느 세션의 것인지 식별하는 표식**이다 —
//    세대가 그대로면(= 아직 그 세션) 로그아웃이 정상 실행되고, 바뀌었으면 App.tsx의 로그아웃
//    핸들러가 스스로 무시한다(api.ts triggerLogout 계약 · groupRoomNotFound.ts 선례).
//    ⤷ 확인 버튼까지 시간이 열려 있다는 사실이 오히려 세대를 넘겨야 할 이유다. 그 사이가
//      정확히 세션이 교체될 수 있는 구간이다.
//    ⤷ GROMO-1241 이 세대 없이 부른 것은 의도가 아니라 **순서**다: `triggerLogout` 의
//      `expectedGeneration` 파라미터 자체가 GROMO-1481(#597, 2026-08-11)에서 생겼고
//      1241(#530)은 2026-08-08 이라 넘길 인자가 없었다. 따라서 예외를 둘 근거가 아니다.
// ⚠️ cancelable:false — iOS는 바깥 탭 닫기가 없지만, 취소 불가 의도를 명시해 두면 안드로이드
//    지원 시 백 버튼 무콜백 닫힘(로그아웃 미실행 잔류)을 막는다(#530 codex 리뷰).
// ⚠️ 로그아웃을 버튼 핸들러에서 부르는 건 사용자가 안내를 읽고 확인한 뒤 세션을 정리하는 UX
//    순서다. 로그아웃 언마운트는 App.tsx의 user state 스왑(최상위 조건부 렌더)이라 화면의
//    beforeRemove 가드·진행 중 요청과 무관하다(#530 claude 리뷰).
export function promptSessionExpired(requestSessionGeneration: number): void {
  // ① **띄우기 전** — 이 응답이 이미 지난 세션의 것이면 조용히 버린다. 게스트→소셜 승격이
  //    응답과 안내 사이에 끝나면, 방금 로그인에 성공한 사용자에게 "로그인 정보가 만료됐어요"가
  //    뜨고 cancelable:false라 확인 말고는 닫을 수도 없다. 로그아웃은 ②가 막지만 **안내 자체가
  //    거짓말**이다. 새 세션에서 그 요청은 애초에 무의미하므로 화면은 아무 안내 없이 둔다.
  if (getAuthSessionGeneration() !== requestSessionGeneration) return;
  // ── 떠 있는 동안 전면 오버레이 자리를 점유한다(GROMO-1576) ──────────────────
  // 이 안내는 **호출부가 이미 쥔 등록 위에** 얹힌다(시트·화면이 결과 모달을 막고 있는 상태).
  // 그런데 그 등록은 **배경 이벤트로 사라질 수 있다** — 초대 딥링크가 그룹 찾기 시트를 닫거나,
  // BET_RESULT 재조회가 챌린지 카드를 목록에서 빼거나, 방 이탈이 작성 시트를 내리는 경우다.
  // 그때 이 Alert는 네이티브 표면이라 그대로 떠 있는데 자리는 비어, 결과 모달이 **이 안내
  // 뒤에서** 마운트되며 사용자가 못 본 회차에 seen/ack이 찍힌다.
  // 그래서 자리를 **이 안내 자신이** 쥔다 — 그러면 아래의 어떤 배경 이벤트도 창을 못 만든다.
  // 호출부 6곳을 각각 고치지 않고 여기 한 곳에서 닫는 이유이기도 하다.
  //
  // ⚠️ 승인을 **기다리지 않는다**(request이지 acquire가 아니다). 기다리면 호출부의 시트가
  //    자리를 쥔 흔한 경우에 그 시트가 닫힐 때까지 안내가 안 뜨고, 사용자는 죽은 세션에
  //    갇힌 채 이유를 모른다. "이미 자기 쪽이 자리를 쥐고 있으면 기다릴 이유가 없다"는
  //    GroupCreateScreen에서 세운 것과 같은 판단이다.
  // ⚠️ 반납 경로는 둘 다 잇는다 — 확인 버튼과 `onDismiss`(Android의 dismissExisting은 버튼
  //    콜백을 건너뛴다). 네이티브 Alert는 사용자가 닫아야만 사라지므로 영구 점유가 아니다.
  const actions = getOverlaySlotActions();
  actions?.request(SESSION_EXPIRED_SLOT_ID, OVERLAY_PRIORITY.sheet);
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    actions?.release(SESSION_EXPIRED_SLOT_ID);
  };
  Alert.alert(
    '로그인이 필요해요',
    '로그인 정보가 만료됐어요. 다시 로그인해 주세요.',
    [
      // ② **확인 시점** — ①을 통과했어도 안내를 읽는 사이 세션이 교체될 수 있다. 세대를 넘겨
      //    App.tsx 로그아웃 핸들러가 스스로 대조하게 한다. 두 검사는 **다른 구간**을 막는다:
      //    ①은 응답→표시 구간, ②는 표시→확인 구간. 하나로 합칠 수 없다.
      {
        text: '확인',
        onPress: () => {
          release();
          triggerLogout(requestSessionGeneration);
        },
      },
    ],
    { cancelable: false, onDismiss: release },
  );
}
