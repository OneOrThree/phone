import { Txt } from '@/design-system/patterns';
import { t } from '@/i18n';
import { useIslandPresence } from '@/screens/focus/useIslandPresence';
import { IslandPopup } from '@/screens/island/IslandSheet';
import { FinalIsland } from '@/screens/island/WorldMap';
import { confirmLeaveVisit, useVisitorJoin } from '@/screens/island/useVisitorJoin';
import { State, serverVisit, viewIsland } from '@/services/model';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

const visitScene = StyleSheet.create({ fill: { flex: 1 } });

export function VisitIsland({ e, onReturnFromVisit }: any) {
  const s: State = e.state,
    islandId = e.detail || s.visitingIslandId;
  // 서버 방문(GROMO-2259) — 구경하는 섬의 집중 중 인원·오늘 집중·하단 가입 버튼. 목업은 기존 화면 그대로.
  // 방문 스냅샷이 visitingIslandId 와 같은 섬의 것일 때만 쓴다 — HUD·presence·가입이 같은 섬을 본다.
  const visit = e.islands ? serverVisit(s) : null;
  const live = useIslandPresence({ active: !!visit, islandId: visit?.island.id ?? null });
  const join = useVisitorJoin(e, s, viewIsland(s, visit?.island.id ?? islandId), e.notify);
  // 섬장 인사말 말풍선(GROMO-2263) — 이번 방문(리듀서 visitGreeted)에 한 번만 띄운다. 게시판·낚시 구경에서 돌아와
  // 이 화면이 다시 마운트돼도 안 뜬다. 구서버는 greeting 이 없어 띄우지 않는다.
  const greeting = visit?.island.greeting?.trim();
  const [greetingOpen, setGreetingOpen] = useState(false);
  useEffect(() => {
    if (!greeting || s.visitGreeted) return;
    e.dispatch({ type: 'VISIT_GREETED' });
    setGreetingOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- e 는 매 렌더 새 객체다. 방문 여부(visitGreeted)만 본다
  }, [greeting, s.visitGreeted]);
  const showGreeting = greetingOpen && !!greeting;
  // 안드로이드 뒤로 가기: 인사말 팝업이 떠 있는 동안은 방문 종료(App 의 visitIsland 분기) 대신 팝업만 닫는다.
  // App 의 뒤로 가기 핸들러가 방문 분기보다 먼저 e.backOverride 를 본다(VisitorBoard 와 같은 방식).
  useEffect(() => {
    if (!showGreeting || !e.backOverride) return;
    const close = () => {
      setGreetingOpen(false);
      return true;
    };
    e.backOverride.current = close;
    return () => {
      // 이미 다른 화면이 자기 처리를 걸었으면 건드리지 않는다
      if (e.backOverride.current === close) e.backOverride.current = null;
    };
  }, [showGreeting, e.backOverride]);
  return (
    <>
      {/* 인사말 팝업이 열려 있는 동안 뒤 지도·가입 버튼은 스크린리더에서 숨긴다(DESIGN.md §11). iOS 는 팝업이 모달이라
          VoiceOver 가 이미 무시하고, 형제를 못 가리는 Android(TalkBack)를 이 래퍼가 맡는다. */}
      <View
        testID="visit-scene"
        style={visitScene.fill}
        accessibilityElementsHidden={showGreeting}
        importantForAccessibility={showGreeting ? 'no-hide-descendants' : 'auto'}
        aria-hidden={showGreeting}
      >
        <FinalIsland
          state={s}
          go={e.go}
          build={e.build}
          boardStatus={e.boardStatus}
          viewingIslandId={s.visitingIslandId ? undefined : islandId}
          notify={e.notify}
          dispatch={e.dispatch}
          onReturnFromVisit={onReturnFromVisit}
          visitHud={
            visit
              ? {
                  // HUD 는 지금 집중 중(active)만 센다. 응원 수신자는 서버 기준 진행 중(active·paused)이라 FocusVisit 와 다르다
                  focusCount:
                    live.status === 'ready'
                      ? live.focus.filter((m) => m.status === 'active').length
                      : null,
                  onFocusPress: () => e.go('visitIslandFocus', visit.island.id),
                  todayMinutes: visit.focusToday?.minutes,
                }
              : undefined
          }
          visitJoin={
            visit
              ? {
                  label: join.label,
                  disabled: join.disabled,
                  onPress: () => void join.serverJoin(),
                  // 「다시 바다로」(GROMO-2405) — 소속 섬 유무와 관계없이 구경을 끝내고 바다로. 가입하지 않은 사람에겐
                  // 뗏목 행선지와 같은 확인창을 한 번 띄운다. 소속 섬으로는 뗏목의 「< 소속 섬으로」가 있다.
                  onLeave: () =>
                    confirmLeaveVisit(e, s, visit, join, () => {
                      e.dispatch({ type: 'END_VISIT' });
                      e.reset('sea');
                    }),
                  // 가입 요청이 진행 중이면 떠나지 못하게 — 늦게 성공한 가입이 바다로 간 사용자를 홈으로 끌어오지 않게
                  leaveDisabled: join.busy,
                }
              : undefined
          }
        />
      </View>
      {showGreeting && (
        <IslandPopup onClose={() => setGreetingOpen(false)}>
          <Txt kind="meta">{t('islandVisit.greetingTitle')}</Txt>
          <Txt testID="visit-greeting" kind="h17">
            {greeting}
          </Txt>
        </IslandPopup>
      )}
    </>
  );
}
