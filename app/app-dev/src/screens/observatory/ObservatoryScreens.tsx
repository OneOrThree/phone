import { Badge, Btn, Txt } from '@/design-system/patterns';
import { t } from '@/i18n';
import {
  IslandSheet,
  IslandThumb,
  SearchField,
  SheetGroup,
  SheetRow,
  st,
} from '@/screens/island/IslandSheet';
import {
  ObservatoryHeading,
  ObservatoryLedger,
  ObservatoryRow,
} from '@/screens/island/ObservatoryLayout';
import { ObservatoryPodium } from '@/screens/island/ObservatoryPodium';
import { ObservatorySearch } from '@/screens/island/ObservatorySearch';
import {
  capacityOf,
  findIslandByInviteCode,
  hoursMinutes,
  isFull,
  islandWeeklyAverage,
  residentCount,
} from '@/services/model';
import { View } from 'react-native';
import type { ScreenContext } from '../island/navigation/useScreenState';

export function renderObservatoryScreens(context: ScreenContext) {
  const {
    route,
    server,
    islandRankings,
    snap,
    e,
    telescopePin,
    serverErrorText,
    state,
    now,
    setVisited,
    go,
    island,
    search,
    back,
    home,
    setSearch,
  } = context;

  if (route === 'tower') {
    // 섬 간 랭킹만 보여 준다(우리 섬 주민 순위 없음). 주민 평균 집중(이번 주) 순서, 매주 일요일 00시 초기화
    if (server) {
      // 서버 주간 랭킹이 정본(GROMO-2018) — rank(동점 공동)를 그대로 쓰고
      // 앱이 순번을 다시 매기거나 0위를 지어내지 않는다.
      const rk = islandRankings,
        myIslandId = snap?.currentIslandId,
        // 소속 섬은 뗏목으로 바로 간다 — 망원경에 넣을 일이 없어 행을 누를 수 없다(GROMO-2269)
        joinedIds = new Set((snap?.memberships ?? []).map((m) => m.id));
      return (
        <ObservatorySearch
          e={e}
          pinController={telescopePin}
          ranking={
            <>
              {rk.status === 'ready' && rk.data && (
                <ObservatoryPodium
                  items={rk.data.items
                    .filter((item) => item.rank <= 3)
                    .map((item) => {
                      const joined = joinedIds.has(item.islandId);
                      const label = t('observatory.rankLabel', {
                        rank: item.rank,
                        name: item.name,
                        time: hoursMinutes(item.averageFocusSeconds),
                      });
                      return {
                        id: item.islandId,
                        name: item.name,
                        rank: item.rank,
                        average: t('observatory.average', {
                          time: hoursMinutes(item.averageFocusSeconds),
                        }),
                        joined,
                        label: joined ? `${label}, ${t('observatory.joined')}` : label,
                        disabled: telescopePin.busy,
                        onPress: joined
                          ? undefined
                          : () => telescopePin.ask({ id: item.islandId, name: item.name }),
                      };
                    })}
                />
              )}
              <ObservatoryLedger
                visible={
                  rk.status !== 'ready' ||
                  !rk.data?.items.length ||
                  rk.data.items.some((item) => item.rank > 3)
                }
              >
                {rk.status === 'loading' && (
                  <Txt
                    kind="meta"
                    testID="rankings-loading"
                    style={[st.meta, { textAlign: 'center', paddingVertical: 24 }]}
                  >
                    {t('observatory.loading')}
                  </Txt>
                )}
                {rk.status === 'error' && (
                  <View style={{ alignItems: 'center', paddingVertical: 20, gap: 10 }}>
                    <Txt kind="meta" style={[st.meta, { textAlign: 'center' }]}>
                      {serverErrorText(rk.error) || t('observatory.failed')}
                    </Txt>
                    <Btn
                      small
                      kind="sec"
                      testID="rankings-retry"
                      title={t('common.retry')}
                      onPress={rk.retry}
                    />
                  </View>
                )}
                {rk.status === 'ready' && rk.data && !rk.data.items.length && (
                  <Txt kind="meta" style={[st.meta, { textAlign: 'center', paddingVertical: 24 }]}>
                    {t('observatory.empty')}
                  </Txt>
                )}
                {rk.status === 'ready' &&
                  rk.data &&
                  rk.data.items.some((item) => item.rank > 3) && (
                    <>
                      <View>
                        {rk.data.items
                          .filter((item) => item.rank > 3)
                          .map((item) => {
                            const joined = joinedIds.has(item.islandId);
                            const label = t('observatory.rankLabel', {
                              rank: item.rank,
                              name: item.name,
                              time: hoursMinutes(item.averageFocusSeconds),
                            });
                            const joinedBadge = joined && (
                              <Badge soft>{t('observatory.joined')}</Badge>
                            );
                            return (
                              <ObservatoryRow
                                key={item.islandId}
                                title={item.name}
                                average={t('observatory.average', {
                                  time: hoursMinutes(item.averageFocusSeconds),
                                })}
                                label={joined ? `${label}, ${t('observatory.joined')}` : label}
                                current={item.islandId === myIslandId}
                                rank={item.rank}
                                below={joinedBadge}
                                disabled={telescopePin.busy}
                                // 소속이 아닌 섬은 확인창 → 망원경에 넣기(방문 화면으로 보내지 않는다)
                                onPress={
                                  joined
                                    ? undefined
                                    : () => telescopePin.ask({ id: item.islandId, name: item.name })
                                }
                              />
                            );
                          })}
                      </View>
                    </>
                  )}
              </ObservatoryLedger>
            </>
          }
        />
      );
    }
    const islands = state.islands
      // 주민 2명 이상인 섬만 순위에 올린다(혼자 섬은 평균이 의미 없어서)
      .filter(
        (i) =>
          !i.closed &&
          !i.kicked &&
          (i.joined || i.visibility !== 'private') &&
          residentCount(i) >= 2,
      )
      .map((i) => ({ i, avg: islandWeeklyAverage(state, i, now) }))
      .sort((a, b) => b.avg - a.avg);
    return (
      <ObservatorySearch
        e={e}
        localResults={(query) => {
          const matches = state.islands.filter(
            (i) =>
              !i.closed &&
              !i.kicked &&
              i.visibility !== 'private' &&
              i.name.includes(query) &&
              (i.joined || !isFull(i)),
          );
          return (
            <ObservatoryLedger>
              <ObservatoryHeading />
              {matches.length ? (
                matches.map((i) => (
                  <ObservatoryRow
                    key={i.id}
                    title={i.name}
                    sub={[
                      i.intro,
                      t('telescope.residents', { count: residentCount(i), max: capacityOf(i) }),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                    memberCount={residentCount(i)}
                    label={i.name}
                    below={i.joined && <Badge soft>{t('observatory.joined')}</Badge>}
                    onPress={
                      i.joined
                        ? undefined
                        : () => {
                            setVisited(i.id);
                            go('visit', i.id);
                          }
                    }
                  />
                ))
              ) : (
                <Txt kind="meta">{t('observatory.searchEmpty')}</Txt>
              )}
            </ObservatoryLedger>
          );
        }}
        ranking={
          <>
            <ObservatoryPodium
              items={islands.slice(0, 3).map(({ i, avg }, n) => ({
                id: i.id,
                name: i.name,
                rank: n + 1,
                memberCount: residentCount(i),
                average: t('observatory.average', { time: hoursMinutes(avg) }),
                label: `${n + 1}위 ${i.name}, 평균 ${hoursMinutes(avg)}`,
                joined: i.joined,
                onPress:
                  i.id === island.id
                    ? undefined
                    : () => {
                        setVisited(i.id);
                        go('visit', i.id);
                      },
              }))}
            />
            <ObservatoryLedger visible={islands.length === 0 || islands.length > 3}>
              {!islands.length && (
                <Txt kind="meta" style={[st.meta, { textAlign: 'center', paddingVertical: 24 }]}>
                  {t('observatory.empty')}
                </Txt>
              )}
              {islands.length > 3 && (
                <View>
                  {islands.slice(3).map(({ i, avg }, n) => (
                    <ObservatoryRow
                      key={i.id}
                      title={i.name}
                      average={t('observatory.average', { time: hoursMinutes(avg) })}
                      label={`${n + 4}위 ${i.name}, 평균 ${hoursMinutes(avg)}, 주민 ${residentCount(i)}명`}
                      current={i.id === island.id}
                      rank={n + 4}
                      memberCount={residentCount(i)}
                      onPress={
                        i.id === island.id
                          ? undefined
                          : () => {
                              setVisited(i.id);
                              go('visit', i.id);
                            }
                      }
                    />
                  ))}
                </View>
              )}
            </ObservatoryLedger>
          </>
        }
      />
    );
  }

  if (route === 'explore') {
    // 서버 모드는 섬 이름을 서버에서 검색하고 고른 섬을 망원경에 넣는다(GROMO-2269) — 아래 로컬 필터는 서버 없는 모드의 목업이다
    if (server) return <ObservatorySearch e={e} />;
    const query = search.trim();
    const codeTarget = findIslandByInviteCode(state.islands, query)?.id;
    // 이름 검색 결과에서 정원이 찬 섬(내가 가입하지 않은)은 뺀다. 초대 코드로 찾은 섬은 보여 주고 가입할 때 막는다
    const results = state.islands.filter(
      (i) =>
        (!i.closed &&
          !i.kicked &&
          i.visibility !== 'private' &&
          (!query || i.name.includes(query)) &&
          (i.joined || !isFull(i))) ||
        (!i.closed && !i.kicked && i.id === codeTarget),
    );
    return (
      <IslandSheet
        bg="tower"
        sign="bld/observatory"
        title="섬 찾기"
        tall
        onBack={back}
        onClose={home}
      >
        <SearchField value={search} onChange={setSearch} placeholder="섬 이름이나 초대 코드" />
        {results.length ? (
          <SheetGroup>
            {results.map((i) => (
              <SheetRow
                key={i.id}
                title={i.name}
                sub={`${i.intro} · 주민 ${residentCount(i)}`}
                chevron={!i.joined}
                tail={
                  <>
                    {i.joined && <Badge soft>소속됨</Badge>}
                    <IslandThumb warm={i.id === 'strawberry'} />
                  </>
                }
                onPress={() => {
                  setVisited(i.id);
                  i.id === island.id ? home() : go('visit', i.id);
                }}
              />
            ))}
          </SheetGroup>
        ) : (
          <Txt kind="meta" style={st.meta}>
            찾는 섬이 없어요. 이름이나 초대 코드를 확인해 주세요.
          </Txt>
        )}
      </IslandSheet>
    );
  }
}
