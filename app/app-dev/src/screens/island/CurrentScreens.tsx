import React, { useEffect, useRef, useState } from 'react';
import { Animated, Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import {
  State,
  Building,
  Route,
  currentIsland,
  buildingNames,
  buildingOrder,
  costs,
  buildMinutes,
  balance,
  buildingCost,
  buildingReady,
  buildingShare,
  collectedBy,
  earnedBy,
  isHost,
  residentCount,
  capacityOf,
  shopPrerequisitesMet,
  canBuild,
  sessionSeconds,
  dayKey,
  periodBounds,
  islandWeeklyAverage,
  questMemberRate,
  hoursMinutes,
  CAPACITY_MIN,
  CAPACITY_MAX,
  inviteCodeOf,
  recordSecondsBetween,
  kstDayStart,
} from '@/services/model';
import { assets } from '@/constants/assets';
import { useAppLayout } from '@/utils/layout';
import { RestGroup } from '@/screens/focus/RestGroup';
import { Sailing } from '@/screens/world/WorldViews';
import {
  FiButton,
  FiModal,
  FishingActor,
  FishingIsland,
  FishingWalker,
  INK,
  a11yHidden,
  anchorCard,
  labelBox,
  nearGram,
  nearRaft,
  occupied,
  LANDING,
  OUTLINE,
  PEER_SPOTS,
  castSpot,
  fiCard,
  fiTitle,
  fishingGrid,
  hms,
} from '@/screens/focus/FishingIsland';
import { Text, TextInput } from '@/design-system/typography';
import { Point, landPath, onLand } from '@/utils/world-grid';
import { RedesignScreens } from '@/screens/island/Screens';
import { FinalIsland } from '@/screens/island/WorldMap';
import {
  art,
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
  Wheel,
} from '@/design-system/patterns';
import { IslandSheet } from '@/screens/island/IslandSheet';
const fill = {
  position: 'absolute' as const,
  left: 0,
  top: 0,
  width: '100%' as const,
  height: '100%' as const,
};
const buildingArt: Record<Building, string> = {
  hall: 'hall',
  board: 'notice-board',
  gram: 'gramophone',
  library: 'library',
  mail: 'mailbox',
  tower: 'observatory',
  shop: 'shop',
};
const descriptions: Record<Building, string> = {
  hall: '섬 관리 · 공동 가계부 · 다음 건물',
  board: '일일 퀘스트 · 건설 퀘스트 · 공지',
  gram: '음원 구매 · 함께 듣기',
  library: '집중 · 스크린타임 · 물고기 기록',
  mail: '우리 섬 편지방 · 친구 편지',
  tower: '다른 섬 평균 집중 랭킹 · 검색 · 가입',
  shop: '개인 의상 · 공동 테마',
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
  if (r === 'visit') return <Visit e={e} />;
  if (['arrival', 'travel'].includes(r)) return <Travel e={e} />;
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
  if (['hall', 'manage', 'members', 'ledger', 'construction'].includes(r)) return <Hall e={e} />;
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
// 섬 구경 · 전망대 · 상점 · 축음기 · 내 뗏목(친구·꾸미기)은 v2 시트 구현(Screens.tsx)이 그린다
function Visit({ e }: any) {
  return <RedesignScreens e={e} />;
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
      from={first ? '나의 작은 배' : (s.travelOrigin ?? currentIsland(s).name)}
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
function FocusFlow({ e }: any) {
  const s: State = e.state,
    i = currentIsland(s),
    L = useAppLayout(),
    safe = useSafeAreaInsets(),
    r: Route = e.route,
    wide = L.width >= 600,
    reduce = s.settings.reduceMotion;
  const [fan, setFan] = useState(false),
    [emote, setEmote] = useState<string | null>(null),
    [dialog, setDialog] = useState<'music' | 'end' | 'endRest' | 'reward' | null>(null),
    [error, setError] = useState(''),
    [setupHeight, setSetupHeight] = useState(0),
    // 화면 높이 대신 실제 영역 높이(키보드가 뜨면 줄어듦)로 준비 카드 위치를 잡는다
    [boxHeight, setBoxHeight] = useState(0),
    [walker, setWalker] = useState({ p: LANDING, left: false, walking: false }),
    // 휴식 오가는 배 이동: 휴식 시간은 휴식하기를 누른 순간부터 흐르고, 집중은 낚시섬에 도착해야 다시 흐른다
    [voyage, setVoyage] = useState<'toRest' | 'toSpot' | null>(null),
    // 자리에서 뗏목까지 걸어가기(leave)·뗏목에서 자리로 걸어오기(comeback): 걷는 동안 버튼·모달 없음, 시간 안 흐름
    [leg, setLeg] = useState<'leave' | 'comeback' | null>(null);
  const walkingToken = useRef(0),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    emoteTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    position = useRef(LANDING),
    // 걷기·항해 콜백은 끝났을 때의 최신 화면·세션을 보고 계속할지 정한다(그 사이 집중이 끝났으면 중단)
    latest = useRef({ r, s }),
    backRef = useRef<() => boolean>(() => false);
  latest.current = { r, s };
  useEffect(
    () => () => {
      walkingToken.current++;
      if (timer.current) clearTimeout(timer.current);
      if (emoteTimer.current) clearTimeout(emoteTimer.current);
    },
    [],
  );
  // 안드로이드 뒤로가기는 App.back 보다 먼저 이 화면이 처리한다
  useEffect(() => {
    if (!e.backOverride) return;
    e.backOverride.current = () => backRef.current();
    return () => {
      e.backOverride.current = null;
    };
  }, [e.backOverride]);
  // 휴식·결과·이동으로 넘어가면 이모티콘 펼침·말풍선·모달을 남기지 않는다
  useEffect(() => {
    setFan(false);
    setDialog(null);
    if (r !== 'focus') setEmote(null);
  }, [r]);
  const finish = () => {
    e.dispatch({ type: 'FINISH' });
    e.reset('focusResult');
  };
  // 내 자리: 옛 저장 좌표(지도 % 밖)는 도착 지점으로 대신한다
  const mine = castSpot(
    s.focusSpot && s.focusSpot.x <= 100 && s.focusSpot.y <= 100 ? s.focusSpot : LANDING,
  );
  const peers = i.members.filter((m) => m.focusing),
    peerSpots = peers.map((_, n) => PEER_SPOTS[n % PEER_SPOTS.length]);
  // 걷기: 땅 격자 경로를 따라 지도 폭 11%/초로 걷고, 걷는 중 다시 누르면 지금 위치에서 새 목적지로.
  const walkTo = (to: Point, done: () => void) => {
    const from = position.current,
      cells = landPath(fishingGrid, from, to);
    if (!cells.length) return false;
    let rest = [...cells.slice(1, -1), to],
      p = from,
      left = walker.left;
    const token = ++walkingToken.current;
    const step = () => {
      if (token !== walkingToken.current) return;
      let budget = reduce ? Infinity : 0.44;
      while (rest.length && budget > 0) {
        const q = rest[0],
          dx = q.x - p.x,
          d = Math.hypot(dx, q.y - p.y);
        if (Math.abs(dx) > 0.15) left = dx < 0;
        if (d <= budget) {
          p = q;
          rest = rest.slice(1);
          budget -= d;
        } else {
          p = { x: p.x + (dx / d) * budget, y: p.y + ((q.y - p.y) / d) * budget };
          budget = 0;
        }
      }
      position.current = p;
      setWalker({ p, left, walking: rest.length > 0 });
      if (rest.length) timer.current = setTimeout(step, 40);
      else done();
    };
    step();
    return true;
  };
  // 자리에서 일어나 뗏목까지 걸어간 뒤 next(휴식 항해·귀환 항해)
  const leaveTo = (next: () => void) => {
    position.current = mine;
    setLeg('leave');
    const arrive = () => {
      setLeg(null);
      next();
    };
    if (!walkTo(LANDING, arrive)) arrive();
  };
  const result = s.lastResult,
    leave = () =>
      s.resultFromRest
        ? e.home()
        : leaveTo(() => latest.current.r === 'focusResult' && e.go('returnTravel')),
    // 결과 다음에 새로 받은 보상이 있으면 보상받기 모달, 없으면 바로 섬으로
    done = () => (s.rewards?.some((x) => !x.acknowledged) ? setDialog('reward') : leave()),
    claimed = (more: boolean) => {
      if (!more) leave();
    };
  const resume = () => setVoyage('toSpot');
  // 뒤로가기: 걷기·항해(낚시섬 오가기 포함) 중에는 막고, 모달은 닫기만, 결과는 '확인'(보상·귀환 흐름)과 같게, 모닥불은 '집중 이어가기'와 같게
  backRef.current = () => {
    if (leg || voyage || walker.walking || r === 'focusTravel' || r === 'returnTravel') return true;
    if (dialog === 'reward') {
      const open = (s.rewards ?? []).filter((x) => !x.acknowledged);
      if (open[0]) e.dispatch({ type: 'CLAIM', id: open[0].id });
      claimed(open.length > 1);
      return true;
    }
    if (dialog) {
      setDialog(null);
      return true;
    }
    if (r === 'focusResult') {
      done();
      return true;
    }
    if (r === 'rest' && s.session) {
      resume();
      return true;
    }
    if (r === 'focus' && s.session) {
      setDialog('end');
      return true;
    }
    return false;
  };
  if (r === 'focusTravel')
    return (
      <Sailing
        state={s}
        from="우리 섬"
        destination="낚시섬"
        duration={1900}
        onArrive={() => e.replace('fishingArrival')}
      />
    );
  if (r === 'returnTravel')
    return (
      <Sailing state={s} from="낚시섬" destination="우리 섬" duration={1900} onArrive={e.home} />
    );
  if (r === 'rest' && voyage)
    return (
      <Sailing
        state={s}
        from={voyage === 'toRest' ? '낚시섬' : '우리 섬'}
        destination={voyage === 'toRest' ? '우리 섬 모닥불' : '낚시섬 내 자리'}
        duration={1900}
        onArrive={() => {
          setVoyage(null);
          if (voyage === 'toRest' || latest.current.r !== 'rest' || !latest.current.s.session)
            return;
          e.go('focus');
          position.current = LANDING;
          setLeg('comeback');
          const sit = () => {
            setLeg(null);
            if (latest.current.s.session?.status === 'paused') e.dispatch({ type: 'RESUME' });
          };
          if (!walkTo(mine, sit)) sit();
        }}
      />
    );
  if (r === 'rest')
    return (
      <RestGroup
        state={s}
        home={e.home}
        resume={resume}
        endRest={finish}
        confirming={dialog === 'endRest'}
        setConfirming={(open) => setDialog(open ? 'endRest' : null)}
      />
    );
  // 정해진 자리 없음: 누른 땅까지 걸어가 앉고 그 자리 위에 집중 준비. 물·닿을 수 없는 곳·다른 주민 자리는 안 됨.
  const selectSpot = (p: Point) => {
    if (!onLand(fishingGrid, p)) return;
    if (occupied(p, peerSpots)) {
      e.notify('여기는 주민이 앉아 있어요. 조금 옆에 앉아 주세요.');
      return;
    }
    if (i.buildings.includes('gram') && nearGram(p)) {
      e.notify('여기는 축음기가 있어 앉을 수 없어요. 조금 옆에 앉아 주세요.');
      return;
    }
    if (nearRaft(p)) {
      e.notify('여기는 뗏목을 대는 곳이에요. 조금 옆에 앉아 주세요.');
      return;
    }
    const walked = walkTo(p, () => {
      if (latest.current.r !== 'fishingArrival') return;
      e.dispatch({ type: 'FOCUS_SPOT', spot: p });
      e.go('focusSetup');
    });
    // 연못 가운데 섬처럼 뗏목 쪽 땅과 이어지지 않은 곳
    if (!walked) e.notify('이곳까지 이어지는 땅을 골라 주세요.');
  };
  // 뗏목: 자리 고르기에서는 뗏목까지 걸어가 본인만 우리 섬으로, 집중 중에는 집중 종료 확인.
  const raft = () => {
    if (r === 'fishingArrival') {
      const sail = () => latest.current.r === 'fishingArrival' && e.go('returnTravel');
      if (!walkTo(LANDING, sail)) sail();
    } else if (r === 'focus' && s.session && !leg) setDialog('end');
  };
  const start = () => {
    if (!e.text.trim()) {
      setError('집중할 과목이나 할 일을 적어주세요.');
      return;
    }
    if (!i.joined) {
      e.notify('섬에 가입한 뒤 집중할 수 있어요.');
      e.replace('chooseIsland');
      return;
    }
    e.dispatch({ type: 'START', subject: e.text });
    e.go('focus');
  };
  // 결과창의 퀘스트는 집중을 마친 날 회차 기준(자정을 넘겨 봐도 그날 달성이 남는다)
  const resultAt = result?.at ?? e.now,
    resultDay = dayKey(resultAt),
    focusQuests = i.quests.filter((q) => q.type === 'focus'),
    achieved = focusQuests.filter((q) => q.rounds?.[resultDay]?.achieved.includes('me'));
  const resultModal = (
    <FiModal>
      <Text style={[fiTitle(wide ? 19 : 22), { marginBottom: 8 }]}>이번 집중 결과</Text>
      <Text style={{ fontSize: 19, lineHeight: 30.4, fontWeight: '900', color: INK }}>
        {result?.subject ?? '이번 집중'}
      </Text>
      <View style={{ gap: 8, marginVertical: wide ? 12 : 18 }}>
        <View
          style={{
            backgroundColor: C.paper,
            borderWidth: 2,
            borderColor: OUTLINE,
            borderRadius: 13,
            paddingTop: 10,
            paddingHorizontal: 8,
            paddingBottom: 8,
            alignItems: 'center',
          }}
        >
          <Text
            style={{
              fontSize: wide ? 32 : 42,
              lineHeight: (wide ? 32 : 42) * 1.1,
              fontWeight: '900',
              letterSpacing: -1.5,
              fontVariant: ['tabular-nums'],
              color: INK,
            }}
          >
            {hms(result?.seconds ?? 0)}
          </Text>
          <Text style={{ fontSize: 11, lineHeight: 22.4, color: INK }}>이번 집중 시간</Text>
        </View>
        <View
          style={{
            alignSelf: 'center',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            paddingVertical: 4,
            paddingHorizontal: 12,
            backgroundColor: C.butter,
            borderWidth: 2,
            borderColor: OUTLINE,
            borderRadius: 13,
          }}
        >
          <Image source={art.fish} style={{ width: 26, height: 26 }} />
          <Text style={{ fontSize: 15, lineHeight: 19.5, fontWeight: '900', color: INK }}>
            +{result?.fish ?? 0}마리
          </Text>
        </View>
      </View>
      {/* 달성한 퀘스트가 여럿이면 이 부분만 줄여 스크롤해 아래 버튼이 늘 보이게 한다.
          한 줄일 때는 시안(모달 전체 overflow)처럼 줄이지 않는다 */}
      <ScrollView style={{ flexShrink: achieved.length > 1 ? 1 : 0 }} bounces={false}>
        <View
          style={{
            backgroundColor: C.paper,
            borderWidth: 2,
            borderColor: OUTLINE,
            borderRadius: 13,
            paddingVertical: 9,
            paddingHorizontal: 12,
          }}
        >
          <Text style={{ fontSize: 11, lineHeight: 17.6, fontWeight: '700', color: '#7C6857' }}>
            달성한 일일 퀘스트
          </Text>
          <Text style={{ fontSize: 13, lineHeight: 20.8, fontWeight: '800', color: INK }}>
            {achieved.length
              ? achieved.map((q) => '✓ ' + q.title).join('\n')
              : focusQuests[0]
                ? `아직 없어요 · ${focusQuests[0].title} ${Math.floor(((questMemberRate(s, focusQuests[0], 'me', i.id, resultAt) ?? 0) * focusQuests[0].target) / 100)}/${focusQuests[0].target}분`
                : '아직 없어요'}
          </Text>
        </View>
      </ScrollView>
      <View style={{ flexDirection: 'row', marginTop: wide ? 12 : 18 }}>
        <FiButton
          primary
          id="result-done"
          style={{ flex: 1 }}
          title={s.resultFromRest ? '섬으로 돌아가기' : '배 타고 우리 섬으로'}
          onPress={done}
        />
      </View>
    </FiModal>
  );
  const rewardModal = dialog === 'reward' && <RewardModal e={e} onClaimed={claimed} />;
  if (r === 'focusResult' && s.resultFromRest)
    return (
      <View style={{ flex: 1 }}>
        <RestGroup state={s} home={e.home} resume={e.home} result />
        {resultModal}
        {rewardModal}
      </View>
    );
  const seated = r !== 'fishingArrival' && !leg,
    spots = [...peerSpots, ...(seated ? [mine] : [])];
  const focusing = r === 'focus' && !!s.session && !leg,
    mySubject = r === 'focusSetup' ? null : (s.session?.subject ?? result?.subject ?? null);
  // 집중 준비 모달은 누른 곳(내 고양이) 위에 붙인다. 위가 좁으면 아래 → 오른쪽 → 왼쪽.
  const setup = (toScreen: (p: Point) => Point, size: number) => {
    const { x, y } = toScreen(mine),
      dw = Math.min(330, L.width - 40),
      { top, left } = anchorCard(
        x,
        y,
        size * 0.077,
        dw,
        setupHeight,
        L.width,
        boxHeight || L.height,
        safe,
      );
    return (
      <View style={[StyleSheet.absoluteFill, { zIndex: 10 }]}>
        <View style={[StyleSheet.absoluteFill, { backgroundColor: '#493B3940' }]} />
        <View
          onLayout={(ev) => setSetupHeight(ev.nativeEvent.layout.height)}
          style={[
            fiCard,
            {
              position: 'absolute',
              top,
              left,
              width: dw,
              paddingTop: 14,
              paddingHorizontal: 16,
              paddingBottom: 16,
              opacity: setupHeight ? 1 : 0,
            },
          ]}
        >
          <Text style={[fiTitle(18), { marginBottom: 4 }]}>집중 준비</Text>
          <Text
            style={{
              fontSize: 12,
              lineHeight: 19.2,
              fontWeight: '800',
              color: INK,
              marginBottom: 4,
            }}
          >
            오늘의 할 일
          </Text>
          <TextInput
            testID="focus-subject"
            accessibilityLabel="오늘의 할 일"
            value={e.text}
            onChangeText={(t: string) => {
              e.setText(t);
              setError('');
            }}
            maxLength={40}
            placeholder="예: 영어 단어 외우기"
            placeholderTextColor="#9C8B80"
            returnKeyType="done"
            onSubmitEditing={start}
            style={{
              minHeight: 40,
              paddingVertical: 8,
              paddingHorizontal: 12,
              borderWidth: 2,
              borderColor: OUTLINE,
              borderRadius: 13,
              backgroundColor: C.paper,
              fontSize: 14,
              lineHeight: 22.4,
              color: INK,
            }}
          />
          {error !== '' && (
            <Text style={{ fontSize: 11, lineHeight: 17, color: '#a65539', marginTop: 5 }}>
              {error}
            </Text>
          )}
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
            <FiButton title="다른 곳 고르기" style={{ flex: 1 }} onPress={e.back} />
            <FiButton
              primary
              title="집중 시작"
              id="start-focus"
              style={{ flex: 1 }}
              onPress={start}
            />
          </View>
        </View>
      </View>
    );
  };
  const sendEmote = (id: string) => {
    setEmote(id);
    setFan(false);
    if (emoteTimer.current) clearTimeout(emoteTimer.current);
    emoteTimer.current = setTimeout(() => setEmote(null), 3000);
  };
  const hudText = {
    color: INK,
    textShadowColor: '#FFFDFA',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
  };
  const circle = (d: number, bg: string) => ({
    width: d,
    height: d,
    borderRadius: d / 2,
    borderWidth: 2,
    borderColor: OUTLINE,
    backgroundColor: bg,
    boxShadow: `0px 4px 0px ${OUTLINE}`,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  });
  return (
    <View style={{ flex: 1 }} onLayout={(ev) => setBoxHeight(ev.nativeEvent.layout.height)}>
      <FishingIsland
        focus={r !== 'fishingArrival' ? mine : L.landscape ? { x: 45, y: 58 } : { x: 38, y: 56 }}
        ratio={r === 'focusSetup' ? 0.72 : 0.5}
        spots={spots}
        onTap={r === 'fishingArrival' ? selectSpot : undefined}
        onRaft={raft}
        gram={i.buildings.includes('gram')}
        onGram={focusing ? () => setDialog('music') : undefined}
        seated={seated}
        inert={!!dialog || r === 'focusResult'}
        overlay={r === 'focusSetup' ? setup : undefined}
      >
        {(size, sizeY, zoom) => {
          // 머리 위 과목·시간표가 겹치면 뒤(위쪽) 것을 숨긴다: 내 표시가 먼저, 그다음 앞(아래)쪽.
          // 1배 미만으로 줄이면 다른 주민은 이름만.
          const shown = new Set<string>(),
            kept: ReturnType<typeof labelBox>[] = [];
          [
            ...(seated && mySubject != null ? [{ id: 'me', spot: mine, subject: mySubject }] : []),
            ...(zoom < 1
              ? []
              : peers
                  .map((m, n) => ({
                    id: m.id,
                    spot: PEER_SPOTS[n % PEER_SPOTS.length],
                    subject: m.subject,
                  }))
                  .sort((a, b) => b.spot.y - a.spot.y)),
          ].forEach((l) => {
            const b = labelBox(l.spot, l.subject, size, sizeY);
            if (
              kept.some(
                (k) =>
                  !(
                    k.right <= b.left ||
                    b.right <= k.left ||
                    k.bottom <= b.top ||
                    b.bottom <= k.top
                  ),
              )
            )
              return;
            kept.push(b);
            shown.add(l.id);
          });
          return (
            <>
              {peers.map((m, n) => (
                <FishingActor
                  key={m.id}
                  spot={PEER_SPOTS[n % PEER_SPOTS.length]}
                  size={size}
                  sizeY={sizeY}
                  color={m.color}
                  name={m.name}
                  subject={shown.has(m.id) ? m.subject : null}
                  seconds={m.seconds}
                  reduce={reduce}
                />
              ))}
              {seated ? (
                <FishingActor
                  spot={mine}
                  size={size}
                  sizeY={sizeY}
                  color={s.color}
                  name="나"
                  me
                  subject={shown.has('me') ? mySubject : null}
                  seconds={
                    r === 'focusResult' ? (result?.seconds ?? 0) : sessionSeconds(s.session, e.now)
                  }
                  emote={focusing ? emote : null}
                  reduce={reduce}
                />
              ) : (
                <FishingWalker
                  p={walker.p}
                  size={size}
                  sizeY={sizeY}
                  color={s.color}
                  walking={walker.walking}
                  left={walker.left}
                  reduce={reduce}
                />
              )}
            </>
          );
        }}
      </FishingIsland>
      {focusing && (
        <>
          <View
            pointerEvents="none"
            {...a11yHidden(!!dialog)}
            style={{
              position: 'absolute',
              zIndex: 5,
              top: wide ? Math.max(14, safe.top + 14) : Math.max(100, safe.top + 48),
              left: Math.max(18, safe.left),
              right: Math.max(18, safe.right),
              alignItems: 'center',
            }}
          >
            <Text
              numberOfLines={1}
              style={[hudText, { fontSize: 16, lineHeight: 25.6, fontWeight: '900' }]}
            >
              {s.session!.subject}
            </Text>
            <Text
              style={[
                hudText,
                {
                  fontSize: wide ? 32 : 42,
                  lineHeight: (wide ? 32 : 42) * 1.15,
                  fontWeight: '900',
                  letterSpacing: -1.5,
                  fontVariant: ['tabular-nums'],
                },
              ]}
            >
              {hms(sessionSeconds(s.session, e.now))}
            </Text>
          </View>
          <View
            {...a11yHidden(!!dialog)}
            style={{
              position: 'absolute',
              zIndex: 5,
              bottom: wide ? Math.max(18, safe.bottom) : Math.max(36, safe.bottom + 4),
              ...(wide
                ? { right: Math.max(24, safe.right), width: 340 }
                : { left: Math.max(18, safe.left), right: Math.max(18, safe.right) }),
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
            }}
          >
            {fan && (
              <View
                style={{ position: 'absolute', left: 0, bottom: 64, flexDirection: 'row', gap: 6 }}
              >
                {['hello', 'cheer', 'sleepy', 'laugh', 'hearts'].map((id, n) => (
                  <Pressable
                    key={id}
                    testID={`emote-${id}`}
                    accessibilityRole="button"
                    accessibilityLabel={['인사', '응원', '졸림', '웃음', '하트뿅뿅'][n]}
                    onPress={() => sendEmote(id)}
                    style={circle(46, C.paper)}
                  >
                    <Image source={art[`emote/${id}`]} style={{ width: 30, height: 30 }} />
                  </Pressable>
                ))}
              </View>
            )}
            <Pressable
              testID="emote-fab"
              accessibilityRole="button"
              accessibilityLabel="이모티콘"
              accessibilityState={{ expanded: fan }}
              onPress={() => setFan(!fan)}
              style={circle(52, C.butter)}
            >
              <Image source={art[`emote/${emote ?? 'hello'}`]} style={{ width: 32, height: 32 }} />
            </Pressable>
            <FiButton
              primary
              title="휴식하기"
              id="pause-focus"
              style={{ flex: 1 }}
              onPress={() => {
                // 휴식 시간은 누른 순간부터(뗏목까지 걷기·배 이동도 휴식)
                e.dispatch({ type: 'PAUSE' });
                leaveTo(() => {
                  setVoyage('toRest');
                  e.go('rest');
                });
              }}
            />
            <FiButton
              title="집중 종료"
              id="end-focus"
              style={{ flex: 1 }}
              onPress={() => setDialog('end')}
            />
          </View>
          {dialog === 'end' && (
            <FiModal>
              <Text style={fiTitle(wide ? 19 : 22)}>이번 집중을 마칠까요?</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: wide ? 12 : 18 }}>
                <FiButton title="계속하기" style={{ flex: 1 }} onPress={() => setDialog(null)} />
                <FiButton
                  primary
                  title="집중 종료"
                  id="confirm-finish"
                  style={{ flex: 1 }}
                  onPress={finish}
                />
              </View>
            </FiModal>
          )}
          {dialog === 'music' && (
            <FiModal>
              <Text style={[fiTitle(wide ? 19 : 22), { marginBottom: 8 }]}>축음기 음악</Text>
              <Text
                style={{
                  fontSize: 13,
                  lineHeight: 20.8,
                  color: '#7C6857',
                  marginBottom: wide ? 10 : 15,
                }}
              >
                보유한 음원 중에서 골라요.
              </Text>
              <View style={{ gap: 8 }}>
                {i.sharedOwned
                  .filter((id) => tracks[id])
                  .map((id) => (
                    <FiButton
                      key={id}
                      left
                      primary={i.track === id}
                      title={tracks[id]}
                      onPress={() => e.dispatch({ type: 'TRACK', value: id })}
                    />
                  ))}
              </View>
              <View style={{ flexDirection: 'row', marginTop: wide ? 12 : 18 }}>
                <FiButton
                  primary
                  title="자리로 돌아가기"
                  style={{ flex: 1 }}
                  onPress={() => setDialog(null)}
                />
              </View>
            </FiModal>
          )}
        </>
      )}
      {r === 'focusResult' && !leg && resultModal}
      {!leg && rewardModal}
    </View>
  );
}
// 퀘스트 보상받기(갤러리 49 보상 모달): 결과창 다음에 한 번. 받으면 다음 보상이 없을 때 섬으로.
function RewardModal({ e, onClaimed }: { e: any; onClaimed?: (more: boolean) => void }) {
  const s: State = e.state,
    wide = useAppLayout().width >= 600,
    open = (s.rewards ?? []).filter((r) => !r.acknowledged),
    reward = open[0];
  if (!reward) return null;
  const owner = s.islands.find((i) => i.id === reward.islandId),
    title = owner?.quests.find((q) => q.id === reward.questId)?.title ?? '퀘스트',
    // 받침 있는 글자 뒤에는 '을'
    particle = (title.charCodeAt(title.length - 1) - 0xac00) % 28 > 0 ? '을' : '를';
  return (
    <View
      style={[StyleSheet.absoluteFill, { zIndex: 20, justifyContent: 'center' }]}
      accessibilityViewIsModal
    >
      <View style={[StyleSheet.absoluteFill, { backgroundColor: '#493B3966' }]} />
      <View
        style={{
          marginHorizontal: wide ? 157 : 24,
          backgroundColor: C.paper,
          borderWidth: 2,
          borderColor: OUTLINE,
          borderRadius: 24,
          paddingTop: wide ? 14 : 20,
          paddingHorizontal: 20,
          paddingBottom: wide ? 14 : 18,
          gap: wide ? 10 : 14,
          boxShadow: `0px 6px 0px ${OUTLINE}`,
          alignItems: 'center',
        }}
      >
        <Image source={art.fish} style={{ width: 72, height: 72 }} />
        <Txt kind="h">{reward.kind === 'bonus' ? '모두 해냈어요!' : '퀘스트 달성!'}</Txt>
        <Txt style={{ color: '#796256', textAlign: 'center' }}>
          {reward.kind === 'bonus'
            ? `섬에 보너스 ${reward.amount}마리가 쌓였어요`
            : `${title}${particle} 달성했어요.\n물고기 ${reward.amount}마리를 추가로 받았어요!`}
        </Txt>
        <Btn
          title={reward.kind === 'bonus' ? '좋아요' : '보상받기'}
          id="claim-reward"
          style={{ alignSelf: 'stretch' }}
          onPress={() => {
            e.dispatch({ type: 'CLAIM', id: reward.id });
            onClaimed?.(open.length > 1);
          }}
        />
      </View>
    </View>
  );
}
function Library({ e }: any) {
  const [fontsLoaded] = useFonts({
    GromoSailing: require('@/assets/fonts/gowun-dodum.ttf'),
  });
  const s: State = e.state,
    i = currentIsland(s),
    L = useAppLayout(),
    [book, setBook] = useState(
      e.route === 'library' ? '' : e.detail === 'residents' ? 'neighbors' : 'me',
    ),
    [page, setPage] = useState(e.tab === 'screen' ? 1 : e.tab === 'fish' ? 2 : 0),
    [member, setMember] = useState(e.body || 'me'),
    [period, setPeriod] = useState<'일' | '주' | '월'>('주'),
    [offset, setOffset] = useState(0);
  const roomKey = (L.landscape ? 'L/' : '') + 'lib/' + (book ? 'room-blur' : 'room');
  const options = [
    { id: 'me', name: '나', color: s.color, island: i },
    ...i.members.map((m) => ({ ...m, island: i })),
  ];
  const picked = options.find((m) => m.id === member) ?? options[0],
    who = book === 'me' ? options[0] : picked;
  const resident =
    who.id === 'me'
      ? null
      : who.island.members.find((m) => m.id === ((who as any).originalId ?? who.id));
  const bounds = periodBounds(period, offset, e.now),
    records = (who.id === 'me' ? s.records : (resident?.records ?? [])).filter(
      (r) => r.islandId === who.island.id && recordSecondsBetween(r, bounds.from, bounds.until) > 0,
    ),
    total = records.reduce((n, r) => n + recordSecondsBetween(r, bounds.from, bounds.until), 0);
  const screenEntries = Object.entries(
    who.id === 'me' ? (s.screenDays ?? {}) : (resident?.screenDays ?? {}),
  ).filter(([d]) => {
    const at = kstDayStart(d) + 12 * 60 * 60 * 1000;
    return at >= bounds.from && at < bounds.until;
  });
  const known = screenEntries.filter(([, v]) => v != null),
    permission = who.id === 'me' ? s.settings.permission : resident?.screenDays !== undefined;
  const periodPicker = (
    <View style={{ alignItems: 'center', gap: 5 }}>
      <Seg
        small
        items={['일', '주', '월']}
        value={period}
        onChange={(p: '일' | '주' | '월') => {
          setPeriod(p);
          setOffset(0);
        }}
        style={{ width: 160 }}
      />
      <View style={k.row}>
        <Btn small kind="ghost" title="‹" onPress={() => setOffset((o) => o - 1)} />
        <Txt kind="meta">
          {date(bounds.from)}
          {period !== '일' ? ` — ${date(bounds.until - 1)}` : ''}
        </Txt>
        <Btn
          small
          kind="ghost"
          title="›"
          disabled={offset >= 0}
          onPress={() => setOffset((o) => Math.min(0, o + 1))}
        />
      </View>
    </View>
  );
  const fishRows = [{ id: 'me', name: s.name, color: s.color }, ...i.members];
  const pageHead = (
    <View style={{ gap: 8 }}>
      <Txt kind="meta" style={{ fontSize: 10, letterSpacing: 1 }}>
        {page === 2
          ? 'fish we caught'
          : page === 0
            ? 'little moments of focus'
            : 'time outside the island'}
      </Txt>
      <Txt kind="h">
        {page === 2 ? '우리가 낚은 물고기' : who.id === 'me' ? '나의 하루' : `${who.name}의 하루`}
      </Txt>
      <Txt kind="meta">
        {page === 2
          ? '주민별 누적 획득 · 섬 잔액과 달라요'
          : `${who.island.name} · ${page === 0 ? '집중 기록' : '스크린타임'}`}
      </Txt>
      {page !== 2 && (
        <Txt kind="h" style={{ fontSize: 28 }}>
          {page === 0
            ? hoursMinutes(total)
            : !permission
              ? '연결되지 않은 기록'
              : known.length
                ? hoursMinutes(known.reduce((n, [, v]) => n + (v ?? 0), 0) * 60)
                : '기록 없음'}
        </Txt>
      )}
    </View>
  );
  const bins =
    period === '일' ? 4 : period === '주' ? 7 : Number(dayKey(bounds.until - 1).slice(-2));
  const values = Array.from({ length: bins }, (_, n) => {
    const binFrom = bounds.from + ((bounds.until - bounds.from) * n) / bins,
      binUntil = bounds.from + ((bounds.until - bounds.from) * (n + 1)) / bins;
    return page === 0
      ? records.reduce((sum, r) => sum + recordSecondsBetween(r, binFrom, binUntil) / 60, 0)
      : known
          .filter(
            ([day]) =>
              Math.min(
                bins - 1,
                Math.floor(
                  ((kstDayStart(day) + 12 * 60 * 60 * 1000 - bounds.from) /
                    (bounds.until - bounds.from)) *
                    bins,
                ),
              ) === n,
          )
          .reduce((sum, [, v]) => sum + (v ?? 0), 0);
  });
  const chart = ((page === 0 && records.length > 0) ||
    (page === 1 && permission && known.length > 0)) && (
    <View
      accessibilityLabel="기간별 기록 그래프"
      style={{
        height: 95,
        flexDirection: 'row',
        alignItems: 'flex-end',
        gap: period === '월' ? 2 : 6,
        paddingBottom: 20,
      }}
    >
      {values.map((v, n) => (
        <View
          key={n}
          style={{
            flex: 1,
            height: Math.max(2, (v / Math.max(1, ...values)) * 70),
            backgroundColor: page === 0 ? '#96ad85' : '#afced5',
            borderRadius: 3,
          }}
        >
          <Txt
            style={{
              position: 'absolute',
              top: '100%',
              fontSize: 9,
              textAlign: 'center',
              width: '100%',
            }}
          >
            {period === '일' ? n * 6 : period === '월' && (n + 1) % 5 !== 0 ? '' : n + 1}
          </Txt>
        </View>
      ))}
    </View>
  );
  const pageBody = (
    <View style={{ gap: 8 }}>
      {chart}
      {page === 2 ? (
        fishRows.map((m) => (
          <Row
            key={m.id}
            title={m.name}
            icon={`avatar/${m.color}`}
            tail={<Txt kind="h17">{earnedBy(i, m.id)}마리</Txt>}
          />
        ))
      ) : page === 0 ? (
        who.id !== 'me' ? (
          records.length ? (
            <Row title="집중 합계" tail={<Txt>{hoursMinutes(total)}</Txt>} />
          ) : (
            <Empty>이 기간에 집중 기록이 없어요.</Empty>
          )
        ) : records.length ? (
          records.map((r) => (
            <Row
              key={r.id}
              title={r.subject}
              sub={date(r.at)}
              tail={<Txt>{hoursMinutes(recordSecondsBetween(r, bounds.from, bounds.until))}</Txt>}
            />
          ))
        ) : (
          <Empty>이 기간에 집중 기록이 없어요.</Empty>
        )
      ) : !permission ? (
        <Empty>
          스크린타임 측정 권한이 없어 사용 시간을 확인할 수 없어요. 0분이나 기록 없음과는 달라요.
        </Empty>
      ) : known.length ? (
        known.map(([d, v]) => <Row key={d} title={d} tail={<Txt>{v}분</Txt>} />)
      ) : (
        <Empty>이 기간의 측정 기록이 아직 없어요.</Empty>
      )}
    </View>
  );
  const bw = L.compact ? Math.min(700, L.width - 70) : Math.min(400, L.width - 42),
    bh = L.compact ? Math.min(300, L.height - 90) : Math.min(520, L.height - 240);
  return (
    <View style={{ flex: 1 }}>
      <Image source={art[roomKey]} style={fill} resizeMode="cover" />
      {!book ? (
        <>
          <View
            style={{
              position: 'absolute',
              top: '47%',
              left: (L.width - (L.compact ? 340 : 270)) / 2,
              flexDirection: 'row',
              gap: 24,
            }}
          >
            {['me', 'neighbors'].map((b, n) => (
              <Pressable
                key={b}
                accessibilityRole="button"
                accessibilityLabel={n ? '이웃들의 일기장' : '내 일기장'}
                onPress={() => {
                  setBook(b);
                  setMember(n ? (i.members[0]?.id ?? 'me') : 'me');
                  setPage(0);
                }}
                style={{
                  width: L.compact ? 150 : 123,
                  height: L.compact ? 140 : 160,
                  borderWidth: 2,
                  borderColor: '#775342',
                  borderRadius: 8,
                  backgroundColor: n ? '#b4d4db' : '#e8adb3',
                  padding: 14,
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 12,
                  boxShadow: '4px 7px 0px #795d4488',
                  transform: [{ rotate: n ? '9deg' : '-10deg' }],
                }}
              >
                <Txt
                  style={{
                    fontSize: 21,
                    textAlign: 'center',
                    fontFamily: fontsLoaded ? 'GromoSailing' : undefined,
                  }}
                >
                  {n ? '이웃들의\n일기장' : '내\n일기장'}
                </Txt>
                <Txt style={{ color: '#fff5cf', fontSize: 24 }}>✿</Txt>
              </Pressable>
            ))}
          </View>
          <View style={{ position: 'absolute', right: 18, top: L.insets.top + 18 }}>
            <Close onPress={e.home} />
          </View>
        </>
      ) : (
        <>
          <View
            style={{
              position: 'absolute',
              left: (L.width - bw) / 2,
              top: (L.height - bh) / 2 + 24,
              width: bw,
              height: bh,
            }}
          >
            <View
              style={{
                position: 'absolute',
                left: 10,
                top: -52,
                paddingHorizontal: 20,
                paddingVertical: 8,
                backgroundColor: '#bd814d',
                borderWidth: 2,
                borderColor: '#6e4b31',
                borderRadius: 9,
              }}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="책 덮기"
                onPress={() => setBook('')}
              >
                <Txt style={{ color: '#fff8e8', fontSize: 17 }}>
                  {book === 'me' ? '내 일기장' : '이웃들의 일기장'} ‹
                </Txt>
              </Pressable>
            </View>
            {book === 'neighbors' && (
              <ScrollView
                horizontal
                style={{
                  position: 'absolute',
                  top: -28,
                  left: 150,
                  right: 0,
                  height: 35,
                }}
                contentContainerStyle={{ gap: 5 }}
              >
                {options.map((m) => (
                  <Pressable
                    key={m.id}
                    accessibilityRole="button"
                    accessibilityLabel={`${m.name} 기록`}
                    accessibilityState={{ selected: member === m.id }}
                    onPress={() => setMember(m.id)}
                    style={{
                      padding: 7,
                      backgroundColor: member === m.id ? '#e8c46a' : '#b4d4db',
                      borderRadius: 5,
                    }}
                  >
                    <Txt style={{ fontSize: 12 }}>{m.name}</Txt>
                  </Pressable>
                ))}
              </ScrollView>
            )}
            <View style={{ flex: 1, flexDirection: L.compact ? 'row' : 'column' }}>
              {(L.compact ? [0, 1] : [0]).map((n) => (
                <View key={n} style={{ flex: 1 }}>
                  <Image
                    source={art['lib/page']}
                    resizeMode="stretch"
                    style={[
                      fill,
                      {
                        transform: [{ scaleX: n === 1 || page === 1 ? -1 : 1 }],
                      },
                    ]}
                  />
                  <ScrollView
                    contentContainerStyle={{
                      paddingHorizontal: bw * (L.compact ? 0.06 : 0.12),
                      paddingTop: bh * 0.09,
                      paddingBottom: bh * 0.1,
                      gap: 12,
                    }}
                  >
                    {page !== 2 && n === 0 && periodPicker}
                    {n === 0 && pageHead}
                    {(!L.compact || n === 1) && pageBody}
                  </ScrollView>
                </View>
              ))}
            </View>
            <View style={{ position: 'absolute', left: -10, bottom: 10 }}>
              <Btn
                title="←"
                small
                kind="glass"
                disabled={page === 0}
                onPress={() => setPage((p) => p - 1)}
              />
            </View>
            <View style={{ position: 'absolute', right: -10, bottom: 10 }}>
              <Btn
                title="→"
                small
                kind="glass"
                disabled={page >= (book === 'me' ? 1 : 2)}
                onPress={() => setPage((p) => p + 1)}
              />
            </View>
          </View>
          <View style={{ position: 'absolute', right: 18, top: L.insets.top + 18 }}>
            <Close onPress={() => setBook('')} />
          </View>
        </>
      )}
    </View>
  );
}
function Hall({ e }: any) {
  const s: State = e.state,
    i = currentIsland(s),
    L = useAppLayout(),
    r = e.route,
    host = isHost(i),
    [candidate, setCandidate] = useState<Building | null>(null),
    [filter, setFilter] = useState('전체');
  const [editing, setEditing] = useState(false),
    [name, setName] = useState(i.name),
    [intro, setIntro] = useState(i.intro),
    [cap, setCap] = useState(`${capacityOf(i)}명`);
  const room = <Image source={art['hall/room']} style={fill} resizeMode="cover" />;
  const close = (
    <View style={{ position: 'absolute', left: 16, top: L.insets.top + 16 }}>
      <Btn small kind="glass" title="‹" onPress={r === 'hall' ? e.home : e.back} />
    </View>
  );
  const panel = (title: string, body: React.ReactNode, footer?: React.ReactNode) => (
    <View style={{ flex: 1 }}>
      {room}
      {close}
      <View
        style={{
          position: 'absolute',
          bottom: L.insets.bottom + 20,
          right: L.compact ? 24 : 14,
          left: L.compact ? undefined : 14,
          width: L.compact ? Math.min(550, L.width - 90) : undefined,
          maxHeight: L.height - L.insets.top - 80,
          backgroundColor: '#fff3d8',
          borderWidth: 2,
          borderColor: C.brown,
          borderRadius: 18,
          padding: 16,
          gap: 12,
        }}
      >
        <View style={[k.row, { justifyContent: 'space-between' }]}>
          <Txt kind="h17">{title}</Txt>
          <Close onPress={e.back} />
        </View>
        <ScrollView contentContainerStyle={{ gap: 12, paddingBottom: 8 }}>{body}</ScrollView>
        {footer}
      </View>
    </View>
  );
  if (r === 'hall')
    return (
      <View style={{ flex: 1 }}>
        {room}
        {close}
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: L.insets.top + 25,
            left: '35%',
            backgroundColor: '#b97949',
            padding: 8,
            borderRadius: 7,
          }}
        >
          <Txt style={{ color: '#fff8e8' }}>마을회관</Txt>
        </View>
        {[
          {
            label: '섬 관리',
            route: 'manage',
            left: L.compact ? '15%' : '28%',
            top: L.compact ? '44%' : '43%',
            width: L.compact ? '34%' : '44%',
            height: L.compact ? '29%' : '18%',
          },
          {
            label: '다음 건물',
            route: 'construction',
            left: '20%',
            top: L.compact ? '10%' : '31%',
            width: L.compact ? '47%' : '60%',
            height: L.compact ? '25%' : '15%',
          },
          {
            label: '공동 가계부',
            route: 'ledger',
            left: L.compact ? '70%' : '66%',
            top: L.compact ? '53%' : '55%',
            width: L.compact ? '19%' : '27%',
            height: L.compact ? '31%' : '15%',
          },
        ].map((o) => (
          <Pressable
            key={o.route}
            accessibilityRole="button"
            accessibilityLabel={o.label}
            onPress={() => e.go(o.route)}
            style={{
              position: 'absolute',
              left: o.left as any,
              top: o.top as any,
              width: o.width as any,
              height: o.height as any,
              alignItems: 'center',
              justifyContent: 'flex-end',
            }}
          >
            <View
              style={{
                backgroundColor: '#fff3d8df',
                borderWidth: 1.5,
                borderColor: C.brown,
                borderRadius: 12,
                paddingHorizontal: 12,
                paddingVertical: 6,
              }}
            >
              <Txt style={{ fontSize: 13 }}>{o.label}</Txt>
            </View>
          </Pressable>
        ))}
      </View>
    );
  if (r === 'ledger')
    return panel(
      '공동 가계부',
      <>
        <Strip label="섬 물고기 잔액" value={`${balance(i)}마리`} />
        <Seg small items={['전체', '적립', '사용']} value={filter} onChange={setFilter} />
        <Group flat>
          {i.ledger
            .filter(
              (l) =>
                filter === '전체' ||
                (filter === '적립' ? l.text.includes('+') : l.text.includes('−')),
            )
            .map((l) => (
              <Row key={l.id} title={l.text} sub={date(l.at)} />
            ))}
          {!i.ledger.length && <Empty>집중·보상·구매·건설 내역이 쌓여요.</Empty>}
        </Group>
      </>,
    );
  if (r === 'manage' || r === 'members') {
    const tab = e.tab || (r === 'members' ? '주민' : '섬 정보');
    return panel(
      '섬 관리',
      <>
        <Seg items={['섬 정보', '주민', '가입 신청']} value={tab} onChange={e.setTab} />
        {tab === '섬 정보' ? (
          <>
            {editing ? (
              <>
                <Field label="섬 이름" value={name} onChange={setName} />
                <Field label="섬 소개" value={intro} onChange={setIntro} />
                <Btn
                  title="저장"
                  disabled={!name.trim()}
                  onPress={() => {
                    e.dispatch({ type: 'MANAGE', name, intro });
                    setEditing(false);
                  }}
                />
              </>
            ) : (
              <Row
                title={i.name}
                sub={i.intro}
                tail={
                  host ? (
                    <Btn small kind="ghost" title="편집" onPress={() => setEditing(true)} />
                  ) : undefined
                }
              />
            )}
            <Group flat>
              <Row
                title="승인 후 가입"
                tail={
                  <Toggle
                    label="승인 후 가입"
                    value={i.approval}
                    onChange={(approval: boolean) =>
                      host && e.dispatch({ type: 'MANAGE', approval })
                    }
                  />
                }
              />
              <Row
                title="정원"
                sub={`현재 ${residentCount(i)}명 · 최대 15명`}
                tail={
                  host ? (
                    <Wheel
                      label="정원"
                      items={Array.from(
                        {
                          length: CAPACITY_MAX - Math.max(CAPACITY_MIN, residentCount(i)) + 1,
                        },
                        (_, n) => `${n + Math.max(CAPACITY_MIN, residentCount(i))}명`,
                      )}
                      value={cap}
                      onChange={(v: string) => {
                        setCap(v);
                        e.dispatch({ type: 'CAPACITY', value: parseInt(v) });
                      }}
                    />
                  ) : (
                    <Txt>{capacityOf(i)}명</Txt>
                  )
                }
              />
            </Group>
            <Btn
              kind="glass"
              title="친구 초대하기"
              onPress={() =>
                e.confirm('섬 초대 코드', `이 섬의 코드는 ${inviteCodeOf(i)}예요.`, () => {})
              }
            />
            <Btn
              kind="danger"
              title={host && i.members.length ? '방장을 위임한 뒤 탈퇴할 수 있어요' : '섬 탈퇴'}
              disabled={host && i.members.length > 0}
              onPress={() =>
                e.confirm('섬을 떠날까요?', '이 섬에서 모은 물고기는 섬에 남아요.', () => {
                  const hasOtherIsland = s.islands.some(
                    (island) => island.joined && island.id !== i.id,
                  );
                  e.dispatch({ type: 'LEAVE' });
                  if (hasOtherIsland) e.home();
                  else e.reset('chooseIsland');
                })
              }
            />
          </>
        ) : tab === '주민' ? (
          <Group flat>
            <Row title={`${s.name} · 나`} sub={host ? '방장' : '주민'} icon={`avatar/${s.color}`} />
            {i.members.map((m) => (
              <Row
                key={m.id}
                title={m.name}
                sub={m.role === 'host' ? '방장' : '주민'}
                icon={`avatar/${m.color}`}
                tail={
                  host ? (
                    <View style={{ gap: 4 }}>
                      <Btn
                        small
                        kind="ghost"
                        title="방장 위임"
                        onPress={() =>
                          e.confirm(
                            '방장을 위임할까요?',
                            `${m.name}에게 섬 관리 권한을 넘겨요.`,
                            () => e.dispatch({ type: 'TRANSFER', id: m.id }),
                          )
                        }
                      />
                      <Btn
                        small
                        kind="danger"
                        title="내보내기"
                        onPress={() =>
                          e.confirm(
                            '주민을 내보낼까요?',
                            '모은 물고기는 섬에 남고 건설 퀘스트 대상에서 제외돼요.',
                            () => e.dispatch({ type: 'KICK', id: m.id }),
                          )
                        }
                      />
                    </View>
                  ) : undefined
                }
              />
            ))}
          </Group>
        ) : i.requestResolved ? (
          <Empty>대기 중인 신청이 없어요.</Empty>
        ) : (
          <Group flat>
            <Row
              title="새봄"
              icon="avatar/white"
              sub="섬에 함께하고 싶어요"
              tail={
                host ? (
                  <View style={k.row}>
                    <Btn small title="승인" onPress={() => e.dispatch({ type: 'ADD_MEMBER' })} />
                    <Btn
                      small
                      kind="ghost"
                      title="거절"
                      onPress={() => e.dispatch({ type: 'REJECT_MEMBER' })}
                    />
                  </View>
                ) : undefined
              }
            />
          </Group>
        )}
      </>,
    );
  }
  const all = buildingOrder.filter((b) => b !== 'hall' && b !== 'board');
  return (
    <>
      {panel(
        '목각 건물 고르기',
        <>
          {i.construction ? (
            <Strip
              label={`${buildingNames[i.construction.building]} 공사 중`}
              value={`${Math.max(0, Math.ceil((i.construction.endsAt - e.now) / 60000))}분 남음`}
            />
          ) : (
            <Txt kind="meta">
              {i.buildingQuest
                ? `현재 목표 · ${buildingNames[i.buildingQuest.building]}`
                : '다음 건물은 방장이 자유롭게 선택해요.'}
            </Txt>
          )}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {all.map((b) => {
              const made = i.buildings.includes(b),
                locked = b === 'shop' && !shopPrerequisitesMet(i);
              return (
                <Pressable
                  key={b}
                  accessibilityRole="button"
                  accessibilityLabel={buildingNames[b]}
                  accessibilityState={{
                    disabled: made || locked || !!i.construction,
                  }}
                  disabled={made || locked || !!i.construction}
                  onPress={() => setCandidate(b)}
                  style={{
                    width: L.compact ? '30%' : '47%',
                    padding: 10,
                    alignItems: 'center',
                    borderRadius: 14,
                    borderWidth: 1.5,
                    borderColor: C.brown,
                    backgroundColor: i.buildingQuest?.building === b ? C.soft : C.paper,
                    opacity: made || locked || i.construction?.building === b ? 0.5 : 1,
                    gap: 5,
                  }}
                >
                  <Pic id={`bld/${buildingArt[b]}`} w={L.compact ? 70 : 90} h={90} />
                  <Txt kind="h17">
                    {buildingNames[b]}
                    {made ? ' ✓' : ''}
                  </Txt>
                  <Txt kind="meta" style={{ fontSize: 11, textAlign: 'center' }}>
                    {locked ? '전망대와 우체통을 완공하면 열려요' : descriptions[b]}
                  </Txt>
                </Pressable>
              );
            })}
          </View>
          {i.buildingQuest && (
            <Btn
              title="게시판에서 건설 퀘스트 보기"
              kind="glass"
              onPress={() => e.go('quest', 'building')}
            />
          )}
        </>,
      )}
      {candidate && (
        <Overlay close={() => setCandidate(null)}>
          <View
            style={{
              padding: 8,
              gap: 14,
              backgroundColor: '#477b91',
              borderRadius: 16,
            }}
          >
            <View style={[k.row, { justifyContent: 'space-between' }]}>
              <Txt kind="h" style={{ color: '#fff8e8' }}>
                {buildingNames[candidate]} 청사진
              </Txt>
              <Close onPress={() => setCandidate(null)} />
            </View>
            <View style={k.row}>
              <Pic id={`bld/${buildingArt[candidate]}`} w={120} />
              <View style={{ flex: 1, gap: 8 }}>
                <Txt style={{ color: '#fff8e8' }}>{descriptions[candidate]}</Txt>
                <Txt style={{ color: '#fff8e8' }}>
                  총 {costs[candidate]}마리 · 각자 {buildingShare(i, candidate)}
                  마리 · {buildMinutes[candidate]}분
                </Txt>
                <Txt kind="meta" style={{ color: '#e0f3ee' }}>
                  선택 시 현재 주민을 대상으로 건설 퀘스트를 등록해요.
                </Txt>
              </View>
            </View>
            <Btn
              title={host ? '이 건물을 다음 목표로' : '방장만 목표를 선택할 수 있어요'}
              disabled={!host}
              onPress={() => {
                e.dispatch({ type: 'SELECT_BUILDING', building: candidate });
                setCandidate(null);
                e.notify('게시판에 건설 퀘스트가 등록됐어요.');
              }}
            />
          </View>
        </Overlay>
      )}
    </>
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
  return <RedesignScreens e={e} />;
}
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
      // 내 뗏목·친구 관리·친구 찾기는 v2 시트 구현(Screens.tsx)이 그린다
      <RedesignScreens e={e} />
    );
  if (r === 'friends' || r === 'friendSearch')
    return (
      // 친구 요청 수락·거절·취소, 친구 ··· 삭제, 닉네임 정확히 일치 검색
      <RedesignScreens e={e} />
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
  return <RedesignScreens e={e} />;
}
