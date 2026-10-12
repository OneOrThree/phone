import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type ImageStyle,
} from 'react-native';
import { Badge, Btn, Pic, Txt, art } from '@/design-system/patterns';
import { Card } from '@/design-system/primitives';
import { componentTokens, primitiveTokens, semanticTokens } from '@/design-system/tokens';
import { errorTextOr, t } from '@/i18n';
import { formatDuration } from '@/i18n/format';
import { Flag } from '@/screens/cosmetics/Cosmetics';
import { IslandPopup, SheetGroup, SheetRow } from '@/screens/island/IslandSheet';
import { useIslandSailing } from '@/screens/island/useIslandSailing';
import { useTelescope } from '@/screens/island/useTelescope';
import { uuid } from '@/services/api/client';
import { sessionGeneration } from '@/services/api/session';
import { arriveAtIsland, type TelescopeItem } from '@/services/api/telescope';
import { unknownOutcome } from '@/services/islandCommands';
import { islandErrorMessage } from '@/services/islandErrors';
import { intentKeyPool, type State } from '@/services/model';
import { useAppLayout } from '@/utils/layout';

const { space } = primitiveTokens;
const { color, stroke, size } = semanticTokens;
/** 파노라마 섬 그림 지름. 한 화면에 두세 섬이 보이고 다음 섬이 삐져나와 가로로 밀 수 있다는 걸 알린다. */
const ISLAND = space[16] * 2;
/** 소속 섬 깃발 크기. 깃대 끝이 그림 높이의 88% 라(Flag 도형) 그만큼 올려 섬 꼭대기에 꽂는다. */
const FLAG = size.tapMin;
const FLAG_POLE_BASE = Math.round(FLAG * 0.88);
// 눌림 opacity — SheetRow·Row 와 같은 값(DESIGN §7.3). 내보낸 공용 상수가 없어(SheetRow 는 인라인 0.7, 토큰은 diary 전용) 여기서 한 번만 이름을 붙인다.
const PRESSED_OPACITY = 0.7;
// 꽉 채우는 그림. 웹(react-native-web)은 absoluteFill 만 주면 원본 픽셀 크기로 그려서 폭·높이를 같이 준다(IslandSheet 와 같다)
const FILL: ImageStyle = { position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' };

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.secondary },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[2],
  },
  chip: { flexShrink: 1 },
  // 위 막대 아래에 흐름으로 쌓는다 — 예전 절대 위치(top: 18%)는 큰 글자·가로 화면에서 위 막대와 겹쳤다. 보통 크기 폰에서는 그 자리(뗏목 위)와 거의 같다.
  band: { marginTop: space[10] },
  panel: { marginHorizontal: semanticTokens.spacing.page, alignItems: 'center' },
  panelText: { textAlign: 'center' },
  cell: { width: ISLAND, alignItems: 'center', gap: space[2] },
  island: {
    width: ISLAND,
    height: ISLAND,
    borderRadius: ISLAND / 2,
    borderWidth: stroke.strong,
    borderColor: color.outline,
    backgroundColor: color.secondary,
    overflow: 'hidden',
    boxShadow: `0px ${space[1]}px 0px ${color.outline}`,
  },
  flag: { position: 'absolute', top: -FLAG_POLE_BASE, right: space[8] },
  // 이름 알약(Badge soft)을 섬 아래 가운데에 두고 칸 폭을 넘지 않게 한다(Badge 기본 배치는 왼쪽 정렬)
  pill: { alignSelf: 'center', maxWidth: ISLAND },
  // 말풍선 이름이 오른쪽 위 닫기(×) 밑으로 들어가지 않게 비운다
  bubbleName: { paddingRight: space[10] },
});

type IntentKeys = ReturnType<typeof intentKeyPool>;

