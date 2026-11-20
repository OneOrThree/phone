import { WebIslandEntry } from '@/screens/web-demo/WebIslandEntry';
import { usesSharedWebIsland } from '@/services/webIsland';
import { CreateIslandScreen } from './CreateIslandScreen';
import { Badge, Btn, C, EmptyState, Pic, Txt, k } from '@/design-system/patterns';
import { t } from '@/i18n';
import { ServerIslandPicker } from '@/screens/island/ServerIslandPicker';
import { ServerVisit } from '@/screens/island/ServerVisit';
import { telescopeSea } from '@/screens/sea/seaAssets';
import { ApiError } from '@/services/api/client';
import type { RequestStatusEntry } from '@/services/model';
import {
  capacityOf,
  hoursMinutes,
  isFull,
  islandWeeklyAverage,
  residentCount,
} from '@/services/model';
import { Pressable, View } from 'react-native';
import { AvStack, H17, H22, META, Onboard, Spinner } from '../navigation/screenParts';
import type { ScreenContext } from '../navigation/useScreenState';

function Thumb({ h = 220, warm = false }: any) {
  return (
    <View style={[k.preview, { height: h }]}>
      <Pic id={warm ? 'island/whole/warm' : 'island/whole'} w="100%" h="100%" cover />
    </View>
  );
}

