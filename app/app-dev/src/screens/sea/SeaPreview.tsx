import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Btn, Txt } from '@/design-system/patterns';
import { MotionContext } from '@/design-system/primitives';
import { semanticTokens as s, primitiveTokens as p } from '@/design-system/tokens';
import { colors, initialState } from '@/services/model';
import { SeaDeparture } from './SeaDeparture';
import { SeaScreen } from './SeaScreen';
import { SeaVoyagePreparation } from './SeaVoyagePreparation';
import { SeaArrival, SeaParticipant, SeaVoyage } from './seaModel';
import { duckPreviewArt } from './seaRewardCatalog';

// ?sea 전용. 실제 API·세션 저장소·인벤토리는 읽거나 변경하지 않는다.
const fixturePeople: SeaParticipant[] = [
  '나',
  '두부',
  '호두',
  '콩이',
  '모카',
  '보리',
  '나비',
  '우유',
  '밤이',
  '구름',
].map((name, index) => ({
  userId: `preview-${index}`,
  name,
  color: colors[index % colors.length],
  focusing: index !== 0 && index % 3 !== 1,
  activeSeconds: index * 613,
  subject: index % 3 === 1 ? undefined : ['영어 단어', '논문 읽기', '코딩 테스트'][index % 3],
  message: index === 1 ? '오늘도 내 속도로 한 걸음씩 가보자!' : undefined,
}));
const fixtureVoyage = (): SeaVoyage => ({
  sessionId: 'preview-voyage',
  destinationId: 'preview-island',
  destinationName: '별고래섬',
  subject: '수학 문제집 3장',
  activeSeconds: 432,
  requiredSeconds: 1800,
  canDisembark: false,
});
const fixtureCatalog = { 'preview-duck': duckPreviewArt };
const delay = () => new Promise<void>((resolve) => setTimeout(resolve, 650));