/**
 * 도착 기록. 내 소속 섬이면(`true`) 서버가 현재 섬도 옮겼고 소속은 다시 읽어 둔 상태다.
 * 응답을 잃어 결과를 모르면(타임아웃·연결 끊김) 서버는 이미 도착을 기록하고 현재 섬까지 옮겼을 수 있다 —
 * islandCommands.switchCurrent 와 같은 분류·규칙으로 소속을 다시 읽어 그 섬이 현재 섬이면 성공으로, 아니면 원래 오류를 올린다.
 * (그대로 두면 로컬은 옛 현재 섬을 들고 있어 이후 [돌아가기]가 «이미 서 있는 섬»으로 착각해 요청 없이 홈만 연다.)
 * 확정된 4xx 는 서버가 바꾼 게 없으니 다시 읽지 않는다.
 * `Idempotency-Key` 는 현재 섬 이동(switchCurrent)과 같은 의도 키 풀·UUID 생성기로 만든다 — 섬당 의도 하나, 실패(결과 불명 포함)로
 * 끝나면 키를 그대로 둬 같은 섬으로의 재시도가 같은 키로 나가고, 도착 POST 응답을 받으면 바로 해제한다(아래 주석).
 */
async function arrive(e: any, keys: IntentKeys, islandId: string): Promise<boolean> {
  const key = keys.key('arrive', islandId);
  try {
    const { membershipStatus } = await arriveAtIsland(islandId, key);
    // 도착 POST 응답을 받은 직후 해제한다(switchCurrent 는 소속 재조회로 currentIslandId 일치까지 확인한 뒤 해제 — 여기는 재조회 실패 시 다음 [항해하기]가 새 키로 가지만, 서버 도착은 같은 섬이면 결과가 같아 안전하다)
    keys.release('arrive', islandId);
    if (membershipStatus !== 'active') return false;
    await e.islands.sync();
    return true;
  } catch (thrown) {
    if (!unknownOutcome(thrown)) throw thrown;
    let my;
    try {
      my = await e.islands.sync();
    } catch {
      my = null;
    }
    if (my?.currentIslandId !== islandId) throw thrown;
    return true; // 서버가 이미 옮겼다 — 곧 화면을 떠나 키 풀도 사라진다
  }
}

/** 내 소속 섬 — 서버가 joined 칸에 두거나 이미 활성 멤버십이면(핀이 남은 섬 등) 가입 버튼 없이 깃발을 꽂는다. */
const isJoined = (item: TelescopeItem) =>
  item.slot === 'joined' || item.membershipStatus === 'active';

/** 평균 집중 — 서버가 «집계 전»이면 null 이라 0분과 구분한다. */
const averageText = (minutes: number | null) =>
  minutes == null
    ? t('telescope.averageUnknown')
    : t('telescope.averageFocus', { time: formatDuration(minutes * 60) });

/** 로딩·빈 목록·오류 안내 — 공용 Card 를 파노라마 자리에 같은 폭으로 둔다. */
function Panel({ children }: { children: React.ReactNode }) {
  return <Card style={styles.panel}>{children}</Card>;
}

/** 파노라마의 섬 하나 — 둥근 스티커 그림 + 이름 알약. 소속 섬 위에는 깃발. 위아래로 번갈아 어긋나게 둬 한 줄 목록처럼 안 보이게 한다. */
function IslandCell({
  item,
  index,
  largeText,
  disabled,
  onPress,
}: {
  item: TelescopeItem;
  index: number;
  /** 큰 글자 — 이름 알약이 두 줄까지 늘어난다(보통은 한 줄 말줄임). */
  largeText: boolean;
  /** 항해·이동 요청 중에는 눌리지 않는다 — 말풍선을 열었다 닫으며 뒤로가기 삼킴을 흩트리지 않게. */
  disabled: boolean;
  onPress: () => void;
}) {
  const joined = isJoined(item);
  return (
    <Pressable
      testID={`telescope-island-${item.islandId}`}
      accessibilityRole="button"
      accessibilityLabel={joined ? t('telescope.joinedIslandA11y', { name: item.name }) : item.name}
      accessibilityHint={t('telescope.islandHint')}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.cell,
        index % 2 ? { marginTop: space[6] } : null,
        pressed ? { opacity: PRESSED_OPACITY } : null,
      ]}
    >
      <View style={styles.island}>
        <Pic id="island/whole" w="100%" h="100%" cover />
      </View>
      {joined && (
        // 장식 — 소속 여부는 위 접근성 라벨이 말한다.
        <View
          testID={`telescope-flag-${item.islandId}`}
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={styles.flag}
        >
          <Flag size={FLAG} />
        </View>
      )}
      <Badge soft numberOfLines={largeText ? 2 : 1} style={styles.pill}>
        {item.name}
      </Badge>
    </Pressable>
  );
}

