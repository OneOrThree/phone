import React, { useEffect, useRef, useState } from 'react';
import { Animated, Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import {
  State,
  Building,
  Friend,
  Route,
  currentIsland,
  buildingNames,
  costs,
  buildMinutes,
  balance,
  buildingCost,
  buildingReady,
  buildingShare,
  collectedBy,
  isHost,
  residentCount,
  capacityOf,
  isFull,
  canBuy,
  canBuild,
  products,
  sessionSeconds,
  dayKey,
  islandWeeklyAverage,
  questMemberRate,
  hoursMinutes,
  SECONDS_PER_FISH,
  findIslandByInviteCode,
} from '@/services/model';
import { assets, cat } from '@/constants/assets';
import { CatSprite } from '@/components/CatSprite';
import { useAppLayout } from '@/utils/layout';
import { BoatPortrait } from '@/screens/cosmetics/Cosmetics';
import { RestGroup } from '@/screens/focus/RestGroup';
import { Sailing } from '@/screens/world/WorldViews';
import { clock } from '@/screens/focus/FocusSea';
import { Grid, Point, landPath, nearestLand, onLand } from '@/utils/world-grid';
import grids from '@/constants/world-v2.json';
import { RedesignScreens } from '@/screens/island/Screens';
import { FinalIsland, WorldMap } from '@/screens/island/WorldMap';
import {
  C,
  k,
  Txt,
  Pic,
  Btn,
  Group,
  Row,
  Seg,
  Field,
  Bar,
  Strip,
  Toggle,
  Overlay,
} from '@/design-system/patterns';
import { IslandSheet, IslandPopup } from '@/screens/island/IslandSheet';
import { Library } from '@/screens/island/Library';
import { Hall } from '@/screens/island/Hall';
const buildingArt: Record<Building, string> = {
  hall: 'hall',
  board: 'notice-board',
  gram: 'gramophone',
  library: 'library',
  mail: 'mailbox',
  tower: 'observatory',
  shop: 'shop',
};
const tracks: Record<string, string> = {
  waves: '잔잔한 파도',
  campfire: '모닥불 소리',
  'forest-wind': '숲바람',
  rain: '오두막의 빗소리',
};
const date = (at: number) =>
  new Date(at).toLocaleDateString('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'numeric',
    day: 'numeric',
  });
function Close({ onPress }: { onPress: () => void }) {
  return <Btn small title="×" kind="glass" onPress={onPress} />;
}
function Empty({ children }: { children: React.ReactNode }) {
  return (
    <Txt kind="meta" style={{ paddingVertical: 24, textAlign: 'center' }}>
      {children}
    </Txt>
  );
}
function Sheet({
  e,
  title,
  bg = 'dock',
  sign = 'boat/raft',
  children,
  footer,
  action,
  actionPress,
  tall = true,
  onClose,
}: any) {
  return (
    <IslandSheet
      bg={bg}
      sign={sign}
      title={title}
      tall={tall}
      onBack={e.back}
      onClose={onClose ?? e.home}
      action={action}
      actionPress={actionPress}
      footer={footer}
    >
      {children}
    </IslandSheet>
  );
}