export function SeaPreview() {
  const { width, height } = useWindowDimensions();
  const query = new URLSearchParams(window.location.search);
  const canvas = query.has('canvas');
  const [people, setPeople] = useState(fixturePeople);
  const [count, setCount] = useState(10);
  const [voyage, setVoyage] = useState<SeaVoyage | null>(() =>
    query.get('stage') === 'arrived'
      ? { ...fixtureVoyage(), activeSeconds: 2050, canDisembark: true }
      : query.get('stage') === 'focus'
        ? fixtureVoyage()
        : null,
  );
  const [result, setResult] = useState<SeaArrival | null>(null);
  const [reduce, setReduce] = useState(false);
  const [guest, setGuest] = useState(false);
  const [fail, setFail] = useState(false);
  const [reward, setReward] = useState<'duck' | 'none' | 'unknown' | 'unconfirmed'>('duck');
  const [preparing, setPreparing] = useState(false);
  const [departing, setDeparting] = useState(false);
  const [visited, setVisited] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [emoteTTL, setEmoteTTL] = useState(0);
  const [landscape, setLandscape] = useState(false);
  // 바다 잡지(GROMO-2314) — `stage=magazine` 이면 펠리컨 배달부터, 나중에·펼치기 뒤에는 뗏목 위 물건
  const [magazine, setMagazine] = useState<'delivery' | 'unread' | 'read' | null>(() =>
    query.get('stage') === 'magazine' ? 'delivery' : null,
  );
  useEffect(() => {
    const timer = setInterval(() => {
      setVoyage((current) =>
        current
          ? {
              ...current,
              activeSeconds: current.activeSeconds + 1,
              canDisembark: current.activeSeconds + 1 >= current.requiredSeconds,
            }
          : null,
      );
      setCooldown((current) => Math.max(0, current - 1));
      setEmoteTTL((current) => Math.max(0, current - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, []);
  const reset = () => {
    setResult(null);
    setVoyage(null);
    setVisited(false);
    setPreparing(false);
    setDeparting(false);
  };
  const check = async () => {
    await delay();
    if (fail) throw new Error('preview failure');
  };
  const frameWidth = canvas ? width : Math.min(width, landscape ? 874 : 402);
  const frameHeight = canvas
    ? height
    : landscape
      ? 402
      : Math.min(874, Math.max(660, height - 160));
  const self = {
    ...people[0],
    focusing: !!voyage,
    activeSeconds: voyage?.activeSeconds || 0,
    emote: emoteTTL ? people[0].emote : undefined,
  };
  const state = initialState();
  state.color = self.color;
  state.settings.reduceMotion = reduce;
  return (
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width, height },
        insets: { top: 0, bottom: 0, left: 0, right: 0 },
      }}
    >
      <MotionContext.Provider value={reduce}>
        <ScrollView style={styles.page} contentContainerStyle={canvas ? undefined : styles.content}>
          {!canvas && (
            <View
              style={styles.controls}
              accessibilityElementsHidden={preparing}
              importantForAccessibility={preparing ? 'no-hide-descendants' : 'auto'}
              aria-hidden={preparing}
              pointerEvents={preparing ? 'none' : 'auto'}
            >
              <Txt kind="h">먼바다 화면 미리보기</Txt>
              <Txt kind="meta">테스트 데이터 · 실제 집중 기록과 보상은 변경하지 않아요</Txt>
              <View style={styles.toolbar}>
                <Btn small title="떠 있는 중" onPress={reset} />
                <Btn
                  small
                  title="출항 연출"
                  onPress={() => {
                    reset();
                    setDeparting(true);
                  }}
                />
                <Btn
                  small
                  title="항해 중"
                  onPress={() => {
                    reset();
                    setVoyage(fixtureVoyage());
                  }}
                />
                <Btn
                  small
                  title="도착 직전"
                  onPress={() => {
                    reset();
                    setVoyage({ ...fixtureVoyage(), activeSeconds: 1797 });
                  }}
                />
                <Btn
                  small
                  title="도착 후 집중"
                  onPress={() => {
                    reset();
                    setVoyage({ ...fixtureVoyage(), activeSeconds: 2050, canDisembark: true });
                  }}
                />
                <Btn
                  small
                  title={`${count}명`}
                  onPress={() => setCount(count === 10 ? 1 : count === 1 ? 5 : 10)}
                />
                <Btn
                  small
                  title={reduce ? '모션 줄이기 켜짐' : '모션 줄이기 꺼짐'}
                  onPress={() => setReduce(!reduce)}
                />
                <Btn
                  small
                  title={guest ? '게스트' : '로그인 상태'}
                  onPress={() => setGuest(!guest)}
                />
                <Btn
                  small
                  title={fail ? '실패 응답' : '성공 응답'}
                  onPress={() => setFail(!fail)}
                />
                <Btn
                  small
                  title={`보상: ${reward === 'duck' ? '오리' : reward === 'none' ? '없음' : reward === 'unknown' ? '미등록 에셋' : '미확인'}`}
                  onPress={() =>
                    setReward(
                      reward === 'duck'
                        ? 'none'
                        : reward === 'none'
                          ? 'unknown'
                          : reward === 'unknown'
                            ? 'unconfirmed'
                            : 'duck',
                    )
                  }
                />
                <Btn
                  small
                  title={landscape ? '가로 화면' : '세로 화면'}
                  onPress={() => setLandscape(!landscape)}
                />
                <Btn
                  small
                  title={`고양이: ${self.color}`}
                  onPress={() =>
                    setPeople((current) =>
                      current.map((person, index) =>
                        index
                          ? person
                          : {
                              ...person,
                              color: colors[(colors.indexOf(person.color) + 1) % colors.length],
                            },
                      ),
                    )
                  }
                />
              </View>
            </View>
          )}
          <View style={[styles.frame, { width: frameWidth, height: frameHeight }]}>
            <View
              style={styles.scene}
              accessibilityElementsHidden={preparing}
              importantForAccessibility={preparing ? 'no-hide-descendants' : 'auto'}
              aria-hidden={preparing}
              pointerEvents={preparing ? 'none' : 'auto'}
            >
              {departing ? (
                <SeaDeparture
                  state={state}
                  onComplete={() => {
                    setDeparting(false);
                  }}
                />
              ) : visited ? (
                <View style={styles.visited}>
                  <Txt kind="h">별고래섬 방문 연결 지점</Txt>
                  <Txt>실서비스에서는 기존 방문자/주민 섬 화면으로 이동합니다.</Txt>
                  <Btn title="다시 보기" onPress={reset} />
                </View>
              ) : (
                <SeaScreen
                  self={self}
                  participants={[self, ...people.slice(1, count)]}
                  voyage={voyage}
                  result={result}
                  guest={guest}
                  messageCooldownSeconds={cooldown}
                  rewardCatalog={fixtureCatalog}
                  onTelescope={() => setPreparing(true)}
                  magazine={
                    magazine && {
                      issueNo: 20,
                      delivery: magazine === 'delivery',
                      received: magazine !== 'delivery',
                      unread: magazine !== 'read',
                      onShown: () => {},
                      onOpen: () => setMagazine('read'),
                      onLater: () => setMagazine('unread'),
                    }
                  }
                  onSignIn={() => setGuest(false)}
                  onFriendRequest={async () => {
                    await check();
                    return true;
                  }}
                  onFinish={async (_sessionId, intent) => {
                    await check();
                    if (!voyage) return;
                    if (intent === 'disembark')
                      setResult({
                        recordId: 'preview-result',
                        destinationId: voyage.destinationId,
                        destinationName: voyage.destinationName,
                        activeSeconds: voyage.activeSeconds,
                        rewards:
                          reward === 'none' || reward === 'unconfirmed'
                            ? []
                            : [reward === 'duck' ? 'preview-duck' : 'preview-unknown'],
                        minutesToNextTier: reward === 'none' ? 25 : null,
                        rewardsUnknown: reward === 'unconfirmed',
                      });
                    setVoyage(null);
                  }}
                  onExplore={async () => {
                    await check();
                    setVisited(true);
                  }}
                  onMessage={async (message) => {
                    await check();
                    setPeople((current) =>
                      current.map((person, index) => (index ? person : { ...person, message })),
                    );
                    setCooldown(300);
                  }}
                  onEmote={async (emote) => {
                    await check();
                    setPeople((current) =>
                      current.map((person, index) => (index ? person : { ...person, emote })),
                    );
                    setEmoteTTL(5);
                  }}
                />
              )}
            </View>
            {preparing && (
              <SeaVoyagePreparation
                destinationName="별고래섬"
                pending={false}
                onClose={() => setPreparing(false)}
                onStart={(message) => {
                  setPreparing(false);
                  setPeople((current) =>
                    current.map((person, index) => (index ? person : { ...person, message })),
                  );
                  setVoyage({ ...fixtureVoyage(), activeSeconds: 0 });
                }}
              />
            )}
          </View>
        </ScrollView>
      </MotionContext.Provider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  scene: { flex: 1 },
  controls: { alignItems: 'center', gap: p.space[2] },
  frame: { overflow: 'hidden' },
  page: { flex: 1, backgroundColor: s.color.canvas },
  content: { alignItems: 'center', paddingVertical: p.space[4], gap: p.space[2] },
  toolbar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: p.space[2],
    maxWidth: 1100,
    paddingHorizontal: p.space[3],
  },
  visited: {
    flex: 1,
    justifyContent: 'center',
    padding: p.space[6],
    gap: p.space[4],
    backgroundColor: s.color.canvas,
  },
});
