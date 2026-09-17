import React, { useEffect, useRef, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  State,
  Building,
  Route,
  currentIsland,
  buildingNames,
  costs,
  buildMinutes,
  balance,
  buildingShare,
  earnedBy,
  collectedBy,
  isHost,
  sessionSeconds,
  dayKey,
  periodBounds,
  islandWeeklyAverage,
  hoursMinutes,
  questMemberRate,
} from '@/services/model';
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
  Strip,
  Toggle,
  Overlay,
} from '@/design-system/patterns';
import { IslandSheet, IslandPopup } from '@/screens/island/IslandSheet';
import { InteriorRoute } from '@/screens/interiors/BuildingInteriors';
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
  if (['hall', 'manage', 'members', 'ledger', 'construction'].includes(r))
    return <Hall key={r} e={e} />;
  // 게시판·우체통은 건물 안 장면(BuildingInteriors)으로 그린다
  if (['board', 'notice', 'noticeEdit', 'quest', 'questEdit'].includes(r))
    return (
      <>
        <InteriorRoute e={e} />
        <RewardModal e={e} />
      </>
    );
  if (['mail', 'chat', 'friendMail'].includes(r)) return <InteriorRoute e={e} />;
  if (['tower', 'explore'].includes(r)) return <Tower e={e} />;
  if (['boat', 'friends', 'friendSearch'].includes(r)) return <Social e={e} />;
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
    <FiModal hidden={dialog === 'reward'}>
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
      {/* 퀘스트가 여럿이거나 화면이 낮으면 카드(FiModal) 안에서 통째로 스크롤한다 */}
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
function Tower({ e }: any) {
  return <RedesignScreens e={e} />;
}
function Social({ e }: any) {
  const s: State = e.state,
    r = e.route,
    [query, setQuery] = useState(''),
    friends = s.friends ?? [];
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
  return null;
}
function ShopMusic({ e }: any) {
  return <RedesignScreens e={e} />;
}