export function CurrentScreens({ e }: any) {
  const state: State = e.state,
    i = currentIsland(state),
    r: Route = e.route;
  const memberRoutes: Route[] = [
    'home',
    'guide',
    'focusTravel',
    'fishingArrival',
    'focusSetup',
    'focus',
    'rest',
    'focusResult',
    'returnTravel',
    'hall',
    'manage',
    'members',
    'ledger',
    'construction',
    'board',
    'notice',
    'noticeEdit',
    'quest',
    'questEdit',
    'tower',
    'explore',
    'library',
    'diary',
    'stats',
    'mail',
    'chat',
    'friendMail',
    'shop',
    'product',
    'orders',
    'sound',
  ];
  if (!i.joined && memberRoutes.includes(r))
    return (
      <Overlay close={() => e.reset('chooseIsland')}>
        <Txt kind="h17">가입한 섬이 없어요</Txt>
        <Txt kind="meta">섬을 선택하거나 새로 만든 뒤 이용할 수 있어요.</Txt>
        <Btn title="첫 섬 선택으로" onPress={() => e.reset('chooseIsland')} />
      </Overlay>
    );
  const locked: Partial<Record<Route, Building>> = {
    library: 'library',
    diary: 'library',
    stats: 'library',
    hall: 'hall',
    manage: 'hall',
    members: 'hall',
    ledger: 'hall',
    construction: 'hall',
    board: 'board',
    quest: 'board',
    questEdit: 'board',
    notice: 'board',
    noticeEdit: 'board',
    tower: 'tower',
    explore: 'tower',
    mail: 'mail',
    chat: 'mail',
    friendMail: 'mail',
    shop: 'shop',
    sound: 'gram',
  };
  const required = locked[r];
  if (required && !i.buildings.includes(required))
    return (
      <Overlay
        close={e.home}
        background={<FinalIsland state={state} go={e.go} build={e.build} showActions={false} />}
      >
        <Pic id={`bld/${buildingArt[required]}`} w={100} />
        <Txt kind="h17">아직 {buildingNames[required]}이 없어요</Txt>
        <Txt kind="meta">
          {required === 'library'
            ? '도서관을 짓기 전에는 지난 기록을 볼 수 없어요.'
            : '완공 후 이용할 수 있어요.'}
        </Txt>
        <Btn
          title={isHost(i) && i.buildings.includes('hall') ? '회관에서 다음 건물 보기' : '확인'}
          onPress={() =>
            isHost(i) && i.buildings.includes('hall') ? e.go('construction') : e.home()
          }
        />
      </Overlay>
    );
  if (r === 'home') return <Home e={e} />;
  if (['visit', 'approval'].includes(r)) return <Visit e={e} />;
  if (['arrival', 'travel'].includes(r)) return <Travel e={e} />;
  if (r === 'guide') return <Guide e={e} />;
  if (
    [
      'focusTravel',
      'fishingArrival',
      'focusSetup',
      'focus',
      'focusResult',
      'returnTravel',
      'rest',
    ].includes(r)
  )
    return <FocusFlow e={e} />;
  if (['library', 'diary', 'stats'].includes(r)) return <Library e={e} />;
  if (['hall', 'manage', 'members', 'ledger', 'construction'].includes(r))
    return <Hall key={r} e={e} />;
  if (['board', 'quest'].includes(r)) return <Board e={e} />;
  if (['tower', 'explore'].includes(r)) return <Tower e={e} />;
  if (['boat', 'friends', 'friendSearch', 'mail', 'chat', 'friendMail'].includes(r))
    return <Social e={e} />;
  if (['shop', 'product', 'orders', 'sound'].includes(r)) return <ShopMusic e={e} />;
  if (r === 'permission')
    return (
      <Sheet e={e} title="측정 권한">
        <Txt kind="h17">스크린타임 연결</Txt>
        <Txt>권한이 없으면 사용 시간을 알 수 없어요. 실제 0분과 기록 없음은 따로 표시해요.</Txt>
        <Group flat>
          <Row
            title="스크린타임 연결"
            tail={
              <Toggle
                label="스크린타임 연결"
                value={state.settings.permission}
                onChange={(value: boolean) =>
                  e.dispatch({ type: 'SETTING', key: 'permission', value })
                }
              />
            }
          />
        </Group>
        <Txt kind="meta">측정 연결을 끄면 사용 시간 퀘스트는 확인 필요로 표시해요.</Txt>
      </Sheet>
    );
  return <RedesignScreens e={e} />;
}
function Visit({ e }: any) {
  const s: State = e.state,
    i = currentIsland(s);
  const target =
    s.islands.find((j) => j.id === (e.detail || s.pendingIsland || e.visited)) ??
    s.islands.find((j) => j.id !== i.id) ??
    i;
  const pending = s.pendingIsland === target.id;
  const pendingForTarget = (s.pendingIslands ?? []).includes(target.id) || pending;
  const sail = () => {
    if (s.session) return e.notify('집중을 마친 뒤 이동해 주세요.');
    e.dispatch({ type: 'TRAVEL_FROM', name: i.name });
    e.setVisited(target.id);
    e.go('travel', target.id);
  };
  const join = () => {
    if (s.session) return e.notify('집중을 마친 뒤 가입해 주세요.');
    e.dispatch({ type: 'JOIN', id: target.id });
    if (target.approval) e.notify('가입신청을 보냈어요. 섬장의 수락을 기다려 주세요.');
    else {
      e.setVisited(target.id);
      e.go(s.onboarded ? 'travel' : 'arrival', target.id);
    }
  };
  return (
    <Sheet
      e={e}
      bg="tower"
      sign="bld/observatory"
      title="바다 건너 섬"
      onClose={s.onboarded ? e.home : () => e.replace('chooseIsland')}
      footer={
        <View style={{ gap: 8 }}>
          <Btn
            title={
              target.joined
                ? '배 타고 이동'
                : pendingForTarget
                  ? '가입신청 취소'
                  : target.approval
                    ? '가입신청'
                    : '가입하기'
            }
            disabled={!target.joined && !pendingForTarget && isFull(target)}
            onPress={
              target.joined
                ? sail
                : pendingForTarget
                  ? () => e.dispatch({ type: 'CANCEL_JOIN', id: target.id })
                  : join
            }
          />
          {!target.joined && <Btn title="배 타고 둘러보기" kind="glass" onPress={sail} />}
        </View>
      }
    >
      <View style={{ height: 180, overflow: 'hidden', borderRadius: 18 }}>
        <Image
          source={assets['backgrounds/island/day.png']}
          resizeMode="contain"
          style={{ width: '100%', height: '100%' }}
        />
      </View>
      <Txt kind="h">{target.name}</Txt>
      <Txt>{target.intro}</Txt>
      <Txt kind="meta">
        주민 {residentCount(target)} / {capacityOf(target)}명 · 이번 주 평균{' '}
        {hoursMinutes(islandWeeklyAverage(s, target, e.now))}
      </Txt>
      {pending && <Txt kind="meta">가입신청 중 · 다른 섬도 계속 둘러볼 수 있어요.</Txt>}
      {target.joined && <Txt kind="meta">이미 소속된 섬이에요.</Txt>}
    </Sheet>
  );
}
function Travel({ e }: any) {
  const s: State = e.state;
  const first = e.route === 'arrival';
  const target = first
    ? currentIsland(s)
    : (s.islands.find((j) => j.id === (e.detail || e.visited)) ?? currentIsland(s));
  return (
    <Sailing
      state={s}
      from={first ? '나의 뗏목' : (s.travelOrigin ?? currentIsland(s).name)}
      destination={target.name}
      duration={1900}
      onArrive={() => {
        if (first) {
          e.setGuideStep(0);
          e.replace('guide');
        } else if (target.joined) {
          e.dispatch({ type: 'SWITCH_ISLAND', id: target.id });
          e.home();
        } else e.replace('visit', target.id);
      }}
    />
  );
}
function Home({ e }: any) {
  const s: State = e.state,
    L = useAppLayout(),
    i = currentIsland(s),
    [guide, setGuide] = useState(s.hallGuide === 'pending');
  useEffect(() => {
    if (guide) e.dispatch({ type: 'HALL_GUIDE_DONE' });
  }, []);
  return (
    <View style={{ flex: 1 }}>
      <FinalIsland state={s} go={e.go} build={e.build} request={e.walkRequest} />
      {guide && !i.buildings.includes('hall') && (
        <View
          style={{
            position: 'absolute',
            left: 24,
            right: 24,
            bottom: L.insets.bottom + 160,
            padding: 18,
            gap: 10,
            borderWidth: 2,
            borderColor: C.brown,
            backgroundColor: C.cream,
            borderRadius: 22,
          }}
        >
          <Pic id="parrot" w={64} />
          <Txt>물고기를 모아 가장 먼저 마을회관을 지어보자. {costs.hall}마리면 돼!</Txt>
          <Btn small title="알겠어" onPress={() => setGuide(false)} />
        </View>
      )}
    </View>
  );
}
function Guide({ e }: any) {
  const L = useAppLayout(),
    lines = [
      '우리의 하루가 함께 자라는 섬에 온 걸 환영해!',
      '집중하는 동안 고양이가 낚시해서 물고기를 모아줘. 이 섬에 차곡차곡 쌓여!',
      '집중하기를 누르면 낚시섬으로 떠나. 원하는 땅을 눌러 앉고 할 일을 적으면 시작이야.',
      '잠깐 쉬고 싶으면 모닥불로 와. 함께 책을 읽다가 하던 자리로 돌아갈 수 있어.',
      '물고기로 건물을 지으면 새로운 활동이 열려. 이 안내는 내 뗏목 설정에서 다시 볼 수 있어!',
    ];
  return (
    <View style={{ flex: 1 }}>
      <FinalIsland state={e.state} go={e.go} build={e.build} showActions={false} />
      <View
        style={{
          position: 'absolute',
          left: (L.width - L.floatingWidth) / 2,
          width: L.floatingWidth,
          bottom: L.insets.bottom + 30,
          padding: 20,
          gap: 12,
          borderWidth: 2,
          borderColor: C.brown,
          backgroundColor: C.cream,
          borderRadius: 24,
        }}
      >
        <View style={k.row}>
          <Pic id="parrot" w={76} />
          <Btn small kind="ghost" title="건너뛸래" onPress={e.home} />
        </View>
        <Txt>{lines[e.guideStep] ?? lines[0]}</Txt>
        <Btn
          title={e.guideStep >= 4 ? '시작할게' : '다음'}
          onPress={() => (e.guideStep >= 4 ? e.home() : e.setGuideStep(e.guideStep + 1))}
        />
      </View>
    </View>
  );
}
function FocusFlow({ e }: any) {
  const s: State = e.state,
    i = currentIsland(s),
    L = useAppLayout(),
    r = e.route;
  const [fan, setFan] = useState(false),
    [emote, setEmote] = useState<string | null>(null),
    [walking, setWalking] = useState(false),
    [walker, setWalker] = useState<Point>(s.focusSpot ?? { x: 340, y: 1130 });
  const walkingToken = useRef(0),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      walkingToken.current++;
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  if (r === 'focusTravel')
    return (
      <Sailing
        state={s}
        from={i.name}
        destination="낚시섬"
        duration={1900}
        onArrive={() => e.replace('fishingArrival')}
      />
    );
  if (r === 'returnTravel')
    return (
      <Sailing state={s} from="낚시섬" destination={i.name} duration={1900} onArrive={e.home} />
    );
  const finish = () => {
    e.dispatch({ type: 'FINISH' });
    e.reset('focusResult');
  };
  if (r === 'rest')
    return (
      <RestGroup
        state={s}
        home={e.home}
        resume={() => {
          e.dispatch({ type: 'RESUME' });
          e.go('focus');
        }}
        endRest={finish}
      />
    );
  const selectSpot = (p: Point) => {
    if (r !== 'fishingArrival' || walking) return;
    // Keep a little room around residents, without introducing a numbered seat picker.
    const peers = i.members
      .filter((m) => m.focusing)
      .map((m, n) =>
        nearestLand(grids.fishing, {
          x: 350 + (n % 3) * 165,
          y: 520 + Math.floor(n / 3) * 170,
        }),
      );
    if (peers.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 65)) {
      e.notify('여기는 주민이 앉아 있어요. 조금 옆에 앉아 주세요.');
      return;
    }
    const path = landPath(grids.fishing, walker, p);
    if (!path.length) {
      e.notify('이곳까지 이어지는 땅을 골라 주세요.');
      return;
    }
    setWalking(true);
    const token = ++walkingToken.current;
    let n = 0;
    const next = () => {
      if (token !== walkingToken.current) return;
      if (n >= path.length) {
        setWalking(false);
        const spot = path.at(-1)!;
        e.dispatch({ type: 'FOCUS_SPOT', spot });
        e.go('focusSetup');
        return;
      }
      setWalker(path[n++]);
      timer.current = setTimeout(next, s.settings.reduceMotion ? 0 : 75);
    };
    next();
  };
  const scene = (
    <WorldMap
      state={s}
      fishing
      onSpot={selectSpot}
      emote={emote}
      children={
        ((scale: number) => (
          <>
            {i.members
              .filter((m) => m.focusing)
              .map((m, n) => (
                <FishingCat
                  key={m.id}
                  color={m.color}
                  name={m.name}
                  subject={m.subject}
                  seconds={m.seconds}
                  p={nearestLand(grids.fishing, {
                    x: 350 + (n % 3) * 165,
                    y: 520 + Math.floor(n / 3) * 170,
                  })}
                  scale={scale}
                  reduce={s.settings.reduceMotion}
                />
              ))}
            {r === 'fishingArrival' ? (
              <View
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  left: walker.x * scale,
                  top: walker.y * scale,
                }}
              >
                <CatSprite
                  color={s.color}
                  size={150 * scale}
                  motion={walking ? 'walking' : 'blink'}
                  reduce={s.settings.reduceMotion}
                />
              </View>
            ) : (
              <FishingCat
                color={s.color}
                name={s.name}
                subject={s.session?.subject ?? e.text}
                seconds={sessionSeconds(s.session, e.now)}
                p={s.focusSpot ?? walker}
                scale={scale}
                reduce={s.settings.reduceMotion}
                emote={emote}
              />
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="뗏목 · 우리 섬으로 돌아가기"
              onPress={() =>
                s.session
                  ? e.confirm(
                      '집중을 마칠까요?',
                      '이번 집중을 기록한 뒤 우리 섬으로 돌아가요.',
                      finish,
                    )
                  : e.go('returnTravel')
              }
              style={{
                position: 'absolute',
                left: 140 * scale,
                top: 1110 * scale,
                width: 180 * scale,
                height: 150 * scale,
              }}
            >
              <Pic id="boat/raft" w="100%" h="100%" />
            </Pressable>
          </>
        )) as any
      }
    />
  );
  if (r === 'focusResult') {
    const result = s.lastResult;
    return (
      <View style={{ flex: 1 }}>
        {s.resultFromRest ? (
          <FinalIsland state={s} go={e.go} build={e.build} showActions={false} />
        ) : (
          scene
        )}
        <IslandPopup onClose={() => (s.resultFromRest ? e.home() : e.go('returnTravel'))}>
          <View style={k.row}>
            <Pic id={`cat/${s.color}/sitting`} w={86} />
            <View style={{ flex: 1 }}>
              <Txt kind="meta">{result?.subject ?? '이번 집중'}</Txt>
              <Txt kind="h" style={{ fontSize: 38, lineHeight: 46 }}>
                {clock(result?.seconds ?? 0)}
              </Txt>
            </View>
          </View>
          <View style={[k.group, { padding: 16, backgroundColor: C.butter }]}>
            <View style={k.row}>
              <Pic id="fish" w={44} />
              <Txt kind="h17">이 섬에 +{result?.fish ?? 0}마리</Txt>
            </View>
            <Txt kind="meta">{i.name}의 물고기로 쌓였어요.</Txt>
          </View>
          <Txt kind="section">이번 일일 퀘스트</Txt>
          {i.quests.map((q) => (
            <Row
              key={q.id}
              title={q.title}
              sub={
                q.type === 'screen'
                  ? '다음 날 사용 시간으로 정산해요'
                  : q.rounds?.[dayKey(e.now)]?.achieved.includes('me')
                    ? '달성했어요'
                    : '진행 중'
              }
            />
          ))}
          <Btn
            title="섬으로 돌아가기"
            onPress={() => (s.resultFromRest ? e.home() : e.go('returnTravel'))}
          />
        </IslandPopup>
        <RewardModal e={e} />
      </View>
    );
  }
  return (
    <View style={{ flex: 1 }}>
      {scene}
      {r === 'fishingArrival' && (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: 24,
            right: 24,
            top: L.insets.top + 18,
            alignItems: 'center',
          }}
        >
          <Txt
            style={{
              backgroundColor: '#fff7ebdb',
              borderRadius: 20,
              padding: 12,
            }}
          >
            {walking ? '자리로 걸어가는 중…' : '원하는 땅을 눌러 앉아 주세요'}
          </Txt>
        </View>
      )}
      {r === 'focusSetup' && (
        <Overlay close={e.back}>
          <View style={[k.row, { justifyContent: 'space-between' }]}>
            <Txt kind="h17">오늘의 할 일</Txt>
            <Close onPress={e.back} />
          </View>
          <Field value={e.text} onChange={e.setText} placeholder="수학 문제 풀기" />
          <Btn
            title="집중 시작"
            id="start-focus"
            disabled={!e.text.trim()}
            onPress={() => {
              if (!i.joined) {
                e.notify('섬에 가입한 뒤 집중할 수 있어요.');
                e.replace('chooseIsland');
                return;
              }
              e.dispatch({ type: 'START', subject: e.text });
              e.go('focus');
            }}
          />
        </Overlay>
      )}
      {r === 'focus' && (
        <>
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: L.insets.top + 18,
              left: L.compact ? 24 : 0,
              right: L.compact ? undefined : 0,
              alignItems: 'center',
              gap: 4,
            }}
          >
            <Txt
              style={{
                fontWeight: '600',
                textShadowColor: C.paper,
                textShadowRadius: 3,
              }}
            >
              {s.session?.subject}
            </Txt>
            <Txt
              style={{
                fontSize: 44,
                lineHeight: 53,
                fontWeight: '800',
                fontVariant: ['tabular-nums'],
                textShadowColor: C.paper,
                textShadowRadius: 5,
              }}
            >
              {clock(sessionSeconds(s.session, e.now))}
            </Txt>
          </View>
          {i.buildings.includes('gram') && (
            <View
              style={{
                position: 'absolute',
                top: L.insets.top + 18,
                right: 16,
              }}
            >
              <Btn
                small
                kind="glass"
                title={`♫ ${tracks[i.track] ?? '음악 선택'}`}
                onPress={() => e.go('sound')}
              />
            </View>
          )}
          <View
            style={{
              position: 'absolute',
              bottom: L.insets.bottom + 16,
              left: (L.width - L.floatingWidth) / 2,
              width: L.floatingWidth,
              gap: 12,
            }}
          >
            {fan && (
              <View
                style={[
                  k.row,
                  {
                    padding: 8,
                    backgroundColor: '#fff7ebe6',
                    borderRadius: 30,
                  },
                ]}
              >
                {['hello', 'cheer', 'sleepy', 'laugh', 'hearts'].map((id, n) => (
                  <Pressable
                    key={id}
                    accessibilityRole="button"
                    accessibilityLabel={['인사', '응원', '졸림', '웃음', '하트'][n]}
                    onPress={() => {
                      setEmote(id);
                      setFan(false);
                      if (timer.current) clearTimeout(timer.current);
                      timer.current = setTimeout(() => setEmote(null), 2000);
                    }}
                    style={{
                      flex: 1,
                      alignItems: 'center',
                      minHeight: 44,
                      justifyContent: 'center',
                    }}
                  >
                    <Pic id={`emote/${id}`} w={32} />
                  </Pressable>
                ))}
              </View>
            )}
            <View style={k.row}>
              <Btn title="응원" small kind="glass" onPress={() => setFan(!fan)} />
              <Btn
                title="휴식하기"
                style={{ flex: 1 }}
                onPress={() => {
                  e.dispatch({ type: 'PAUSE' });
                  e.go('rest');
                }}
              />
              <Btn
                title="집중 종료"
                small
                kind="glass"
                onPress={() =>
                  e.confirm(
                    '집중을 마칠까요?',
                    `지금까지 집중한 ${clock(sessionSeconds(s.session, e.now))}를 기록해요.`,
                    finish,
                  )
                }
              />
            </View>
          </View>
          <RewardModal e={e} />
        </>
      )}
    </View>
  );
}
function FishingCat({ color, name, subject, seconds, p, scale, emote, reduce }: any) {
  const [frame, setFrame] = useState(0),
    [reeling, setReeling] = useState(false);
  const count = Math.floor(seconds / SECONDS_PER_FISH),
    last = useRef(count);
  useEffect(() => {
    if (count <= last.current) {
      last.current = count;
      return;
    }
    last.current = count;
    if (reduce) return;
    setReeling(true);
    const t = setTimeout(() => setReeling(false), 1600);
    return () => clearTimeout(t);
  }, [count, reduce]);
  useEffect(() => {
    if (reduce) return;
    const t = setInterval(() => setFrame((f) => (f + 1) % 4), reeling ? 200 : 333);
    return () => clearInterval(t);
  }, [reduce, reeling]);
  const size = 180 * scale;
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: p.x * scale - size / 2,
        top: p.y * scale - size,
        width: size,
        height: size,
      }}
    >
      <Svg
        width={size * 1.8}
        height={size}
        style={{ position: 'absolute', left: size * 0.6, top: size * 0.42 }}
      >
        <Path
          d={`M 0 0 Q ${size * 0.5} ${size * 0.2} ${size * 1.1} ${size * 0.65}`}
          stroke="#6c6651"
          strokeWidth={1}
          fill="none"
        />
      </Svg>
      <Image
        source={cat(color, `fishing/${reeling ? 'reel' : 'fishing'}-frame-${frame}`)}
        style={{ width: size, height: size }}
        resizeMode="contain"
      />
      <Image
        source={assets['props/fishing/fishing-rod.png']}
        style={{
          position: 'absolute',
          left: size * 0.54,
          top: size * 0.19,
          width: size * 0.58,
          height: size * 0.65,
        }}
        resizeMode="contain"
      />
      {count > 0 && (
        <Image
          source={
            assets[
              `props/fishing/catch/${count >= 5 ? 'pile-large' : count > 1 ? 'pile-small' : 'single'}.png`
            ]
          }
          resizeMode="contain"
          style={{
            position: 'absolute',
            left: -size * 0.3,
            top: size * 0.75,
            width: size * 0.5,
            height: size * 0.45,
          }}
        />
      )}
      <View
        style={{
          position: 'absolute',
          bottom: size * 0.94,
          left: -30,
          right: -30,
          alignItems: 'center',
        }}
      >
        {emote ? (
          <Pic id={`emote/${emote}`} w={40} />
        ) : (
          <Txt
            style={{
              fontSize: 11,
              backgroundColor: '#fff7ebc9',
              paddingHorizontal: 8,
              paddingVertical: 3,
              borderRadius: 10,
            }}
          >
            {subject} · {clock(seconds)}
          </Txt>
        )}
      </View>
      <View
        style={{
          position: 'absolute',
          top: size * 0.94,
          left: -30,
          right: -30,
          alignItems: 'center',
        }}
      >
        <Txt
          style={{
            fontSize: 12,
            backgroundColor: '#fff7ebbd',
            paddingHorizontal: 8,
            borderRadius: 8,
          }}
        >
          {name}
        </Txt>
      </View>
    </View>
  );
}
function RewardModal({ e }: any) {
  const s: State = e.state,
    reward = s.rewards?.find((r) => !r.acknowledged);
  if (!reward) return null;
  const owner = s.islands.find((i) => i.id === reward.islandId),
    q = owner?.quests.find((q) => q.id === reward.questId);
  return (
    <Overlay close={() => {}}>
      <View style={{ alignItems: 'center', gap: 12 }}>
        <Pic id="fish/few" w={96} />
        <Txt kind="h">{reward.kind === 'bonus' ? '모두 해냈어요!' : '퀘스트 달성!'}</Txt>
        <Txt>{q?.title}</Txt>
        <Txt kind="h17">
          {reward.kind === 'bonus'
            ? `섬에 보너스 ${reward.amount}마리가 쌓였어요`
            : `${owner?.name}에 물고기 ${reward.amount}마리를 보태요`}
        </Txt>
        <Btn
          title={reward.kind === 'bonus' ? '좋아요' : '보상받기'}
          id="claim-reward"
          onPress={() => e.dispatch({ type: 'CLAIM', id: reward.id })}
        />
      </View>
    </Overlay>
  );
}
function Board({ e }: any) {
  const s: State = e.state,
    i = currentIsland(s),
    host = isHost(i),
    L = useAppLayout(),
    q = i.quests.find((q) => q.id === e.detail),
    tab = e.tab || '퀘스트',
    round = q?.rounds?.[dayKey(e.now)];
  const construction = i.construction,
    goal = i.buildingQuest;
  const targets = goal?.targets ?? [],
    names = (id: string) =>
      id === 'me' ? s.name : (i.members.find((m) => m.id === id)?.name ?? '탈퇴한 주민');
  const buildingCard = goal && (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${buildingNames[goal.building]} 건설 퀘스트`}
      onPress={() => e.go('quest', 'building')}
      style={{
        padding: 18,
        gap: 10,
        backgroundColor: '#bcdccd',
        borderRadius: 3,
        transform: [{ rotate: '-1deg' }],
        boxShadow: '2px 4px 3px #694b3445',
      }}
    >
      <Txt kind="h17">{buildingNames[goal.building]} 건설 퀘스트</Txt>
      <Txt>
        주민 {targets.filter((id) => collectedBy(i, id) >= buildingShare(i, goal.building)).length}/
        {targets.length}명 · 각자 {buildingShare(i, goal.building)}마리
      </Txt>
      <Txt kind="meta">
        섬 잔액 {balance(i)}/{buildingCost(i, goal.building)}마리
      </Txt>
      {buildingReady(i) && <Txt style={{ color: '#2f7a57', fontWeight: '800' }}>완료 ✓</Txt>}
    </Pressable>
  );
  if (e.route === 'board')
    return (
      <Sheet
        e={e}
        bg="board"
        sign="bld/notice-board"
        title="게시판"
        action={host ? (tab === '퀘스트' ? '＋ 만들기' : '＋ 작성') : undefined}
        actionPress={
          host ? () => (tab === '퀘스트' ? e.newQuest() : e.go('noticeEdit')) : undefined
        }
      >
        <Seg items={['퀘스트', '공지']} value={tab} onChange={e.setTab} />
        {tab === '공지' ? (
          i.notices.map((n) => (
            <Pressable
              key={n.id}
              accessibilityRole="button"
              accessibilityLabel={n.title}
              onPress={() => e.go('notice', n.id)}
              style={{
                padding: 18,
                backgroundColor: C.paper,
                transform: [{ rotate: '-1deg' }],
                gap: 7,
              }}
            >
              <Txt kind="h17">{n.title}</Txt>
              <Txt kind="meta">댓글 {n.comments.length}</Txt>
            </Pressable>
          ))
        ) : (
          <>
            {construction ? (
              <View style={{ padding: 18, gap: 8, backgroundColor: '#bcdccd' }}>
                <Txt kind="h17">{buildingNames[construction.building]} 공사 중</Txt>
                <Txt>
                  {buildMinutes[construction.building]}분 중{' '}
                  {Math.max(0, Math.ceil((construction.endsAt - e.now) / 60000))}분 남음
                </Txt>
                <Bar
                  value={Math.min(
                    100,
                    ((e.now - construction.startedAt) /
                      (construction.endsAt - construction.startedAt)) *
                      100,
                  )}
                />
                <Txt kind="meta">공사가 끝나면 다음 목표를 고를 수 있어요.</Txt>
              </View>
            ) : (
              buildingCard
            )}
            {i.quests.map((q, n) => (
              <Pressable
                key={q.id}
                accessibilityRole="button"
                accessibilityLabel={q.title}
                onPress={() => e.go('quest', q.id)}
                style={{
                  padding: 18,
                  gap: 10,
                  backgroundColor: n % 2 ? '#edbcc5' : '#f5df91',
                  transform: [{ rotate: n % 2 ? '-1deg' : '1deg' }],
                  boxShadow: '2px 4px 3px #694b3445',
                }}
              >
                <Txt kind="meta">일일 · {q.type === 'focus' ? '집중' : '스크린타임'}</Txt>
                <Txt kind="h17">{q.title}</Txt>
                <Txt>{q.type === 'focus' ? `${q.target}분 집중` : `하루 ${q.target}분 이내`}</Txt>
                <Txt kind="meta">각자 달성 +10마리 · 모두 달성 보너스</Txt>
              </Pressable>
            ))}
          </>
        )}
        <RewardModal e={e} />
      </Sheet>
    );
  if (e.detail === 'building')
    return (
      <Sheet
        e={e}
        bg="board"
        sign="bld/notice-board"
        title="건설 퀘스트"
        footer={
          goal && !construction ? (
            <Btn
              title={isHost(i) ? '건설하기' : '방장이 건설할 수 있어요'}
              disabled={!isHost(i) || !buildingReady(i)}
              onPress={() => e.build(goal.building)}
            />
          ) : undefined
        }
      >
        {construction ? (
          <>
            <Txt kind="h17">{buildingNames[construction.building]} 공사 중</Txt>
            <Txt>{Math.max(0, Math.ceil((construction.endsAt - e.now) / 60000))}분 남음</Txt>
          </>
        ) : goal ? (
          <>
            <Txt kind="h">{buildingNames[goal.building]}을 함께 지어요</Txt>
            <Txt>
              총 {costs[goal.building]}마리 · 대상 주민 모두 각자 {buildingShare(i, goal.building)}
              마리
            </Txt>
            <Group flat>
              {targets.map((id) => (
                <Row
                  key={id}
                  title={names(id)}
                  tail={
                    <Txt>
                      {collectedBy(i, id)}/{buildingShare(i, goal.building)}
                      마리 {collectedBy(i, id) >= buildingShare(i, goal.building) ? '✓' : ''}
                    </Txt>
                  }
                />
              ))}
            </Group>
            <Strip
              label="섬 물고기 잔액"
              value={`${balance(i)}/${buildingCost(i, goal.building)}마리`}
            />
            <Txt kind="meta">
              건설하기를 누르면 {buildingCost(i, goal.building)}마리 차감 ·{' '}
              {buildMinutes[goal.building]}분 공사
            </Txt>
            {buildingReady(i) ? (
              <Txt kind="h17" style={{ color: '#2f7a57' }}>
                완료 ✓
              </Txt>
            ) : (
              <Txt kind="meta">
                {targets.every((id) => collectedBy(i, id) >= buildingShare(i, goal.building))
                  ? '잔액이 부족해요. 부족한 만큼 다시 채워요.'
                  : '대상 주민 모두가 목표를 채우면 완료돼요.'}
              </Txt>
            )}
          </>
        ) : (
          <Empty>회관에서 다음 건물을 골라 주세요.</Empty>
        )}
      </Sheet>
    );
  if (!q)
    return (
      <Sheet e={e} bg="board" title="퀘스트">
        <Empty>퀘스트를 찾을 수 없어요.</Empty>
      </Sheet>
    );
  return (
    <Sheet
      e={e}
      bg="board"
      sign="bld/notice-board"
      title="일일 퀘스트"
      action={host ? '수정' : undefined}
      actionPress={
        host
          ? () => {
              e.go('questEdit', q.id);
              e.setText(q.title);
              e.setBody(q.type);
              e.setWindowStart(q.windowStart ?? '00:00');
              e.setWindowEnd(q.windowEnd ?? '24:00');
            }
          : undefined
      }
    >
      <Txt kind="h">{q.title}</Txt>
      <Txt>{q.type === 'focus' ? `${q.target}분 집중하기` : `스크린타임 ${q.target}분 이내`}</Txt>
      {q.windowStart && (
        <Txt kind="meta">
          {q.windowStart} — {q.windowEnd}
        </Txt>
      )}
      <Group flat>
        {(round?.targets ?? ['me', ...i.members.map((m) => m.id)]).map((id) => (
          <Row
            key={id}
            title={names(id)}
            sub={
              q.type === 'screen'
                ? '다음 날 정산'
                : round?.achieved.includes(id)
                  ? '달성'
                  : '진행 중'
            }
            tail={
              <Txt>
                {round?.achieved.includes(id)
                  ? '✓'
                  : questMemberRate(s, q, id, i.id, e.now) == null
                    ? '확인 필요'
                    : `${questMemberRate(s, q, id, i.id, e.now)}%`}
              </Txt>
            }
          />
        ))}
      </Group>
      <Txt kind="meta">
        각자 달성할 때 물고기 10마리 · 모두 달성하면 대상 인원의 5배만큼 보너스. 매일 새 회차로
        진행해요.
      </Txt>
      <RewardModal e={e} />
    </Sheet>
  );
}
function Tower({ e }: any) {
  const s: State = e.state,
    i = currentIsland(s),
    [query, setQuery] = useState('');
  const visibleIslands = s.islands.filter(
      (j) => !j.closed && (j.joined || j.visibility !== 'private'),
    ),
    ranked = visibleIslands
      .filter((island) => residentCount(island) >= 2)
      .sort((a, b) => islandWeeklyAverage(s, b, e.now) - islandWeeklyAverage(s, a, e.now)),
    inviteTarget = findIslandByInviteCode(s.islands, query),
    results = s.islands.filter(
      (j) =>
        !j.closed &&
        j.id !== i.id &&
        (j.id === inviteTarget?.id ||
          ((j.joined || j.visibility !== 'private') &&
            (!query ||
              j.name.includes(query) ||
              j.id.toLowerCase().includes(query.toLowerCase())))),
    );
  return (
    <Sheet
      e={e}
      title="전망대"
      tall={e.route !== 'tower'}
      bg="tower"
      sign="bld/observatory"
      action={e.route === 'tower' ? '섬 찾기' : undefined}
      actionPress={() => e.go('explore')}
    >
      {e.route === 'tower' ? (
        <>
          <Txt kind="h17">다른 섬 평균 집중 랭킹</Txt>
          <Txt kind="meta">이번 주 · 월요일 00시 초기화</Txt>
          <Group flat>
            {ranked.map((j, n) => (
              <Row
                key={j.id}
                title={`${n + 1}  ${j.name}`}
                sub={`주민 ${residentCount(j)}명 · ${j.id === i.id ? '우리 섬' : j.joined ? '가입한 섬' : '다른 섬'}`}
                tail={<Txt>{hoursMinutes(islandWeeklyAverage(s, j, e.now))}</Txt>}
                chevron={j.id !== i.id}
                onPress={j.id === i.id ? undefined : () => e.go('visit', j.id)}
              />
            ))}
          </Group>
          <Txt kind="meta">해당 섬에서 집중한 시간의 합계 ÷ 전체 주민 수</Txt>
        </>
      ) : (
        <>
          <Field value={query} onChange={setQuery} placeholder="섬 이름 또는 초대 코드" />
          <Group flat>
            {results.map((j) => (
              <Row
                key={j.id}
                title={j.name}
                sub={`${j.approval ? '승인 후 가입' : '바로 가입'} · ${residentCount(j)}/${capacityOf(j)}명`}
                tail={<Txt>{j.joined ? '가입한 섬' : '›'}</Txt>}
                onPress={() => e.go('visit', j.id)}
              />
            ))}
          </Group>
          {!results.length && <Empty>검색 결과가 없어요.</Empty>}
        </>
      )}
    </Sheet>
  );
}
const directory: Omit<Friend, 'status' | 'messages'>[] = [
  { id: 'saebom', name: '새봄', color: 'white', island: '딸기 섬' },
  { id: 'minji', name: '민지', color: 'ginger', island: '소다 섬' },
  { id: 'haneul', name: '하늘', color: 'calico', island: '구름 섬' },
  { id: 'bori', name: '보리', color: 'cream', island: '구름 섬' },
];
function Social({ e }: any) {
  const s: State = e.state,
    i = currentIsland(s),
    r = e.route,
    [query, setQuery] = useState(''),
    chatRef = useRef<ScrollView>(null),
    friends = s.friends ?? [];
  const friend = friends.find((f) => f.id === e.detail),
    msgs = r === 'friendMail' ? (friend?.messages ?? []) : i.messages;
  useEffect(() => {
    if (r === 'chat' || r === 'friendMail')
      chatRef.current?.scrollToEnd({ animated: !s.settings.reduceMotion });
  }, [msgs.length, r]);
  if (r === 'boat')
    return (
      <Sheet e={e} title="내 뗏목" tall={false}>
        <BoatPortrait state={s} height={160} />
        <Txt kind="h17">{s.name}의 뗏목</Txt>
        <Group flat>
          <Row title="내 꾸미기" sub="보유 의상 착용" chevron onPress={() => e.go('wardrobe')} />
          <Row
            title="친구 관리"
            sub={
              friends.filter((f) => f.status === 'received').length
                ? `받은 요청 ${friends.filter((f) => f.status === 'received').length}`
                : '친구 찾기 · 요청 · 목록'
            }
            chevron
            onPress={() => e.go('friends')}
          />
          <Row title="내 정보" sub={s.name} chevron onPress={() => e.go('profile')} />
          <Row title="앱 설정" chevron onPress={() => e.go('settings')} />
        </Group>
      </Sheet>
    );
  if (r === 'friends')
    return (
      <Sheet e={e} title="친구 관리" action="친구 찾기" actionPress={() => e.go('friendSearch')}>
        {(['received', 'sent', 'friend'] as const).map((status, n) => (
          <View key={status} style={{ gap: 8 }}>
            <Txt kind="section">
              {['받은 요청', '보낸 요청', '친구'][n]}{' '}
              {friends.filter((f) => f.status === status).length}
            </Txt>
            <Group flat>
              {friends
                .filter((f) => f.status === status)
                .map((f) => (
                  <Row
                    key={f.id}
                    title={f.name}
                    sub={`${f.island}${status === 'sent' ? ' · 수락 기다리는 중' : ''}`}
                    icon={`avatar/${f.color}`}
                    tail={
                      status === 'received' ? (
                        <View style={k.row}>
                          <Btn
                            small
                            title="수락"
                            onPress={() => e.dispatch({ type: 'FRIEND_ACCEPT', id: f.id })}
                          />
                          <Btn
                            small
                            kind="ghost"
                            title="거절"
                            onPress={() => e.dispatch({ type: 'FRIEND_REJECT', id: f.id })}
                          />
                        </View>
                      ) : (
                        <Btn
                          small
                          kind={status === 'friend' ? 'danger' : 'ghost'}
                          title={status === 'friend' ? '친구 삭제' : '요청 취소'}
                          onPress={() =>
                            status === 'friend'
                              ? e.confirm(
                                  '친구를 삭제할까요?',
                                  `${f.name}과의 친구 관계를 삭제해요.`,
                                  () =>
                                    e.dispatch({
                                      type: 'FRIEND_DELETE',
                                      id: f.id,
                                    }),
                                )
                              : e.dispatch({ type: 'FRIEND_CANCEL', id: f.id })
                          }
                        />
                      )
                    }
                  />
                ))}
              {!friends.some((f) => f.status === status) && <Empty>아직 없어요.</Empty>}
            </Group>
          </View>
        ))}
      </Sheet>
    );
  if (r === 'friendSearch')
    return (
      <Sheet e={e} title="친구 찾기">
        <Field value={query} onChange={setQuery} placeholder="친구 이름 또는 ID" />
        {query.trim() ? (
          <Group flat>
            {directory
              .filter((f) => f.name.includes(query) || f.id.includes(query.toLowerCase()))
              .map((f) => {
                const status = friends.find((j) => j.id === f.id)?.status ?? 'none';
                return (
                  <Row
                    key={f.id}
                    title={f.name}
                    sub={`${f.island} · ${f.id}`}
                    icon={`avatar/${f.color}`}
                    tail={
                      <Btn
                        small
                        title={
                          status === 'friend'
                            ? '친구'
                            : status === 'received'
                              ? '받은 요청'
                              : status === 'sent'
                                ? '요청 중'
                                : '친구 요청'
                        }
                        disabled={status !== 'none'}
                        onPress={() => {
                          e.dispatch({
                            type: 'FRIEND_REQUEST',
                            id: f.id,
                            friend: f,
                          });
                          e.notify('친구 요청을 보냈어요. 수락하면 친구가 돼요.');
                        }}
                      />
                    }
                  />
                );
              })}
          </Group>
        ) : (
          <Empty>다른 섬 친구도 찾을 수 있어요.</Empty>
        )}
      </Sheet>
    );
  if (r === 'mail')
    return (
      <Sheet e={e} title="우체통" bg="mail" sign="bld/mailbox" tall={false}>
        <Group flat>
          <Row
            title="우리 섬 편지방"
            sub="이 섬 주민 모두에게"
            chevron
            onPress={() => e.go('chat')}
          />
          <Row
            title="친구 편지"
            sub="다른 섬에 있는 친구와도 이야기해요"
            chevron
            onPress={() => e.go('friendMail', 'list')}
          />
        </Group>
      </Sheet>
    );
  if (r === 'friendMail' && e.detail === 'list')
    return (
      <Sheet e={e} title="친구 편지" bg="mail" sign="bld/mailbox">
        <Group flat>
          {friends
            .filter((f) => f.status === 'friend')
            .map((f) => (
              <Row
                key={f.id}
                title={f.name}
                icon={`avatar/${f.color}`}
                sub={`${f.island} · ${f.messages.at(-1)?.text ?? '첫 편지를 보내 보세요'}`}
                chevron
                onPress={() => e.go('friendMail', f.id)}
              />
            ))}
        </Group>
        {!friends.some((f) => f.status === 'friend') && (
          <Empty>내 뗏목에서 친구를 추가해 주세요.</Empty>
        )}
      </Sheet>
    );
  if (r === 'friendMail' && friend?.status !== 'friend')
    return (
      <Sheet e={e} title="친구 편지" bg="mail" sign="bld/mailbox">
        <Empty>현재 친구 관계에서만 편지를 보낼 수 있어요.</Empty>
      </Sheet>
    );
  return (
    <IslandSheet
      bg="mail"
      sign={r === 'friendMail' ? `avatar/${friend?.color}` : 'bld/mailbox'}
      signKind={r === 'friendMail' ? 'av' : ''}
      title={r === 'friendMail' ? friend!.name : '우리 섬 편지방'}
      tall
      onBack={e.back}
      onClose={e.home}
      scrollRef={chatRef}
      footer={
        <View style={k.row}>
          <View style={{ flex: 1 }}>
            <Field value={e.text} onChange={e.setText} placeholder="편지 보내기" />
          </View>
          <Btn
            title="보내기"
            small
            disabled={!e.text.trim()}
            onPress={() => {
              e.dispatch({
                type: r === 'friendMail' ? 'FRIEND_MESSAGE' : 'MESSAGE',
                id: friend?.id,
                text: e.text,
              });
              e.setText('');
            }}
          />
        </View>
      }
    >
      <Txt kind="meta">
        {r === 'friendMail'
          ? `${friend?.island} · 둘만의 편지`
          : `${i.name}의 모든 주민이 볼 수 있어요`}
      </Txt>
      {msgs.map((m) => (
        <View
          key={m.id}
          style={{
            alignItems: m.memberId === 'me' ? 'flex-end' : 'flex-start',
            gap: 5,
          }}
        >
          <Txt kind="meta">
            {m.name} · {date(m.at)}
          </Txt>
          <View
            style={{
              backgroundColor: m.memberId === 'me' ? C.soft : C.paper,
              padding: 14,
              borderWidth: 1.5,
              borderColor: C.brown,
              borderRadius: 18,
              maxWidth: '88%',
            }}
          >
            <Txt>{m.text}</Txt>
          </View>
          {m.status === 'failed' && (
            <Btn
              small
              kind="danger"
              title="다시 보내기"
              onPress={() =>
                e.dispatch({
                  type: r === 'friendMail' ? 'FRIEND_RETRY' : 'RETRY_MESSAGE',
                  id: m.id,
                  friend: friend?.id,
                })
              }
            />
          )}
        </View>
      ))}
      {!msgs.length && <Empty>첫 편지를 남겨 보세요.</Empty>}
    </IslandSheet>
  );
}
function ShopMusic({ e }: any) {
  const s: State = e.state,
    i = currentIsland(s),
    r = e.route,
    [tab, setTab] = useState(e.tab || '내 꾸미기'),
    [filter, setFilter] = useState('전체'),
    [preview, setPreview] = useState(false);
  const product = products.find((p) => p.id === e.detail),
    music = r === 'sound' || product?.kind === 'audio',
    bg = music ? 'gram' : 'shop',
    sign = music ? 'bld/gramophone' : 'dog';
  const previewRef = useRef(preview);
  previewRef.current = preview;
  useEffect(
    () => () => {
      if (previewRef.current) {
        try {
          e.player.pause();
        } catch {}
        e.setPreviewAudio(false);
      }
    },
    [],
  );
  const owned = (p: (typeof products)[number]) =>
    (p.kind === 'clothes' ? s.owned : i.sharedOwned).includes(p.id);
  useEffect(() => {
    if (previewRef.current) {
      try {
        e.player.pause();
      } catch {}
      e.setPreviewAudio(false);
    }
    setPreview(false);
  }, [r, e.detail]);
  const apply = (p: (typeof products)[number]) => {
    if (p.kind === 'clothes') e.dispatch({ type: 'EQUIP', key: 'clothes', value: p.id });
    else if (p.kind === 'audio') {
      setPreview(false);
      e.setPreviewAudio(false);
      e.dispatch({ type: 'TRACK', value: p.id });
    } else
      e.dispatch({
        type: 'THEME',
        kind: p.kind,
        building: p.building,
        value: p.id,
      });
  };
  if (r === 'sound')
    return (
      <Sheet
        e={e}
        title="축음기"
        bg="gram"
        sign="bld/gramophone"
        onClose={s.session ? e.back : undefined}
        action={s.session ? undefined : '음원 사기'}
        actionPress={() => setTab('음원 사기')}
        tall={false}
      >
        {!s.session && (
          <Seg
            items={['보유 음원', '음원 사기']}
            value={tab === '음원 사기' ? tab : '보유 음원'}
            onChange={setTab}
          />
        )}
        {tab === '음원 사기' && !s.session ? (
          <>
            <Strip label="섬 물고기 잔액" value={`${balance(i)}마리`} />
            <Group flat>
              {products
                .filter((p) => p.kind === 'audio')
                .map((p) => (
                  <Row
                    key={p.id}
                    title={p.title}
                    sub={owned(p) ? '보유 중' : `${p.price}마리`}
                    chevron
                    onPress={() => e.go('product', p.id)}
                  />
                ))}
            </Group>
          </>
        ) : (
          <>
            <Group flat>
              {i.sharedOwned
                .filter((id) => tracks[id])
                .map((id) => (
                  <Row
                    key={id}
                    title={tracks[id]}
                    onPress={() => e.dispatch({ type: 'TRACK', value: id })}
                    tail={<Txt>{i.track === id ? (i.playing ? '♫' : '●') : '○'}</Txt>}
                  />
                ))}
            </Group>
            <Btn
              kind="glass"
              title={
                i.playing
                  ? s.session?.status === 'active'
                    ? '함께 재생 멈추기'
                    : '집중할 때 재생 끄기'
                  : '집중할 때 함께 재생하기'
              }
              onPress={() => e.dispatch({ type: 'PLAY', value: !i.playing })}
            />
            <Txt kind="section">내 기기 음량</Txt>
            <Seg
              items={['작게', '보통', '크게']}
              value={
                (s.settings as any).volume === 0.25
                  ? '작게'
                  : (s.settings as any).volume === 0.9
                    ? '크게'
                    : '보통'
              }
              onChange={(v: string) =>
                e.dispatch({
                  type: 'SETTING',
                  key: 'volume',
                  value: v === '작게' ? 0.25 : v === '크게' ? 0.9 : 0.55,
                })
              }
            />
            <Row
              title="내 기기 소리"
              sub="다른 주민의 소리는 그대로예요"
              tail={
                <Toggle
                  label="내 기기 소리"
                  value={s.settings.sound}
                  onChange={(value: boolean) =>
                    e.dispatch({ type: 'SETTING', key: 'sound', value })
                  }
                />
              }
            />
          </>
        )}
      </Sheet>
    );
  if (r === 'orders')
    return (
      <Sheet e={e} title="구매 내역" bg="shop" sign="dog" tall={false}>
        <Seg
          items={['내 구매', '공동 구매']}
          value={tab === '공동 구매' ? tab : '내 구매'}
          onChange={setTab}
        />
        <Group flat>
          {s.orders
            .filter((o) => {
              const p = products.find((p) => p.id === o.product);
              return tab === '공동 구매'
                ? o.islandId === i.id && p?.kind !== 'clothes'
                : p?.kind === 'clothes';
            })
            .map((o) => (
              <Row
                key={o.id}
                title={products.find((p) => p.id === o.product)?.title ?? o.product}
                sub={`${date(o.at)} · ${o.buyer ?? s.name}`}
                tail={<Txt>−{o.price}마리</Txt>}
              />
            ))}
        </Group>
        {!s.orders.length && <Empty>구매 내역이 없어요.</Empty>}
      </Sheet>
    );
  if (r === 'product') {
    if (!product)
      return (
        <Sheet e={e} title="상품" bg={bg} sign={sign}>
          <Empty>상품을 찾을 수 없어요.</Empty>
        </Sheet>
      );
    const p = product,
      isOwned = owned(p),
      error = canBuy(s, p),
      active =
        p.kind === 'clothes'
          ? s.equipped.clothes === p.id
          : p.kind === 'island'
            ? i.theme === p.id
            : p.kind === 'building'
              ? i.buildingThemes?.[p.building ?? 'hall'] === p.id
              : i.track === p.id;
    return (
      <Sheet
        e={e}
        title={music ? '음원 사기' : '상품 상세'}
        bg={bg}
        sign={sign}
        footer={
          <Btn
            title={
              isOwned
                ? active && p.kind !== 'audio'
                  ? '적용 해제'
                  : p.kind === 'audio'
                    ? '함께 재생'
                    : '바로 적용'
                : `섬 물고기 ${p.price}마리로 구매`
            }
            disabled={!isOwned && !!error}
            onPress={() =>
              isOwned
                ? active && p.kind !== 'audio'
                  ? e.dispatch({
                      type: p.kind === 'clothes' ? 'EQUIP' : 'THEME',
                      key: 'clothes',
                      kind: p.kind,
                      building: p.building,
                      value: 'default',
                    })
                  : apply(p)
                : e.confirm(
                    '구매할까요?',
                    `${i.name}의 물고기 ${p.price}마리를 사용해요. 구매 후 ${balance(i) - p.price}마리예요.`,
                    () => {
                      e.dispatch({ type: 'BUY', id: p.id });
                      e.notify('구매했어요. 바로 사용할 수 있어요.');
                    },
                  )
            }
          />
        }
      >
        <View style={[k.preview, { height: 180 }]}>
          {p.kind === 'audio' ? (
            <Pic id="bld/gramophone" w={110} />
          ) : p.kind === 'clothes' ? (
            <Pic id="scarf-cat" w={120} />
          ) : (
            <Image
              source={
                assets[
                  p.kind === 'island'
                    ? 'backgrounds/island/day.png'
                    : `buildings/${buildingArt[p.building ?? 'hall']}/day.png`
                ]
              }
              style={{ width: '100%', height: '100%' }}
              resizeMode="contain"
            />
          )}
        </View>
        <Txt kind="h">{p.title}</Txt>
        <Txt>{p.description}</Txt>
        {music && (
          <Btn
            kind="glass"
            title={preview ? '미리듣기 멈추기' : '나만 미리듣기'}
            onPress={() => {
              try {
                if (preview) {
                  e.player.pause();
                  e.setPreviewAudio(false);
                } else {
                  e.setPreviewAudio(true);
                  e.player.replace(assets[`audio/${p.id}.wav`]);
                  e.player.loop = false;
                  e.player.play();
                }
                setPreview(!preview);
              } catch {
                e.notify('음원을 불러오지 못했어요.');
              }
            }}
          />
        )}
        <Strip label="섬 물고기 잔액" value={`${balance(i)}마리`} />
        {!isOwned && error && <Txt kind="meta">{error}</Txt>}
      </Sheet>
    );
  }
  return (
    <Sheet
      e={e}
      title="상점"
      bg="shop"
      sign="dog"
      action="구매 내역"
      actionPress={() => e.go('orders')}
    >
      <Strip label="섬 물고기 잔액" value={`${balance(i)}마리`} />
      <Seg items={['내 꾸미기', '공동 테마']} value={tab} onChange={setTab} />
      {tab === '공동 테마' && (
        <Seg small items={['전체', '섬', '건물']} value={filter} onChange={setFilter} />
      )}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        {products
          .filter((p) =>
            tab === '내 꾸미기'
              ? p.kind === 'clothes'
              : (p.kind === 'island' || p.kind === 'building') &&
                (filter === '전체' ||
                  (filter === '섬' && p.kind === 'island') ||
                  (filter === '건물' && p.kind === 'building')),
          )
          .map((p) => (
            <Pressable
              key={p.id}
              accessibilityRole="button"
              accessibilityLabel={p.title}
              onPress={() => e.go('product', p.id)}
              style={{
                width: '47%',
                padding: 12,
                borderWidth: 2,
                borderColor: C.brown,
                borderRadius: 18,
                backgroundColor: C.paper,
                gap: 8,
              }}
            >
              {p.kind === 'clothes' ? (
                <Pic id="scarf-cat" w="100%" h={100} />
              ) : (
                <Image
                  source={
                    assets[
                      p.kind === 'island'
                        ? 'backgrounds/island/day.png'
                        : `buildings/${buildingArt[p.building ?? 'hall']}/day.png`
                    ]
                  }
                  style={{ width: '100%', height: 100 }}
                  resizeMode="contain"
                />
              )}
              <Txt style={{ fontWeight: '700' }}>{p.title}</Txt>
              <Txt kind="meta">{owned(p) ? '보유 중' : `${p.price}마리`}</Txt>
            </Pressable>
          ))}
      </View>
    </Sheet>
  );
}
