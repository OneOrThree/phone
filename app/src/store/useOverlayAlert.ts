// 네이티브 Alert를 **전면 오버레이 조정자에 태우는** 공용 수단(GROMO-1576).
//
// ── 왜 자리마다 고치지 않고 여기 하나를 두는가 ────────────────────────────────
// 이 배치에서 같은 뿌리의 결함이 다섯 번 나왔다: 코치마크에 가린 채 ack · 비동기 시트가 한 프레임
// 뒤에 덮음 · 비활성 구간 노출 · 챌린지 카드의 삭제 확인 Alert · 그리고 그룹 흐름의 나머지 Alert들.
// 앞의 넷을 **자리마다** 고쳤더니 계속 새 자리가 나왔다. 그래서 마지막은 수단으로 닫는다 —
// 호출부를 이 훅으로 바꾸는 것만으로 같은 부류가 한꺼번에 닫히고, 다음에 Alert를 추가하는
// 사람도 이것만 쓰면 된다.
//
// ── 무엇이 문제인가 ──────────────────────────────────────────────────────────
// 네이티브 Alert는 RN Modal **위에** 뜬다. Alert가 떠 있는 동안 정산 결과가 도착하면 루트의
// 결과 모달이 그 **아래에서** 마운트되는데, 마운트되는 순간 로컬 seen 마커와 서버 ack이 나간다
// (둘 다 렌더 커밋 시점에 찍힌다 — 사용자가 인지한 시점이 아니다). 사용자는 아무것도 못 봤는데
// 그 회차는 "봤다"로 기록되고, 그 상태로 앱이 종료되면 **통지가 영구 유실**된다.
//
// ── 어떻게 막는가 ────────────────────────────────────────────────────────────
// Alert가 떠 있는 동안 sheet 우선순위로 slot을 **점유**한다. 그러면 결과 호스트는 "아직 노출 전"
// 규칙에 따라 스스로 물러나 마운트하지 않는다(ChallengeResultHost의 `yieldsSlot`).
// 점유는 **동기**다 — 승인을 기다리지 않는다. 사용자가 버튼을 눌러 여는 Alert는 그 시점에
// 전면 모달이 떠 있을 수 없고(누를 수가 없다), 기다리게 만들면 사용자의 탭이 한 박자 먹힌다.
// ⚠️ **비동기 응답이 여는 Alert**(조회가 끝난 뒤 뜨는 확인창)는 이 규칙의 예외다 — 그때는
//    결과가 먼저 slot을 쥘 수 있으므로 **승인을 받고 띄워야** 한다. 그 경로는 호출부가
//    `onRequestSheetSlot` 같은 승인 게이트를 직접 태운다(ChallengeCard의 삭제 확인).
//    판단 기준은 OverlaySlotContext 헤더의 A/B 문단과 같다: **여는 시점이 동기인가.**
import { useCallback, useState } from 'react';
import { Alert, type AlertButton } from 'react-native';
import { OVERLAY_PRIORITY, useOverlaySlot } from './OverlaySlotContext';

/**
 * `Alert.alert`과 **같은 시그니처**를 돌려준다 — 호출부는 함수 이름만 바꾸면 된다.
 *
 * ⚠️ 버튼을 넘기지 않으면 `[{ text: '확인' }]`을 대신 넣는다. 버튼이 없으면 닫힘을 알 방법이
 *    없어 slot을 영영 반납하지 못하기 때문이다(RN의 기본 버튼도 확인 하나라 보이는 것은 같다).
 *
 * @param id 조정자에 등록할 이름 — 화면마다 다르게 준다(같은 이름이 겹치면 서로를 덮는다).
 */
export function useOverlayAlert(id: string): typeof Alert.alert {
  // 떠 있는 Alert 수 — 0보다 크면 slot을 점유한다. 카운트인 이유: 실패 통보가 겹쳐 뜨는 경우
  // (요청 둘이 각각 실패) 하나를 닫았다고 나머지가 떠 있는데 자리를 놓으면 안 된다.
  const [openCount, setOpenCount] = useState(0);
  useOverlaySlot(id, { priority: OVERLAY_PRIORITY.sheet, active: openCount > 0 });

  return useCallback((title, message, buttons, options) => {
    setOpenCount((count) => count + 1);
    let released = false;
    const release = () => {
      if (released) return; // 버튼 하나당 한 번만 — 중복 반납이 카운트를 음수로 만들지 않게
      released = true;
      setOpenCount((count) => Math.max(0, count - 1));
    };
    // 버튼이 없으면 RN이 확인 하나를 그린다 — 우리가 같은 것을 명시해 **닫힘 콜백을 얻는다.**
    const list: AlertButton[] = buttons && buttons.length > 0 ? buttons : [{ text: '확인' }];
    const wrapped = list.map((button) => ({
      ...button,
      onPress: (value?: string) => {
        release();
        (button.onPress as ((value?: string) => void) | undefined)?.(value);
      },
    }));
    // ⚠️ `options`는 **호출부가 준 경우에만** 넘긴다. 없는데 지어내면 호출 인자 수가 바뀌어,
    //    Alert 호출을 단언하는 기존 테스트가 무더기로 깨진다(동작은 그대로인데).
    if (options === undefined) Alert.alert(title, message, wrapped);
    else Alert.alert(title, message, wrapped, options);
  }, []);
}
