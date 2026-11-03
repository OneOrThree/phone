import { Btn, Txt } from '@/design-system/patterns';
import { semanticTokens } from '@/design-system/tokens';
import { t } from '@/i18n';
import { type HomeChatLine, HomeChatLog } from '@/screens/island/HomeChatLog';
import { IslandNamingModal } from '@/screens/island/IslandNamingModal';
import { GuideBox } from '@/screens/island/NpcGuide';
import { FinalIsland } from '@/screens/island/WorldMap';
import { MagazineHomeLayer } from '@/screens/magazine/MagazineDelivery';
import { magazineUnread } from '@/screens/magazine/useMagazineToday';
import { residentCount, serverHome } from '@/services/model';
import { captureProductEvent } from '@/services/posthog';
import { useEffect } from 'react';
import { View } from 'react-native';
import { H17, Spinner } from './navigation/screenParts';
import type { ScreenContext } from './navigation/useScreenState';

// 몽돌 도착 안내의 각 줄 노출을 줄마다 1회 발행한다 — route 분기 안이라 훅을 못 써 컴포넌트로 둔다.
function GuideViewed({ variant, step }: { variant: 'empty' | 'joined'; step: number }) {
  useEffect(() => {
    captureProductEvent('island_guide_viewed', { variant, step });
  }, [variant, step]);
  return null;
}
export function renderHomeScreens(context: ScreenContext) {
  const {
    route,
    island,
    guideStep,
    layout,
    backgroundHome,
    ins,
    setGuideStep,
    home,
    server,
    state,
    e,
    naming,
    magazinePrompt,
    go,
    build,
    notify,
    dispatch,
    friendsScreen,
    setMagazinePrompt,
  } = context;

  if (route === 'guide') {
    // 도착 섬에 다른 주민이 없으면(나뿐) 되살리기 서사, 있으면 환영 서사로 몽돌 인사를 가른다.
    // members 는 서버 모드에서 항상 빈 배열이라(주민 수는 serverMemberCount) residentCount 로 전체 주민을 센다
    const guideEmpty = residentCount(island) <= 1;
    const lines = guideEmpty
      ? [
          t('onboarding.guide.empty.line1'),
          t('onboarding.guide.empty.line2'),
          t('onboarding.guide.empty.line3'),
          t('onboarding.guide.empty.line4'),
        ]
      : [
          t('onboarding.guide.joined.line1'),
          t('onboarding.guide.joined.line2'),
          t('onboarding.guide.joined.line3'),
        ];
    const step = Math.min(guideStep, lines.length - 1),
      last = step === lines.length - 1,
      w = layout.compact ? Math.min(layout.floatingWidth, 414) : layout.floatingWidth;
    return (
      <View style={{ flex: 1 }}>
        {backgroundHome}
        <GuideViewed variant={guideEmpty ? 'empty' : 'joined'} step={step + 1} />
        <GuideBox
          text={lines[step]}
          style={{
            left: (layout.width - w) / 2,
            width: w,
            // v2 가로 guidebox는 아래 18px
            bottom: layout.compact ? 18 : ins.bottom + 12,
          }}
          onSkip={() => {
            setGuideStep(99);
            home();
          }}
          skipTitle={t('onboarding.guide.skip')}
        >
          <Btn
            title={last ? t('onboarding.guide.last') : t('onboarding.guide.next')}
            small
            style={{ minWidth: 96 }}
            onPress={() => {
              if (last) {
                setGuideStep(4);
                home();
              } else setGuideStep(step + 1);
            }}
          />
        </GuideBox>
      </View>
    );
  }

  // 서버 모드 홈은 스냅샷이 올 때까지 로컬 목업 섬 대신 로딩·재시도를 보여 준다(GROMO-2138)
  if (route === 'home' && server && !serverHome(state))
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          gap: semanticTokens.spacing.control,
          padding: semanticTokens.spacing.page,
        }}
      >
        {e.homeError ? (
          <>
            <Txt style={H17}>{t('home.error.loadFailed')}</Txt>
            <Btn kind="ghost" id="home-retry" title={t('common.retry')} onPress={e.retryHome} />
          </>
        ) : (
          <Spinner reduce={state.settings.reduceMotion} />
        )}
      </View>
    );

  if (route === 'home') {
    // naming(= 이름 짓기 모달 트리거)은 위에서 구했다 — 편지 차단 신호와 같은 값을 쓴다(GROMO-2649).
    // 최근 채팅 줄(GROMO-2501) — 서버는 섬 채팅 훅, 목업은 로컬 섬 글(최신 것부터라 뒤집는다).
    // 안내창(회관·펠리컨·튜토리얼)·집중·구경·화면 전환 중에는 비킨다
    const chatLines: HomeChatLine[] = server
      ? (e.islandChat?.messages ?? []).map((m: any) => ({
          id: m.id,
          name: m.name ?? t('islandChat.unknown'),
          text: m.text,
          at: Date.parse(m.createdAt),
        }))
      : [...island.messages].reverse().map((m) => ({
          id: m.id,
          name: m.name,
          text: m.text,
          at: m.at,
        }));
    const chatBlocked =
      naming ||
      magazinePrompt ||
      guideStep === 4 ||
      !!state.session ||
      !!state.visitingIslandId ||
      !!e.routeTransitionShielded;
    const home = (
      <View style={{ flex: 1 }}>
        <FinalIsland
          state={state}
          go={go}
          build={build}
          request={e.walkRequest}
          notify={notify}
          dispatch={dispatch}
          focusTutorial={
            guideStep === 4
              ? {
                  text: t('home.tutorial.focusStart'),
                  onPress: () =>
                    setGuideStep(5, { step: 4, revision: state.tutorialRevision ?? 0 }),
                  onSkip: () => setGuideStep(99),
                }
              : undefined
          }
          friendRequestCount={
            server
              ? friendsScreen?.status === 'ready'
                ? (friendsScreen.data?.friendRequests.length ?? 0)
                : 0
              : undefined
          }
          boardStatus={e.boardStatus}
          libraryState={state.visitingIslandId ? 'normal' : e.buildingIndicators?.libraryState}
          showMailboxLetters={e.buildingIndicators?.showMailboxLetters}
          showMailboxMagazine={magazineUnread(e.magazineToday ?? null)}
          onServerBuilt={e.islands ? e.retryHome : undefined}
          homeChat={
            chatBlocked ? undefined : (
              <HomeChatLog
                // 섬이 바뀌면 다시 마운트해 3초 기준선과 띄운 줄을 새로 잡는다(GROMO-2678)
                key={state.serverIslands?.currentIslandId ?? 'local'}
                lines={chatLines}
                pending={server && !!e.islandChat?.loading}
                onOpen={() => go('chat')}
              />
            )
          }
        />
        <MagazineHomeLayer
          today={e.magazineToday ?? null}
          hasMailbox={island.buildings.includes('mail')}
          blocked={
            naming ||
            guideStep === 4 ||
            !!state.session ||
            !!state.visitingIslandId ||
            !!e.routeTransitionShielded ||
            !!e.letterOpen
          }
          go={go}
          onPromptChange={setMagazinePrompt}
        />
      </View>
    );
    // 이름 짓기 모달은 살아있는 섬 홈 위에 뜬다 — 홈을 Overlay 배경으로 넘겨 스크린리더에서 가리고 터치를 막는다
    if (naming)
      return (
        <IslandNamingModal
          islandId={island.id}
          background={home}
          onDone={() => {
            // 전이 상태를 지워 모달을 닫고, 홈 스냅샷을 다시 받아 바뀐 이름이 바로 보이게 한다(GROMO-2649).
            dispatch({ type: 'ISLAND_NAMING_DONE' });
            e.retryHome?.();
          }}
        />
      );
    return home;
  }
}
