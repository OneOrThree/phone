import {
  ConstructionPlanGrid,
  ConstructionPlanPreview,
  ConstructionWalletSummary,
  constructionPlanStyles,
} from '@/components/ConstructionPlanContent';
import { Btn, art } from '@/design-system/patterns';
import { componentTokens, semanticTokens } from '@/design-system/tokens';
import { errorTextOr, t } from '@/i18n';
import type { ScreenProps } from '@/navigation/ScreenEnvironment';
import { BROWN, GOWUN, T, fill, hm, web } from '@/design-system/sceneKit';
import { MUTED, eul, hallLiveIslandId, ledgerMockMode, ro } from '@/screens/island/hall/hallShared';
import { useHallFrame } from '@/screens/island/hall/useHallFrame';
import { useConstruction } from '@/screens/island/useConstruction';
import type { Route } from '@/services/model';
import {
  Building,
  State,
  balance,
  canBuild,
  buildingNames,
  canSelectBuilding,
  costs,
  isHost,
  shopPrerequisitesMet,
  viewIsland,
} from '@/services/model';
import React, { useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, View } from 'react-native';

const completionStamp = componentTokens.hallCompletionStamp;
const grid = ['library', 'tower', 'mail', 'gram', 'shop'] as const satisfies readonly Building[];
const cardDesc: Record<string, string> = {
  get hall() {
    return t('ui.hall.hallSummary');
  },
  get board() {
    return t('ui.hall.boardSummary');
  },
  get library() {
    return t('ui.hall.librarySummary');
  },
  get tower() {
    return t('ui.hall.towerSummary');
  },
  get mail() {
    return t('ui.hall.mailSummary');
  },
  get gram() {
    return t('ui.hall.gramSummary');
  },
  get shop() {
    return t('ui.hall.shopSummary');
  },
};
const planDesc: Record<string, string> = {
  get hall() {
    return t('ui.hall.hallDescription');
  },
  get board() {
    return t('ui.hall.boardDescription');
  },
  get library() {
    return t('ui.hall.libraryDescription');
  },
  get tower() {
    return t('ui.hall.towerDescription');
  },
  get mail() {
    return t('ui.hall.mailDescription');
  },
  get gram() {
    return t('ui.hall.gramDescription');
  },
  get shop() {
    return t('ui.hall.shopDescription');
  },
};
const bldArt: Record<string, string> = {
  hall: 'bld/hall',
  board: 'bld/notice-board',
  library: 'bld/library',
  tower: 'bld/observatory',
  mail: 'bld/mailbox',
  gram: 'bld/gramophone',
  shop: 'bld/shop',
};
// blockedReason 은 서버 evaluator 의 UI 사유다 — 앱이 권한·선행을 다시 추론하지 않는다.
const blockedText = (reason: string | null) =>
  reason === 'FORBIDDEN'
    ? t('ui.hall.hostSetsGoal')
    : reason === 'FACILITY_LOCKED'
      ? t('ui.hall.prerequisiteBuilding')
      : reason === 'REQUIRES_TOWER_AND_MAIL'
        ? t('ui.hall.allBuildingsRequired')
        : reason === 'INSUFFICIENT_FUNDS'
          ? t('ui.hall.insufficientFish')
          : reason === 'IN_PROGRESS'
            ? t('ui.hall.otherConstruction')
            : t('ui.hall.selectionUnavailable');
export const buildBlockedText = (reason: string | null) =>
  reason === 'FORBIDDEN'
    ? t('ui.hall.hostStartsConstruction')
    : reason === 'INSUFFICIENT_FUNDS'
      ? t('ui.hall.collectFishFirst')
      : reason === 'IN_PROGRESS'
        ? t('ui.hall.waitForConstruction')
        : t('ui.hall.constructionUnavailable');
const bldRoute: Record<string, Route> = {
  library: 'library',
  tower: 'tower',
  mail: 'mail',
  gram: 'sound',
  shop: 'shop',
};