/**
 * 섬 말풍선(`IslandPopup`) — 이름 · 소개 · 주민 · 평균 집중 · 항해 시간 아래에 행동 버튼.
 * 소속 섬은 가 봤으면 [돌아가기]·안 가 봤으면 [항해하기] 하나, 그 밖의 섬은 [항해하기] + 가입 버튼 하나.
 */
function IslandBubble({
  item,
  locked,
  joining,
  onClose,
  onSail,
  onReturn,
  onJoin,
}: {
  item: TelescopeItem;
  /** 요청 중(항해·이동, 어느 섬의 가입이든) — 모든 버튼을 막아 항해·가입이 겹쳐 나가지 않게 한다. */
  locked: boolean;
  /** 이 섬의 가입 요청 중 — 가입 버튼만 «처리 중»으로 보인다(다른 섬의 요청은 이 섬 버튼을 처리 중으로 보이게 하지 않는다). */
  joining: boolean;
  onClose: () => void;
  onSail: () => void;
  onReturn: () => void;
  onJoin: () => void;
}) {
  const pending = item.membershipStatus === 'pending';
  const joinLabel = joining
    ? t('islandVisit.visitorJoin.busy')
    : pending
      ? t('telescope.pending')
      : item.full
        ? t('telescope.full')
        : t(item.approvalRequired ? 'telescope.apply' : 'telescope.joinNow');
  return (
    <IslandPopup onClose={onClose}>
      <Txt
        testID="telescope-bubble-name"
        kind="h17"
        accessibilityRole="header"
        style={styles.bubbleName}
      >
        {item.name}
      </Txt>
      {!!item.intro && <Txt>{item.intro}</Txt>}
      <SheetGroup>
        <SheetRow
          title={t('telescope.residents', { count: item.memberCount, max: item.maxMembers })}
        />
        <SheetRow title={averageText(item.averageFocusMinutesPerDay)} />
        <SheetRow title={t('telescope.sailing', { minutes: item.sailingMinutes })} />
      </SheetGroup>
      {isJoined(item) ? (
        item.arrivedBefore ? (
          <Btn
            dynamicHeight
            title={t('telescope.returnHome')}
            disabled={locked}
            onPress={onReturn}
          />
        ) : (
          <Btn dynamicHeight title={t('telescope.sail')} disabled={locked} onPress={onSail} />
        )
      ) : (
        <>
          <Btn dynamicHeight title={t('telescope.sail')} disabled={locked} onPress={onSail} />
          <Btn
            dynamicHeight
            kind="sec"
            title={joinLabel}
            disabled={locked || pending || item.full}
            onPress={onJoin}
          />
        </>
      )}
    </IslandPopup>
  );
}

/**
 * 망원경(GROMO-2266) — 바다 위 섬 파노라마. 서버가 이 시간대에 보여 주는 섬 최대 8개를 응답 순서대로 가로로 늘어놓고,
 * 섬을 누르면 말풍선(이름·소개·주민·평균 집중·항해 시간 + 행동)이 뜬다. 임시 입구는 뗏목 행선지 「망원경」(N5).
 *
 * - 소속 섬: 한 번 가 봤으면 [돌아가기] 로 항해 없이 현재 섬을 옮겨 홈으로, 망원경으로 가입만 하고 안 가 봤으면 [항해하기].
 * - 그 밖의 섬: [항해하기] 로 구경하고(`full` 이어도 된다), 가입은 [바로 가입]/[가입 신청](`origin: 'telescope'` —
 *   즉시 가입이어도 현재 섬을 옮기지 않는다. 처음 한 번은 항해해서 가야 한다).
 */