export function renderMembershipScreens(context: ScreenContext) {
  const {
    server,
    route,
    detail,
    e,
    state,
    back,
    home,
    reset,
    layout,
    serverDone,
    serverBusy,
    run,
    setServerDone,
    act,
    go,
    serverError,
    snap,
    pendingReq,
    reqList,
    discoveryPick,
    setDiscoveryPick,
    doneCard,
    discoveryIndex,
    now,
    join,
  } = context;

  if (server && route === 'visit') return <ServerVisit key={detail} e={e} />;

  if (
    usesSharedWebIsland() &&
    ['createIsland', 'joinIsland', 'mainIsland', 'currentIsland'].includes(route)
  )
    return <WebIslandEntry e={e} />;

  if (server && (route === 'mainIsland' || route === 'currentIsland'))
    return (
      <ServerIslandPicker
        key={route}
        mode={route === 'mainIsland' ? 'main' : 'current'}
        state={state}
        islands={server}
        back={back}
        home={home}
        reset={reset}
      />
    );

  if (route === 'createIsland') return <CreateIslandScreen context={context} />;

  if ((route === 'joinIsland' || route === 'approval') && server) {
    // ── 서버 모드: 공개 DTO 만 그린다 — members·평균·건물·퀘스트는 합성하지 않는다 ──
    const candidates = snap?.candidates ?? [],
      req = pendingReq(),
      // approval 경로에서 방금 종결된 신청 — rejected/cancelled/approved 안내를 띄운다.
      // joinIsland(detail='')에서 무관한 옛 종결을 집어 참여 CTA를 숨기지 않게 route로 한정하고,
      // 현재 pending이 있으면 종결 카드보다 신청이 우선한다(취소 CTA 보존). 종결 이력이 여러 개면
      // requestStatus가 최신을 끝에 붙이므로 역순으로 최신 것을 고른다.
      closed =
        route === 'approval' && !req
          ? [...reqList]
              .reverse()
              .find((r) => r.status !== 'pending' && (!detail || r.islandId === detail))
          : undefined;
    const idx = candidates.findIndex((c) => c.id === discoveryPick),
      i = candidates[idx >= 0 ? idx : 0],
      iReq = i && reqList.find((r) => r.islandId === i.id && r.status === 'pending'),
      joined = !!i && snap?.currentIslandId === i.id;
    const move = (n: number) => {
      if (!candidates.length) return;
      // 마지막 후보에서 › 는 다음 페이지를 서버에서 가져온다. 커서가 죽었으면 첫 페이지부터 다시.
      if (n > 0 && idx >= candidates.length - 1 && snap?.nextCursor)
        return run(async () => {
          try {
            await server.discover(snap.nextCursor!);
          } catch (thrown) {
            if (
              thrown instanceof ApiError &&
              (thrown.code === 'INVALID_CURSOR' || thrown.code === 'CURSOR_EXPIRED')
            )
              await server.explore();
            else throw thrown;
          }
        });
      setDiscoveryPick(
        candidates[(Math.max(0, idx) + n + candidates.length) % candidates.length].id,
      );
    };
    const pendingCard = (r: RequestStatusEntry & { islandName?: string | null }) => (
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          backgroundColor: '#FFF3CF',
          borderWidth: 1.5,
          borderColor: '#E7CF9A',
          borderRadius: 14,
          paddingVertical: 10,
          paddingHorizontal: 14,
        }}
      >
        <View style={{ gap: 2, flex: 1 }}>
          <Txt style={{ fontSize: 15, lineHeight: 21.75, fontWeight: '700' }}>
            {t('onboarding.joinIsland.pendingWaitTitle')}
          </Txt>
          <Txt kind="meta" style={{ lineHeight: 18.85 }}>
            {r.islandName
              ? t('onboarding.joinIsland.pendingWaitSubNamed', { island: r.islandName })
              : t('onboarding.joinIsland.pendingWaitSubGeneric')}
          </Txt>
        </View>
        <Spinner reduce={state.settings.reduceMotion} />
      </View>
    );
    const joinedCard = (name: string, id?: string) =>
      doneCard(
        t('onboarding.joinedCard.title'),
        t('onboarding.joinedCard.sub', { island: name }),
        id,
      );
    return (
      <Onboard
        title={
          route === 'approval' ? t('onboarding.joinRequest') : t('onboarding.joinIsland.title')
        }
        back={back}
        left={
          <Pic
            id={i?.id === 'strawberry' ? 'island/whole/warm' : 'island/whole'}
            w="100%"
            h="100%"
            cover
          />
        }
        cta={
          serverDone || joined || closed?.status === 'approved' ? undefined : req &&
            route === 'approval' ? (
            <>
              <Btn
                kind="sec"
                title={t('onboarding.joinIsland.cancelRequest')}
                disabled={serverBusy}
                onPress={() => run(() => server.cancel(req.id))}
              />
              <Btn
                kind="ghost"
                title={t('onboarding.joinIsland.viewOtherIslands')}
                onPress={() => go('joinIsland')}
              />
            </>
          ) : closed && route === 'approval' ? (
            <Btn
              title={t('onboarding.joinIsland.findAnotherIsland')}
              onPress={() => go('joinIsland')}
            />
          ) : iReq ? (
            <>
              <Btn
                kind="sec"
                title={t('onboarding.joinIsland.cancelRequest')}
                disabled={serverBusy}
                onPress={() => run(() => server.cancel(iReq.id))}
              />
              <Btn
                kind="ghost"
                title={t('onboarding.joinIsland.viewOtherIslands')}
                disabled={candidates.length < 2 && !snap?.nextCursor}
                onPress={() => move(1)}
              />
            </>
          ) : (
            <>
              <Btn
                title={
                  !i
                    ? t('onboarding.joinIsland.joinAction')
                    : i.approvalRequired
                      ? t('onboarding.joinRequest')
                      : t('onboarding.joinIsland.joinNamed', { island: i.name })
                }
                disabled={!i || serverBusy}
                onPress={() =>
                  i &&
                  run(async () => {
                    const r = await server.join(i.id);
                    if (r.status === 'active') setServerDone(i.name);
                  })
                }
              />
              <Btn
                kind="ghost"
                title={t('onboarding.joinIsland.createNewIfNotFound')}
                onPress={() => go('createIsland')}
              />
            </>
          )
        }
      >
        {/* 승인 대기 복구 카드 — 재실행 뒤에도 pending 신청이 먼저 보인다 */}
        {route === 'approval' && req && pendingCard(req)}
        {route === 'approval' &&
          !req &&
          closed &&
          (closed.status === 'approved' ? (
            joinedCard(
              closed.islandName ??
                snap?.memberships.find((m) => m.id === closed.islandId)?.name ??
                t('onboarding.joinIsland.thatIslandFallback'),
              closed.islandId,
            )
          ) : (
            <View style={{ gap: 4 }}>
              <Txt style={H17}>
                {closed.status === 'rejected'
                  ? t('onboarding.joinIsland.requestRejected')
                  : t('onboarding.joinIsland.requestCancelled')}
              </Txt>
              <Txt kind="meta" style={META}>
                {t('onboarding.joinIsland.tryAnotherIsland')}
              </Txt>
            </View>
          ))}
        {/* join()은 active 확정 전에 syncIslands()로 snap을 이미 맞춘다 — serverDone과 joined가
            같은 가입을 동시에 가리키면 카드를 두 번 그리지 않고 joined(정본 스냅숏)만 남긴다. */}
        {serverDone && !joined && joinedCard(serverDone)}
        {joined && i && joinedCard(i.name)}
        {serverError ? (
          <View style={{ gap: 8 }}>
            <Txt kind="meta" style={[META, { color: C.danger }]}>
              {serverError}
            </Txt>
            <Btn
              kind="ghost"
              title={t('onboarding.joinIsland.reload')}
              disabled={serverBusy}
              onPress={() => run(() => server.explore())}
            />
          </View>
        ) : null}
        {route === 'joinIsland' &&
          (i ? (
            <>
              {!layout.compact && <Thumb h={210} />}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 50 }}>
                <Pressable
                  style={{ flex: 1, gap: 2 }}
                  accessibilityRole="button"
                  accessibilityLabel={t('onboarding.joinIsland.viewIslandInfoA11y', {
                    island: i.name,
                  })}
                  // 카드를 누르면 방문 화면 DTO 로 공개 정보를 더 보여준다
                  onPress={() => run(() => server.visit(i.id))}
                >
                  <Txt style={H22}>{i.name}</Txt>
                  <Txt kind="meta" style={META}>
                    {i.intro}
                  </Txt>
                </Pressable>
                {['‹', '›'].map((v, n) => (
                  <Pressable
                    key={v}
                    accessibilityRole="button"
                    accessibilityLabel={
                      n
                        ? t('onboarding.joinIsland.nextIsland')
                        : t('onboarding.joinIsland.previousIsland')
                    }
                    accessibilityState={{ disabled: serverBusy }}
                    disabled={serverBusy}
                    onPress={() => move(n ? 1 : -1)}
                    style={{
                      opacity: serverBusy ? 0.45 : 1,
                      width: 44,
                      height: 44,
                      marginTop: 6,
                      borderRadius: 22,
                      borderWidth: 2,
                      borderColor: C.brown,
                      backgroundColor: C.paper,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Txt
                      style={{ fontSize: 13, lineHeight: 18.85, fontWeight: '700', color: C.muted }}
                    >
                      {v}
                    </Txt>
                  </Pressable>
                ))}
              </View>
              <Txt kind="meta" style={META}>
                {t('onboarding.residents', { count: i.memberCount, max: i.maxMembers })}
              </Txt>
              <Badge soft>
                {i.approvalRequired
                  ? t('onboarding.approvalBadge')
                  : t('onboarding.instantJoinBadge')}
              </Badge>
              {/* 방문 화면 DTO — 공개 주민 목록만, 집중 평균·건물은 서버가 주지 않는다 */}
              {snap?.visit && snap.visit.island.id === i.id && (
                <View
                  style={{
                    gap: 4,
                    borderWidth: 1.5,
                    borderColor: '#E7CF9A',
                    borderRadius: 14,
                    paddingVertical: 10,
                    paddingHorizontal: 14,
                  }}
                >
                  <Txt style={H17}>{snap.visit.island.name}</Txt>
                  {snap.visit.members.items.length ? (
                    <Txt kind="meta" style={META}>
                      {t('onboarding.visitResidents', {
                        names: snap.visit.members.items
                          .map((m) => m.name ?? t('onboarding.residentFallbackName'))
                          .join(', '),
                      })}
                    </Txt>
                  ) : null}
                </View>
              )}
              {iReq && pendingCard(iReq)}
            </>
          ) : serverBusy ? (
            <Txt kind="meta" style={META}>
              {t('onboarding.joinIsland.searchingPublicIslands')}
            </Txt>
          ) : (
            !serverError && (
              <EmptyState
                scene
                testID="join-island-empty"
                art={telescopeSea.source}
                title={t('onboarding.joinIsland.noPublicIslands')}
              />
            )
          ))}
      </Onboard>
    );
  }

  if (route === 'joinIsland' || route === 'approval') {
    // 망원경으로 찾은 공개 섬: 주민이 있고 정원이 남은 섬(신청 중인 섬은 가득 차도 남긴다)
    const pendings = state.pendingIslands ?? [];
    const candidates = state.islands.filter(
      (i) =>
        !i.closed &&
        !i.kicked &&
        !i.joined &&
        // 초대 코드로 신청한 비공개 섬은 공개 조건과 상관없이 대기 화면에 남긴다
        ((i.visibility !== 'private' && i.members.length > 0 && !isFull(i)) ||
          pendings.includes(i.id) ||
          (route === 'approval' && i.id === (detail || state.pendingIsland))),
    );
    // 처음 보여줄 섬: ‹ ›로 고른 섬 → 경로로 받은 섬 → 신청 중인 섬(다시 켜도 먼저) → 무작위
    const pickId = discoveryPick ?? (detail || state.pendingIsland);
    const picked = candidates.findIndex((c) => c.id === pickId);
    const index = picked >= 0 ? picked : discoveryIndex % Math.max(1, candidates.length),
      i = candidates[index];
    const pending = !!i && pendings.includes(i.id);
    const move = (n: number) =>
      setDiscoveryPick(candidates[(index + n + candidates.length) % candidates.length].id);
    const average = i ? hoursMinutes(islandWeeklyAverage(state, i, now)).replace(/ 0분$/, '') : '';
    return (
      <Onboard
        title={t('onboarding.joinIsland.title')}
        back={back}
        left={
          <Pic
            id={i?.id === 'strawberry' ? 'island/whole/warm' : 'island/whole'}
            w="100%"
            h="100%"
            cover
          />
        }
        cta={
          pending ? (
            <>
              <Btn
                kind="sec"
                title={t('onboarding.joinIsland.cancelRequest')}
                onPress={() => act('CANCEL_JOIN', { id: i.id })}
              />
              <Btn
                kind="ghost"
                title={t('onboarding.joinIsland.viewOtherIslands')}
                disabled={candidates.length < 2}
                onPress={() => move(1)}
              />
            </>
          ) : (
            <>
              <Btn
                title={
                  !i
                    ? t('onboarding.joinIsland.joinAction')
                    : i.approval
                      ? t('onboarding.joinRequest')
                      : t('onboarding.joinIsland.joinNamed', { island: i.name })
                }
                disabled={!i}
                onPress={() => i && join(i)}
              />
              <Btn
                kind="ghost"
                title={t('onboarding.joinIsland.createNewIfNotFound')}
                onPress={() => go('createIsland')}
              />
            </>
          )
        }
      >
        {i ? (
          <>
            {!layout.compact && <Thumb warm={i.id === 'strawberry'} h={210} />}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 50 }}>
              <View style={{ flex: 1, gap: 2 }}>
                <Txt style={H22}>{i.name}</Txt>
                <Txt kind="meta" style={META}>
                  {i.intro}
                </Txt>
              </View>
              {['‹', '›'].map((v, n) => (
                <Pressable
                  key={v}
                  accessibilityRole="button"
                  accessibilityLabel={
                    n
                      ? t('onboarding.joinIsland.nextIsland')
                      : t('onboarding.joinIsland.previousIsland')
                  }
                  accessibilityState={{ disabled: candidates.length < 2 }}
                  disabled={candidates.length < 2}
                  onPress={() => move(n ? 1 : -1)}
                  style={{
                    opacity: candidates.length < 2 ? 0.45 : 1,
                    width: 44,
                    height: 44,
                    marginTop: 6,
                    borderRadius: 22,
                    borderWidth: 2,
                    borderColor: C.brown,
                    backgroundColor: C.paper,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Txt
                    style={{ fontSize: 13, lineHeight: 18.85, fontWeight: '700', color: C.muted }}
                  >
                    {v}
                  </Txt>
                </Pressable>
              ))}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <AvStack list={i.members.slice(0, 3).map((m) => m.color)} />
              <Txt kind="meta" style={[META, { flex: 1 }]}>
                {t('onboarding.residentsWithAverage', {
                  count: residentCount(i),
                  max: capacityOf(i),
                  average,
                })}
              </Txt>
            </View>
            {/* 합류 방식 배지: 바로 참여 / 승인 필요(버튼이 가입 신청) */}
            <View
              style={{
                alignSelf: 'flex-start',
                height: 28,
                paddingHorizontal: 12,
                justifyContent: 'center',
                borderRadius: 999,
                borderWidth: 1.5,
                borderColor: i.approval ? '#D9C6B8' : C.brown,
                backgroundColor: i.approval ? C.paper : C.butter,
              }}
            >
              <Txt
                style={{
                  fontSize: 13,
                  lineHeight: 18.85,
                  fontWeight: i.approval ? '600' : '700',
                  color: i.approval ? C.muted : C.ink,
                }}
              >
                {i.approval ? t('onboarding.approvalBadge') : t('onboarding.instantJoinBadge')}
              </Txt>
            </View>
            {pending && (
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  backgroundColor: '#FFF3CF',
                  borderWidth: 1.5,
                  borderColor: '#E7CF9A',
                  borderRadius: 14,
                  paddingVertical: 10,
                  paddingHorizontal: 14,
                }}
              >
                <View style={{ gap: 2 }}>
                  <Txt style={{ fontSize: 15, lineHeight: 21.75, fontWeight: '700' }}>
                    {t('onboarding.joinIsland.pendingWaitTitle')}
                  </Txt>
                  <Txt kind="meta" style={{ lineHeight: 18.85 }}>
                    {t('onboarding.joinIsland.pendingWaitSubGeneric')}
                  </Txt>
                </View>
                <Spinner reduce={state.settings.reduceMotion} />
              </View>
            )}
          </>
        ) : (
          <EmptyState
            scene
            testID="join-island-empty"
            art={telescopeSea.source}
            title={t('onboarding.joinIsland.noPublicIslands')}
          />
        )}
      </Onboard>
    );
  }
}