// ── 054~061 목각 건물 고르기 · 청사진 ──
export function ConstructionRoute({ e }: ScreenProps) {
  const s: State = e.state,
    i = viewIsland(s),
    host = isHost(i),
    visitor = !!s.visitingIslandId,
    liveIslandId = hallLiveIslandId(e, s, i);
  // 건설 화면도 같은 서버 정본 규칙 — 방문자·모크 모드는 로컬 시연 UI 를 유지한다.
  const liveConstruction = !visitor && !ledgerMockMode();
  const clientConstruction = s.serverIslands?.clientConstruction;
  const construction = useConstruction({
    active: liveConstruction,
    withMembers: false,
    islandId: visitor ? null : liveIslandId,
    now: e.now,
    resumeTiming:
      clientConstruction?.islandId === liveIslandId
        ? {
            buildingId: clientConstruction.building,
            startedAt: clientConstruction.startedAt,
            completesAt: clientConstruction.endsAt,
          }
        : null,
    onStarted: (receipt, serverIslandId) =>
      e.dispatch({
        type: 'SERVER_CONSTRUCTION_STARTED',
        islandId: serverIslandId,
        building: receipt.buildingId as Building,
        startedAt: Date.parse(receipt.startedAt),
        endsAt: Date.parse(receipt.completesAt),
      }),
  });
  const [plan, setPlan] = useState<Building | null>(null);
  // 안드로이드 뒤로 가기는 확인창 다음에 청사진을 닫는다
  const closePlan = useMemo(() => (plan ? () => setPlan(null) : null), [plan]);
  const { L, land, W, H, off, side, g, notify, setDialog, shell } = useHallFrame(e, closePlan);
  // live 경로는 서버 옵션이 정본이다 — 로컬 buildings·construction·buildingQuest·shop 선행은
  // 모크(review/demo) 경로에서만 쓴다.
  const opts = liveConstruction ? construction.options : null;
  const liveItem = (b: string) => opts?.items.find((it) => it.id === b);
  const status = (b: Building) =>
    liveConstruction
      ? !liveItem(b)
        ? 'done'
        : liveItem(b)?.blockedReason === 'IN_PROGRESS'
          ? 'build'
          : opts?.selectedBuildingId === b
            ? 'collect'
            : liveItem(b) !== undefined && !liveItem(b)!.selectable
              ? 'locked'
              : 'none'
      : i.buildings.includes(b)
        ? 'done'
        : i.construction?.building === b
          ? 'build'
          : b === 'shop' && !shopPrerequisitesMet(i)
            ? 'locked'
            : i.buildingQuest?.building === b
              ? 'collect'
              : 'none';
  // 한 번에 한 건물만 짓는다: 공사 중에는 다른 건물을 고를 수 없어 흐리게
  const dim = (b: Building) => {
    const st = status(b);
    return liveConstruction
      ? st === 'locked' || st === 'build'
      : st === 'locked' || (!!i.construction && st === 'none');
  };
  const gap = land ? 10 : 12.9,
    // 격자 폭 = 패널 폭 − 테두리 2.6×2 − 안쪽 여백 (세로 18.1·16.8, 가로 side+16·16).
    // 테두리를 4 로 빼면 393(iPhone 15)·375(SE)에서 두 카드 + 간격이 실제 안쪽 폭을 넘어 둘째 카드가 다음 줄로 밀렸다(GROMO-2486)
    gridW = land ? W - side - 16 - 5.2 - 32 : W - 36.2 - 5.2 - 33.6,
    // 2열 카드의 글 칸 = 카드 − 테두리·여백(2.6·6.5 ×2) − 그림(69.7 − 6.5×2) − 간격 6.5
    twoColText = Math.floor((gridW - gap) / 2) - 81.4,
    // 가로는 격자가 450 이상(카드 약 143)일 때만 3열. 2열 글 칸에 건물 이름 세 글자(18.1×3)가 글자 배율로
    // 안 들어가면 1열 — 360dp·글자 1.3배에서 「도서/관」처럼 끊기고 설명이 도장에 덮였다(GROMO-2888)
    cols = land && gridW >= 450 ? 3 : twoColText < 18.1 * 3 * Math.max(1, L.fontScale ?? 1) ? 1 : 2,
    // 내림: 소수 폭이면 iOS 가 둘째 카드를 다음 줄로 넘긴다
    cardW = Math.floor((gridW - gap * (cols - 1)) / cols);
  const pickFrame = (children: React.ReactNode) => (
    <View
      style={{
        position: 'absolute',
        zIndex: 7,
        left: land ? side : 18.1,
        right: land ? 16 : 18.1,
        top: land ? 14 : undefined,
        bottom: land ? 14 : 28.4,
        minHeight: land ? undefined : Math.min(454.5, H - off.top - L.insets.bottom - 56.8),
        maxHeight: H - off.top - L.insets.bottom - (land ? 28 : 56.8),
        paddingTop: land ? 14 : 20.7,
        paddingHorizontal: land ? 16 : 16.8,
        paddingBottom: land ? 14 : 22,
        borderWidth: 2.6,
        borderColor: '#8b6248',
        borderTopLeftRadius: 23.2,
        borderTopRightRadius: 23.2,
        borderBottomLeftRadius: 12.9,
        borderBottomRightRadius: 12.9,
        backgroundColor: '#fff3d8',
        boxShadow:
          'inset 0px 0px 0px 5.2px rgb(238, 212, 170), 0px 10.3px 23.2px rgba(75, 45, 30, 0.4)',
        overflow: 'hidden',
      }}
    >
      <ScrollView bounces={false} contentContainerStyle={{ paddingBottom: completionStamp.inset }}>
        {children}
      </ScrollView>
    </View>
  );
  // 서버 화면의 비정상 상태 — 목업 데이터로 메우지 않는다
  if (liveConstruction && construction.status !== 'ready') {
    return shell(
      pickFrame(
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          {construction.status === 'error' ? (
            <>
              <T
                testID="hall-construction-error"
                style={g(16.8, 26.88, { fontWeight: '700', textAlign: 'center' })}
              >
                {errorTextOr(construction.error, 'ui.errors.constructionFailed')}
              </T>
              <Pressable
                testID="hall-construction-retry"
                accessibilityRole="button"
                accessibilityLabel={t('common.retry')}
                onPress={() => void construction.retry().catch(() => undefined)}
                style={{
                  minHeight: 44,
                  alignItems: 'center',
                  justifyContent: 'center',
                  paddingVertical: 11.6,
                  paddingHorizontal: 19.4,
                  borderWidth: 2.6,
                  borderColor: BROWN,
                  borderRadius: 999,
                  backgroundColor: componentTokens.button.background,
                  boxShadow: `0px 5.2px 0px ${BROWN}`,
                }}
              >
                <T style={g(16.8, 21, { fontWeight: '800' })}>{t('common.retry')}</T>
              </Pressable>
            </>
          ) : (
            <T
              testID="hall-construction-loading"
              style={g(16.8, 26.88, { fontWeight: '700', textAlign: 'center' })}
            >
              {t('ui.hall.loadingConstruction')}
            </T>
          )}
        </View>,
      ),
      e.back,
    );
  }
  // 미완공 옵션의 순서는 유지하고, 완료한 건물도 기존 그리드에서 지우지 않는다.
  // options는 canonical 건물 중 미완공 목록 전체이므로 응답에서 빠진 건물은 완공이다.
  const cards: Building[] = liveConstruction
    ? [...opts!.items.map((it) => it.id as Building), ...grid.filter((b) => !liveItem(b))]
    : [...grid];
  const allDone = cards.every((b) => status(b) === 'done');
  const pick = pickFrame(
    <>
      <View style={{ gap: 1.3, marginBottom: 11.6 }}>
        <T style={g(25.8, 32.25)}>
          {allDone ? t('ui.hall.constructionStatus') : t('ui.hall.chooseBuilding')}
        </T>
      </View>
      <View
        testID="hall-bld-grid"
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap,
          // GROMO — 패널을 열고 닫을 때 이 값이 배열↔undefined 로 바뀌면 RN 이 이전 렌더의
          // transform 을 지우려고 null 을 native 로 보내 processTransform 의 _validateTransforms
          // 가 `null.forEach`로 죽는다(패널을 닫을 때 재현). transform 자체는 항상 배열로 두고
          // 값만 바꾼다 — undefined/null 로 만들지 않는다.
          transform: [{ scale: plan ? 0.985 : 1 }],
        }}
      >
        {cards.map((b, idx) => {
          const st = status(b),
            off = dim(b),
            item = liveConstruction ? liveItem(b) : undefined,
            cardName = buildingNames[b];
          // 흐린 카드도 눌러서 잠금 사유·공사 상태 패널을 본다
          const tappable =
            !(liveConstruction && st === 'done') && (!off || st === 'locked' || st === 'build');
          return (
            <Pressable
              key={b}
              testID={`hall-bld-${b}`}
              accessibilityRole="button"
              accessibilityLabel={`${cardName}${st === 'done' ? t('ui.hall.completedSuffix') : st === 'build' ? t('ui.hall.buildingSuffix') : ''}`}
              accessibilityState={{ disabled: !tappable }}
              disabled={!tappable}
              onPress={() => setPlan(b)}
              style={{
                // 마지막 줄에 혼자 남는 카드(2열의 상점)는 한 줄 전체 폭(GROMO-2486 — 2413 의 같은 폭 규칙을 뒤집음).
                // 3열 가로에서는 5장이 3+2 라 혼자 남지 않는다
                width: idx === cards.length - 1 && cards.length % cols === 1 ? gridW : cardW,
                gap: 3.9,
                minHeight: land ? 100 : 113.6,
                paddingVertical: 9,
                paddingHorizontal: 6.5,
                borderWidth: 2.6,
                borderColor: BROWN,
                borderRadius: 16.8,
                backgroundColor: '#fffdfa',
                boxShadow: `0px 3.9px 0px ${BROWN}`,
                opacity: off ? 0.6 : 1,
              }}
            >
              {st === 'build' && (
                <View
                  style={{
                    alignSelf: 'flex-end',
                    paddingVertical: 1.3,
                    paddingHorizontal: 7.7,
                    borderRadius: 99,
                    backgroundColor: '#ffe1ea',
                  }}
                >
                  <T
                    style={g(12.9, 20.64, {
                      fontWeight: '800',
                      fontStyle: 'italic',
                      color: '#a33d5c',
                    })}
                  >
                    {t('ui.hall.underConstruction')}
                  </T>
                </View>
              )}
              <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6.5 }}>
                <Image
                  source={art[bldArt[b]]}
                  resizeMode="contain"
                  style={[
                    { width: 69.7, height: 69.7, marginHorizontal: -6.5 },
                    web({ filter: 'drop-shadow(rgba(104, 72, 50, 0.25) 0px 3.9px 2.6px)' }),
                  ]}
                />
                <View style={{ flex: 1, minWidth: 0, gap: 2.6 }}>
                  <T style={g(18.1, 23.53, { fontWeight: '800' })}>{cardName}</T>
                  {/* 설명은 두 줄까지 — 좁은 폰(375)에서도 단어가 한 줄에 들도록 라벨 크기(sm 14)로 둔다 */}
                  <T
                    numberOfLines={2}
                    style={g(semanticTokens.typography.label, 19.6, {
                      color: MUTED,
                      ...(land ? web({ wordBreak: 'keep-all' }) : null),
                    })}
                  >
                    {cardDesc[b]}
                  </T>
                </View>
              </View>
              {/* 완공 도장은 그림·글 위에 겹쳐 찍는다(10/26 오스카) — 흐름에 두면 글이 아래로 밀려 도장 띠가 생긴다 */}
              {st === 'done' && (
                <Image
                  testID={`hall-completion-stamp-${b}`}
                  source={require('@/assets/ui/construction-complete.png')}
                  accessible={false}
                  resizeMode="contain"
                  fadeDuration={0}
                  style={{
                    // 오른쪽 아래 — 건물 이름은 가리지 않고 설명 위에 비스듬히 찍힌다(10/26 오스카). 살짝 비쳐 밑 글이 읽힌다
                    position: 'absolute',
                    bottom: completionStamp.bottomInset,
                    right: completionStamp.inset,
                    width: completionStamp.width,
                    height: completionStamp.height,
                    opacity: completionStamp.opacity,
                    transform: [{ rotate: completionStamp.rotation }],
                  }}
                />
              )}
            </Pressable>
          );
        })}
      </View>
    </>,
  );
  let planView = null;
  // live: 옵션 재조회로 계획 중이던 건물이 items 에서 빠지면(완공 등) 패널을 열지 않는다 — 추정 금지
  const planItem = liveConstruction && plan ? liveItem(plan) : undefined;
  if (plan && (!liveConstruction || planItem !== undefined)) {
    const st = status(plan);
    const name = buildingNames[plan] ?? planItem?.name ?? '';
    const cost = planItem?.cost ?? costs[plan];
    const funds = liveConstruction ? opts!.villagePoints : balance(i);
    const selected = liveConstruction
      ? opts!.selectedBuildingId === plan
      : i.buildingQuest?.building === plan;
    const allowed = liveConstruction ? planItem!.blockedReason !== 'FORBIDDEN' : host;
    const buildable = liveConstruction ? planItem!.buildable : canBuild(s, plan) === null;
    const timing = liveConstruction
      ? construction.timing
      : i.construction
        ? { buildingId: i.construction.building, completesAt: i.construction.endsAt }
        : null;
    const activeHere = timing?.buildingId === plan;
    const left = timing ? Math.max(0, new Date(timing.completesAt).getTime() - e.now) : 0;
    const reason = liveConstruction
      ? blockedText(planItem!.blockedReason)
      : canSelectBuilding(i, plan);
    const p = componentTokens.constructionPlan;
    const select = () => {
      if (liveConstruction) {
        construction.select(plan!).then(
          () => notify(t('ui.hall.goalSet', { v0: eul(name) })),
          (error) => notify(errorTextOr(error, 'ui.errors.goalFailed')),
        );
      } else {
        e.dispatch({ type: 'SELECT_BUILDING', building: plan });
        notify(t('ui.hall.goalSet', { v0: eul(name) }));
      }
    };
    const confirmTarget = () => {
      const previous = liveConstruction ? opts!.selectedBuildingId : i.buildingQuest?.building;
      if (previous && previous !== plan) {
        setDialog({
          title: t('ui.hall.changeGoal'),
          text: t('ui.hall.changeTargetKeepBalance', { name: eul(name) }),
          ok: t('ui.hall.change'),
          onOk: select,
        });
      } else select();
    };
    const build = () => {
      if (!liveConstruction) {
        e.build(plan!);
        return;
      }
      setDialog({
        title: t('constructionPlan.confirmTitle', { name }),
        text: '',
        body: <ConstructionWalletSummary balance={funds} cost={cost} />,
        ok: t('constructionPlan.start'),
        onOk: () =>
          construction.build(plan!, cost).then(
            () => notify(t('ui.hall.constructionStarted', { v0: eul(name) })),
            (error) => notify(errorTextOr(error, 'ui.errors.buildFailed')),
          ),
      });
    };
    const notice = (text: string) => <T style={constructionPlanStyles.notice}>{text}</T>;
    const canSelect = liveConstruction ? planItem!.selectable : host && !reason;
    planView = (
      <>
        <Pressable
          testID="hall-plan-backdrop"
          accessibilityRole="button"
          accessibilityLabel={t('constructionPlan.close')}
          onPress={() => setPlan(null)}
          style={[fill, { zIndex: 8 }]}
        />
        <View
          pointerEvents="box-none"
          style={{
            position: 'absolute',
            zIndex: 9,
            left: land ? side + p.screenInset : p.screenInset,
            right: land ? p.bottomInset : p.screenInset,
            top: land ? p.screenInset : off.top + 96,
            bottom: p.bottomInset,
            justifyContent: 'center',
          }}
        >
          <View
            testID="hall-building-plan"
            style={[
              constructionPlanStyles.card,
              {
                maxHeight: Math.min(
                  p.maxHeight,
                  H - off.top - L.insets.bottom - (land ? p.bottomInset : 128),
                ),
              },
            ]}
          >
            <ConstructionPlanGrid />
            <ScrollView
              style={{ flexShrink: 1 }}
              contentContainerStyle={constructionPlanStyles.content}
              keyboardShouldPersistTaps="handled"
            >
              <ConstructionPlanPreview
                name={name}
                image={art[bldArt[plan]]}
                description={planDesc[plan] ?? ''}
              />
              {st === 'build' ? (
                notice(
                  activeHere
                    ? left > 0
                      ? t('ui.hall.buildingWithTime', {
                          name: eul(name),
                          time: hm(Math.ceil(left / 60000) * 60),
                        })
                      : t('ui.hall.checkingCompletion')
                    : t('ui.hall.buildingElsewhere'),
                )
              ) : st === 'done' ? (
                notice(t('ui.policy.this_building_is_already_complete_daa36'))
              ) : (
                <>
                  <ConstructionWalletSummary
                    testID="hall-wallet-summary"
                    balance={funds}
                    cost={cost}
                  />
                  {st === 'locked' && planItem?.blockedReason !== 'FORBIDDEN'
                    ? notice(reason ?? '')
                    : selected && allowed
                      ? notice(
                          t(funds >= cost ? 'constructionPlan.ready' : 'constructionPlan.saving'),
                        )
                      : null}
                </>
              )}
            </ScrollView>
            {st === 'done' && bldRoute[plan] && (
              <Btn
                title={t('ui.hall.goToBuilding', { v0: ro(name) })}
                font={GOWUN}
                dynamicHeight
                onPress={() => e.go(bldRoute[plan])}
              />
            )}
            {st !== 'build' && st !== 'done' && (
              <View
                style={{
                  paddingTop: semanticTokens.spacing.component,
                  gap: semanticTokens.spacing.control,
                }}
              >
                {!allowed ? (
                  notice(t('constructionPlan.ownerOnly'))
                ) : selected ? (
                  <>
                    <Btn
                      id="hall-plan-action"
                      title={t('home.buildAction')}
                      font={GOWUN}
                      dynamicHeight
                      disabled={!buildable}
                      onPress={build}
                    />
                    {!buildable &&
                      funds >= cost &&
                      notice(buildBlockedText(planItem?.blockedReason ?? null))}
                  </>
                ) : canSelect ? (
                  <Btn
                    id="hall-plan-action"
                    title={t('ui.hall.setBuildingGoal')}
                    font={GOWUN}
                    dynamicHeight
                    onPress={confirmTarget}
                  />
                ) : null}
              </View>
            )}
          </View>
        </View>
      </>
    );
  }
  return shell(
    <>
      {pick}
      {planView}
    </>,
    plan ? () => setPlan(null) : e.back,
    plan ? t('ui.hall.backToBuildings') : undefined,
  );
}