export function Telescope({ e }: { e: any }) {
  const s: State = e.state;
  const L = useAppLayout();
  // 시스템 글자가 크면 이름 알약은 두 줄까지, 작은 버튼은 높이를 콘텐츠에 맞춘다(보통 크기의 38pt 모양은 그대로)
  const largeText = (L.fontScale ?? 1) >= componentTokens.telescope.largeTextThreshold;
  const list = useTelescope({ active: !!e.islands });
  // 읽기가 실패해 오류 안내로 바뀌면 한 번 알린다 — 안드로이드는 아래 오류 문구의 live region 이, iOS 는 여기서 직접(IslandSheet.SheetToast 와 같은 방식)
  const errorText =
    list.status === 'error' ? errorTextOr(list.error, 'telescope.loadFailed') : null;
  useEffect(() => {
    if (errorText && Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(errorText);
  }, [errorText]);
  const sail = useIslandSailing(e);
  // 풀은 이 화면 수명 — 결과 불명 뒤 화면을 나갔다 오면 새 키다(도착은 같은 섬이면 결과가 같아 무해). 세션 세대 동안 유지하려면 islandCommands.arrive + scoped().keys 로 옮긴다(후속).
  const keyPool = useRef<IntentKeys | null>(null);
  const keys = (keyPool.current ??= intentKeyPool(uuid));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // 가입 요청 중인 섬 — 그 섬의 버튼만 «처리 중»으로 보인다. joiningRef 는 서버 중복 호출 방지(한 번에 한 가입 요청만 나간다).
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const joiningRef = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // 목록이 다시 읽히면 같은 섬의 최신 값으로 말풍선을 갱신한다. 목록에서 사라진 섬이면 말풍선도 닫힌다.
  const selected = list.items.find((item) => item.islandId === selectedId) ?? null;
  const popupOpen = !!selected;
  // 말풍선이 열려 있으면 뒤로가기는 말풍선만 닫는다. 항해 중 뒤로가기 삼킴(useIslandSailing)과 겹치지 않게
  // 항해·이동을 시작할 때 말풍선을 먼저 닫고, 요청 중에는 섬이 눌리지 않아 말풍선이 열리지 않는다.
  // 정리는 «내 함수가 아직 걸려 있을 때만» 지운다 — 남이 갈아 끼운 삼킴을 지우지 않는다.
  useEffect(() => {
    if (!popupOpen || !e.backOverride) return;
    const closePopup = () => {
      setSelectedId(null);
      return true;
    };
    e.backOverride.current = closePopup;
    return () => {
      if (e.backOverride.current === closePopup) e.backOverride.current = null;
    };
  }, [popupOpen, e.backOverride]);

  const voyage = (item: TelescopeItem) => {
    // 집중·휴식 중에는 섬을 구경할 수 없다 — ServerVisit 의 [섬 둘러보기]와 같은 안내.
    if (s.session) return e.notify(t('islandVisit.sessionBlocksBrowse'));
    setSelectedId(null);
    return sail.sail(item.name, async () => {
      // 망원경으로 가입한 소속 섬의 첫 도착이면 서버가 현재 섬을 옮겼다 — 소속을 다시 읽고 새 섬 홈으로 간다.
      if (await arrive(e, keys, item.islandId)) return () => e.reset('home');
      // 비주민은 구경(방문 모드)으로 들어간다 — ServerVisit 의 [섬 둘러보기]와 같은 길이다.
      // TODO E1-5 항해 집중이 생기면 바다 담당이 이 구경 진입을 항해 집중으로 교체한다
      await e.islands.visit(item.islandId);
      return () => {
        e.dispatch({ type: 'SERVER_VISITING', islandId: item.islandId });
        e.replace('visitIsland', item.islandId);
      };
    });
  };

  const goBack = (item: TelescopeItem) => {
    setSelectedId(null);
    // 지금 서 있는 섬이면 옮길 것이 없다 — 항해 연출 없이 홈으로.
    if (item.islandId === s.serverIslands?.currentIslandId) return e.home();
    return sail.switchTo({ id: item.islandId, name: item.name });
  };

  const join = async (item: TelescopeItem) => {
    if (joiningRef.current) return;
    joiningRef.current = true;
    setJoiningId(item.islandId);
    const gen = sessionGeneration();
    const alive = () => mounted.current && sessionGeneration() === gen;
    try {
      const result = await e.islands.join(item.islandId, {
        showApproval: false,
        origin: 'telescope',
      });
      if (!alive()) return;
      e.notify(
        result.status === 'pending'
          ? t('islandVisit.visitorJoin.requested')
          : t('telescope.joined'),
      );
      list.reload();
    } catch (thrown) {
      const message = islandErrorMessage(thrown);
      if (message && alive()) e.notify(message);
    } finally {
      joiningRef.current = false;
      if (mounted.current) setJoiningId(null);
    }
  };

  if (sail.sailing) return sail.sailing;

  return (
    <View testID="telescope" style={styles.root}>
      {/* 말풍선이 열려 있는 동안 뒤 화면은 스크린리더 탐색에서 숨긴다 */}
      <View
        style={StyleSheet.absoluteFill}
        accessibilityElementsHidden={popupOpen}
        importantForAccessibility={popupOpen ? 'no-hide-descendants' : 'auto'}
      >
        <Image
          source={art['sea/mine']}
          resizeMode="cover"
          accessibilityElementsHidden
          importantForAccessibility="no"
          style={FILL}
        />
        {/* 위 막대와 파노라마를 세로로 쌓는다 — 큰 글자·가로 화면에서도 겹치지 않고, 화면보다 길면 세로로 밀어 끝까지 닿는다 */}
        <ScrollView
          testID="telescope-scroll"
          alwaysBounceVertical={false}
          contentContainerStyle={{ paddingBottom: L.insets.bottom + space[4] }}
        >
          <View
            testID="telescope-top-bar"
            style={[
              styles.topBar,
              {
                paddingTop: L.insets.top + space[2],
                paddingLeft: L.insets.left + semanticTokens.spacing.page,
                paddingRight: L.insets.right + semanticTokens.spacing.page,
              },
            ]}
          >
            {/* 바다 위 보조 버튼 — 공용 Btn glass(DESIGN §7.2), 실제 터치 영역은 44 이상. 큰 글자에서는 높이가 글자를 따라 늘어난다 */}
            <Btn
              small
              kind="glass"
              dynamicHeight={largeText}
              title={t('telescope.back')}
              onPress={e.back}
            />
            {list.minutes !== null && (
              <View style={styles.chip}>
                <Badge>{t('telescope.nextIslands', { minutes: list.minutes })}</Badge>
              </View>
            )}
          </View>
          <View testID="telescope-band" style={styles.band}>
            {list.status === 'loading' ? (
              <Panel>
                <ActivityIndicator color={color.outline} />
                <Txt kind="meta">{t('telescope.loading')}</Txt>
              </Panel>
            ) : list.status === 'error' ? (
              <Panel>
                <Txt accessibilityLiveRegion="polite" style={styles.panelText}>
                  {errorText}
                </Txt>
                <Btn
                  small
                  kind="sec"
                  dynamicHeight={largeText}
                  title={t('common.retry')}
                  onPress={list.reload}
                />
              </Panel>
            ) : list.items.length === 0 ? (
              <Panel>
                <Txt style={styles.panelText}>{t('telescope.empty')}</Txt>
              </Panel>
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{
                  paddingTop: FLAG_POLE_BASE,
                  paddingLeft: L.insets.left + semanticTokens.spacing.page,
                  paddingRight: L.insets.right + semanticTokens.spacing.page,
                  gap: space[4],
                }}
              >
                {list.items.map((item, index) => (
                  <IslandCell
                    key={item.islandId}
                    item={item}
                    index={index}
                    largeText={largeText}
                    disabled={sail.busy}
                    onPress={() => setSelectedId(item.islandId)}
                  />
                ))}
              </ScrollView>
            )}
          </View>
        </ScrollView>
      </View>
      {selected && (
        <IslandBubble
          item={selected}
          locked={sail.pending || joiningId !== null}
          joining={joiningId === selected.islandId}
          onClose={() => setSelectedId(null)}
          // 핸들러는 Promise 를 돌려주지 않는다 — 테스트의 fireEvent 가 돌려준 Promise 를 기다리며 멈추지 않게
          onSail={() => {
            voyage(selected);
          }}
          onReturn={() => {
            goBack(selected);
          }}
          onJoin={() => {
            join(selected);
          }}
        />
      )}
    </View>
  );
}
