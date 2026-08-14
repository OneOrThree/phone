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
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Alert, type AlertButton } from 'react-native';
import { readCurrentRouteKey, subscribeCurrentRoute } from '@/navigation/navigationRef';
import { OVERLAY_PRIORITY, useOverlaySlotActions } from './OverlaySlotContext';

/**
 * `Alert.alert`과 **같은 시그니처**를 돌려준다 — 호출부는 함수 이름만 바꾸면 된다.
 *
 * ⚠️ 버튼을 넘기지 않으면 `[{ text: '확인' }]`을 대신 넣는다. 버튼이 없으면 닫힘을 알 방법이
 *    없어 slot을 영영 반납하지 못하기 때문이다(RN의 기본 버튼도 확인 하나라 보이는 것은 같다).
 *
 * @param id 조정자에 등록할 이름 — 화면마다 다르게 준다(같은 이름이 겹치면 서로를 덮는다).
 */
export function useOverlayAlert(id: string): typeof Alert.alert & {
  /** `await` 뒤에 여는 Alert 전용 — 승인을 받고 띄운다(아래 showAfterSlot 주석). */
  afterSlot: (
    title: string,
    message?: string,
    buttons?: AlertButton[],
    options?: Parameters<typeof Alert.alert>[3],
  ) => Promise<void>;
} {
  // ⚠️ 점유는 **명령형**이다. state로 잡으면 `setState → 렌더 → layout effect` 순서라
  //    `Alert.alert()`이 이미 떠 있는 뒤에 등록된다 — 그 창이 정확히 이 배치가 반복해서
  //    물린 자리다. 그래서 **여는 줄 바로 앞에서** 동기로 잡는다.
  const actions = useOverlaySlotActions();
  // 떠 있는 Alert 수. 카운트인 이유: 실패 통보가 겹쳐 뜨는 경우(요청 둘이 각각 실패)
  // 하나를 닫았다고 나머지가 떠 있는데 자리를 놓으면 안 된다.
  const openCountRef = useRef(0);
  // 승인을 기다리는 afterSlot 요청들의 취소 손잡이. **떠 있는 Alert와 별도로** 센다 —
  // 언마운트·blur가 접어야 할 것은 이쪽뿐이다(아래 두 주석).
  const pendingCancelsRef = useRef(new Set<() => void>());
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  // 떠 있는 Alert가 없을 때만 등록을 접는다 — 대기 요청을 접는 모든 경로가 이걸 쓴다.
  const releaseIfIdle = useCallback(() => {
    if (openCountRef.current === 0) actionsRef.current?.release(id);
  }, [id]);

  // ── 화면이 사라질 때 ────────────────────────────────────────────────────────
  // ⚠️ **떠 있는 Alert의 자리는 유지한다.** `showAlert(...)` 직후 `goBack()`을 부르는 화면이
  //    있는데(GroupOwnerTransferScreen의 실패 경로), 네이티브 Alert는 화면이 언마운트돼도
  //    그대로 떠 있다. 여기서 자리를 반납하면 그 **Alert 뒤에서** 결과 호스트가 모달을 마운트하고
  //    사용자가 못 본 회차에 seen/ack이 찍힌다 — 이 배치가 반복해서 물린 바로 그 결함이다.
  //    그래서 반납 주체를 화면에서 **Alert 자신**으로 옮긴다: 버튼 또는 onDismiss가 반납한다.
  //    영구 점유가 되지 않는 근거 — (a) 버튼을 안 넘기면 우리가 `확인` 하나를 넣으므로 닫힘
  //    콜백이 **항상** 존재하고, (b) `onDismiss`도 항상 이어 Android의 dismissExisting까지 받고,
  //    (c) 네이티브 Alert는 사용자가 닫아야만 사라진다(바깥 탭으로 닫히지 않는다).
  //    앱이 죽어 콜백이 영영 안 오는 경우는 프로세스와 함께 자리도 사라져 문제가 되지 않는다.
  //    반면 **승인 대기 중인 요청은 취소한다** — 떠난 화면의 Alert가 새 화면 위로 뜨면 안 된다.
  useEffect(
    () => () => {
      const cancels = Array.from(pendingCancelsRef.current);
      pendingCancelsRef.current.clear();
      cancels.forEach((cancel) => cancel());
      releaseIfIdle();
    },
    [releaseIfIdle],
  );

  const show: typeof Alert.alert = useCallback(
    (
      title: string,
      message?: string,
      buttons?: AlertButton[],
      options?: Parameters<typeof Alert.alert>[3],
    ) => {
      openCountRef.current += 1;
      actionsRef.current?.request(id, OVERLAY_PRIORITY.sheet);
      let released = false;
      const release = () => {
        if (released) return; // 한 Alert당 한 번만 — 중복 반납이 카운트를 음수로 만들지 않게
        released = true;
        openCountRef.current = Math.max(0, openCountRef.current - 1);
        if (openCountRef.current === 0) actionsRef.current?.release(id);
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
      // ⚠️ `onDismiss`도 **항상** 잇는다. Android의 DialogModule은 새 Alert를 띄울 때 기존 것을
      //    `dismissExisting()`으로 닫는데, 그때 **버튼 콜백 대신 onDismiss만** 부른다. 이걸
      //    안 이으면 대체된 첫 Alert의 카운트가 영영 안 줄어 자리가 남는다.
      Alert.alert(title, message, wrapped, {
        ...options,
        onDismiss: () => {
          release();
          options?.onDismiss?.();
        },
      });
    },
    [id],
  );

  // ── 비동기 변형 ──────────────────────────────────────────────────────────
  // `await` 뒤(요청 실패 등)에 여는 Alert는 **승인을 받고** 띄운다. 여는 시점을 응답이 정하므로
  // 기다리는 사이 결과 모달이 먼저 노출될 수 있고, 그러면 우리가 그 **위를** 덮는다 —
  // 사용자는 못 봤는데 seen/ack은 이미 찍힌 상태가 된다.
  // 승인 전에 화면이 사라지면(언마운트) 띄우지 않는다 — 떠난 화면의 Alert가 새 화면 위로 뜨지 않게.
  // ⚠️ 그런데 **native-stack은 위로 화면이 쌓여도 아래 화면을 언마운트하지 않는다.** 대기 도중
  //    푸시·딥링크가 새 화면을 push하면 이 훅의 정리 함수는 돌지 않고, 나중에 자리가 풀리면
  //    **이미 떠난 화면의 실패 Alert가 지금 화면 위에** 뜬다. 공유 시트에서 호출부마다 막았던
  //    것과 같은 결함이라, 여기서는 수단 자신이 막는다 — 요청 시점의 **라우트 키**를 들고 있다가
  //    (push마다 새로 발급된다) 달라지면 대기를 취소한다. 승인과 이동이 같은 틱에 겹칠 수 있어
  //    띄우기 **직전에 한 번 더** 본다.
  const showAfterSlot = useCallback(
    async (
      title: string,
      message?: string,
      buttons?: AlertButton[],
      options?: Parameters<typeof Alert.alert>[3],
    ): Promise<void> => {
      const slotActions = actionsRef.current;
      if (slotActions === null) {
        show(title, message, buttons, options);
        return;
      }
      let canceled = false;
      const cancel = () => {
        canceled = true;
        // ⚠️ 대기만 접는다 — 같은 id로 **떠 있는** Alert가 쥔 자리는 건드리지 않는다.
        releaseIfIdle();
      };
      pendingCancelsRef.current.add(cancel);
      const routeAtRequest = readCurrentRouteKey();
      const unsubscribe = subscribeCurrentRoute(() => {
        if (canceled || readCurrentRouteKey() === routeAtRequest) return;
        cancel();
      });
      try {
        const granted = await slotActions.acquire(id, OVERLAY_PRIORITY.sheet);
        if (canceled || !granted) {
          if (granted) releaseIfIdle();
          return;
        }
        if (readCurrentRouteKey() !== routeAtRequest) {
          releaseIfIdle();
          return;
        }
        show(title, message, buttons, options);
      } finally {
        unsubscribe();
        pendingCancelsRef.current.delete(cancel);
      }
    },
    [id, releaseIfIdle, show],
  );

  return useMemo(() => Object.assign(show, { afterSlot: showAfterSlot }), [show, showAfterSlot]);
}
