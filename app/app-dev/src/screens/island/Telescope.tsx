import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type ImageStyle,
} from 'react-native';
import { ISLAND_ART_ASPECT, ISLAND_STAGE_ART, islandStage } from '@/constants/magazineAssets';
import { Badge, Btn, NavBtn, Pic, Txt } from '@/design-system/patterns';
import { Card } from '@/design-system/primitives';
import { componentTokens, primitiveTokens, semanticTokens } from '@/design-system/tokens';
import { errorTextOr, t } from '@/i18n';
import { formatDuration } from '@/i18n/format';
import { Flag } from '@/screens/cosmetics/Cosmetics';
import { IslandPopup, SheetGroup, SheetRow } from '@/screens/island/IslandSheet';
import { endServerVisit, useIslandSailing } from '@/screens/island/useIslandSailing';
import { useTelescope } from '@/screens/island/useTelescope';
import { visibleTelescopeItems } from '@/screens/island/telescopeDestinations';
import { ApiError, CLIENT_STALE_SESSION, uuid } from '@/services/api/client';
import { getSession, sessionGeneration } from '@/services/api/session';
import { useFirstVoyage } from '@/screens/onboarding/useFirstVoyage';
import type { MagazineCell } from '@/services/api/magazine';
import { arriveAtIsland, unpinFromTelescope, type TelescopeItem } from '@/services/api/telescope';
import { unknownOutcome } from '@/services/islandCommands';
import { islandErrorMessage } from '@/services/islandErrors';
import { SeaVoyagePreparation } from '@/screens/sea/SeaVoyagePreparation';
import { RAFT_TELESCOPE_ASPECT, raftTelescope, telescopeSea } from '@/screens/sea/seaAssets';
import { saveSeaRemark } from '@/screens/sea/seaRemark';
import { intentKeyPool, serverVisit, sessionRoute, type Route, type State } from '@/services/model';
import { useAppLayout } from '@/utils/layout';
import { AdCell } from '@/screens/magazine/AdCell';
import { isTelescopeMock } from '@/services/api/magazineMock';

const { space } = primitiveTokens;
const { color, stroke, size } = semanticTokens;
const TELESCOPE = componentTokens.telescope;
/** 말풍선 잡지 칸 자리표시의 섬 그림 높이. */
const ISLAND = space[16] * 2;
/** 파노라마 섬 그림 — 섬만 잘라 둔 그림이라 너비가 높이를 정한다. */
const ART_W = TELESCOPE.islandArtWidth;
const ART_H = Math.round(ART_W / ISLAND_ART_ASPECT);
/** 소속 섬 깃발 크기. 깃대는 그림 가로 25% 에 서 있고 끝이 높이의 88% 라(Flag 도형) 그 점을 섬 그림 위 가운데에 꽂는다. */
const FLAG = size.tapMin;
const FLAG_POLE_BASE = Math.round(FLAG * 0.88);
const FLAG_POLE_X = Math.round(FLAG * 0.25);
/** 깃발이 섬 칸 위로 삐져나오는 만큼 — 가로 스크롤이 잘라 내지 않게 위를 비운다. */
const FLAG_ALLOWANCE = Math.max(0, FLAG_POLE_BASE - TELESCOPE.islandArtTop);
// 눌림 opacity — SheetRow·Row 와 같은 값(DESIGN §7.3). 내보낸 공용 상수가 없어(SheetRow 는 인라인 0.7, 토큰은 diary 전용) 여기서 한 번만 이름을 붙인다.
const PRESSED_OPACITY = 0.7;
// 꽉 채우는 그림. 웹(react-native-web)은 absoluteFill 만 주면 원본 픽셀 크기로 그려서 폭·높이를 같이 준다(IslandSheet 와 같다)
const FILL: ImageStyle = { position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' };

/**
 * 파노라마 바다(GROMO-2414) — 섬이 바다에 붙어 같이 밀리게 바다 그림을 가로로 이어 깐다. 한 장은 지금처럼 cover 가운데 맞춤
 * 크기·높이라 수평선이 그대로고, 스크롤 0 의 0번 장은 예전 한 장과 같은 자리다. 이음매가 안 보이게 홀수 번째 장은 좌우 반전한다
 * (맞닿는 가장자리가 같은 픽셀 줄). 스크롤 끝과 양쪽 튕김까지 한 화면씩 더 덮는다.
 */
export function telescopeSeaTiles(sceneW: number, sceneH: number, contentW: number) {
  const scale = Math.max(sceneW / telescopeSea.width, sceneH / telescopeSea.height);
  const width = telescopeSea.width * scale;
  const left0 = (sceneW - width) / 2;
  const first = -Math.ceil((left0 + sceneW) / width);
  const last = Math.ceil((Math.max(contentW, sceneW) + sceneW - left0) / width) - 1;
  return {
    top: (sceneH - telescopeSea.height * scale) / 2,
    width,
    height: telescopeSea.height * scale,
    tiles: Array.from({ length: last - first + 1 }, (_, i) => ({
      n: first + i,
      left: left0 + (first + i) * width,
      mirror: (first + i) % 2 !== 0,
    })),
  };
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.secondary },
  // 파노라마를 따라 밀리는 바다 층과 그 안에 이어 붙인 그림 한 장
  sea: { position: 'absolute' },
  seaTile: { position: 'absolute', top: 0 },
  topBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[2],
  },
  chip: { flexShrink: 1 },
  panel: { alignItems: 'center' },
  panelText: { textAlign: 'center' },
  // 섬 칸 — 폭은 섬 칸(146)과 이름 알약 중 넓은 쪽이라 긴 이름도 옆 섬 알약과 겹치지 않는다
  cell: { minWidth: TELESCOPE.islandBox, alignItems: 'center' },
  art: { width: ART_W, height: ART_H, marginTop: TELESCOPE.islandArtTop },
  // 깃대 밑동을 섬 그림 위 가운데에 꽂는다
  flag: { position: 'absolute', top: -FLAG_POLE_BASE, left: ART_W / 2 - FLAG_POLE_X },
  // 이름 알약(Badge soft)을 섬 그림 아래 가운데에 둔다(Badge 기본 배치는 왼쪽 정렬)
  pill: { alignSelf: 'center', marginTop: TELESCOPE.pillGap, maxWidth: TELESCOPE.pillMaxWidth },
  // 망원경 든 뗏목 고양이 — 장식이라 바다 그림 바로 위, 파노라마 아래에 깐다
  raft: {
    position: 'absolute',
    width: TELESCOPE.raft.width,
    height: TELESCOPE.raft.width / RAFT_TELESCOPE_ASPECT,
  },
  // 말풍선 이름이 오른쪽 위 닫기(×) 밑으로 들어가지 않게 비운다
  bubbleName: { paddingRight: space[10] },
  // 「찜」 리본 — 공용 Badge(Butter + Brown)를 마스킹테이프처럼 살짝 기울여 섬 그림 왼쪽 위에 붙인다
  ribbon: {
    position: 'absolute',
    ...TELESCOPE.ribbonOffset,
    transform: [{ rotate: TELESCOPE.ribbonTilt }],
  },
  // 테이프답게 끝이 각지게 — Badge 의 알약 반경만 덮어쓴다
  tape: { borderRadius: space[1] },
  // 잡지 칸 미리보기 자리표시 — 종이 틀(Paper + Brown) 안에 섬 그림과 라벨
  magazine: {
    gap: space[2],
    padding: space[2],
    borderWidth: stroke.strong,
    borderColor: color.outline,
    borderRadius: semanticTokens.radius.control,
    backgroundColor: color.surface,
  },
  magazinePicture: {
    height: ISLAND,
    borderRadius: space[2],
    overflow: 'hidden',
    backgroundColor: color.secondary,
  },
  magazineCaption: { textAlign: 'center' },
  // 진짜 잡지 칸 — 칸 그림이 틀을 가져 종이 테두리를 겹치지 않는다
  magazineCell: { gap: space[2] },
  // 항해 중인 섬의 [망원경에서 빼기] — 흐리게 보이지만 누를 수는 있다(누르면 항해를 그만둘지 묻는다)
  voyaging: { opacity: componentTokens.button.disabledOpacity },
});

type IntentKeys = ReturnType<typeof intentKeyPool>;

/**
 * 도착 기록(GROMO-2310 이후 망원경 [항해하기]는 바다 항해 집중으로 바뀌어 여기서 부르지 않는다 — 섬에 내린 뒤
 * 결과창(GROMO-2311)이 다시 쓴다). 내 소속 섬이면(`true`) 서버가 현재 섬도 옮겼고 소속은 다시 읽어 둔 상태다.
 * 응답을 잃어 결과를 모르면(타임아웃·연결 끊김) 서버는 이미 도착을 기록하고 현재 섬까지 옮겼을 수 있다 —
 * islandCommands.switchCurrent 와 같은 분류·규칙으로 소속을 다시 읽어 그 섬이 현재 섬이면 성공으로, 아니면 원래 오류를 올린다.
 * (그대로 두면 로컬은 옛 현재 섬을 들고 있어 이후 [돌아가기]가 «이미 서 있는 섬»으로 착각해 요청 없이 홈만 연다.)
 * 확정된 4xx 는 서버가 바꾼 게 없으니 다시 읽지 않는다.
 * `Idempotency-Key` 는 현재 섬 이동(switchCurrent)과 같은 의도 키 풀·UUID 생성기로 만든다 — 섬당 의도 하나, 실패(결과 불명 포함)로
 * 끝나면 키를 그대로 둬 같은 섬으로의 재시도가 같은 키로 나가고, 도착 POST 응답을 받으면 바로 해제한다(아래 주석).
 */
export async function arrive(e: any, keys: IntentKeys, islandId: string): Promise<boolean> {
  return (await arriveWithOutcome(e, keys, islandId)).member;
}

/** `arrive` + 서버가 준 `arrivedBefore`(결과를 모르는 채 소속으로 확인된 경우엔 true — 환영을 띄우지 않는다). */
export async function arriveWithOutcome(
  e: any,
  keys: IntentKeys,
  islandId: string,
): Promise<{ member: boolean; arrivedBefore: boolean }> {
  const key = keys.key('arrive', islandId);
  // 복구 상태를 반영하기 전에 같은 로그인인지 본다 — 재조회 중 로그아웃·계정 전환이 있었으면 이전 계정 값을 쓰지 않는다
  const generation = sessionGeneration();
  const userId = getSession()?.userId;
  const sameLogin = () => sessionGeneration() === generation && getSession()?.userId === userId;
  let arrival;
  try {
    arrival = await arriveAtIsland(islandId, key);
  } catch (thrown) {
    // POST 자체의 결과를 모를 때만 소속 재조회로 가린다
    if (!unknownOutcome(thrown)) throw thrown;
    let my;
    try {
      my = await e.islands.sync();
    } catch {
      my = null;
    }
    if (my?.currentIslandId !== islandId) throw thrown;
    return { member: true, arrivedBefore: true }; // 서버가 이미 옮겼다 — 곧 화면을 떠나 키 풀도 사라진다
  }
  // 도착 POST 응답을 받은 직후 해제한다(switchCurrent 는 소속 재조회로 currentIslandId 일치까지 확인한 뒤 해제 — 여기는 재조회 실패 시 다음 [항해하기]가 새 키로 가지만, 서버 도착은 같은 섬이면 결과가 같아 안전하다)
  keys.release('arrive', islandId);
  const { membershipStatus, arrivedBefore } = arrival;
  if (membershipStatus !== 'active') return { member: false, arrivedBefore };
  // 소속 재조회 실패는 도착 결과를 지우지 않는다 — 환영 판정은 POST 응답 기준이고(키가 풀려 재시도 POST 는 arrivedBefore=true 를 준다),
  // 소속 스냅샷은 홈 진입 뒤 기존 재조회 경로가 맞춘다
  let syncError: unknown = null;
  try {
    await e.islands.sync();
  } catch (thrown) {
    syncError = thrown;
  }
  if (syncError !== null) {
    // 세션이 바뀌었거나 인증이 끝난 실패는 복구하지 않고 다시 던진다(호출부가 화면 세대로 거른다)
    if (
      syncError instanceof ApiError &&
      (syncError.code === CLIENT_STALE_SESSION || syncError.status === 401)
    )
      throw syncError;
    if (!sameLogin()) return { member: true, arrivedBefore };
    // 소속 조회가 실패해도 도착 응답이 현재 섬을 알려 준다 — 첫 소속이면 로컬이 «소속 없음» 인 채로 홈에 가 소속 검사가
    // sea 로 되돌리지 않게 먼저 반영하고(기존 ISLAND_SYNC 재사용, 소속 목록은 그대로), 한 번 더 맞춰 본다
    if (arrival.currentIslandId)
      e.dispatch?.({
        type: 'ISLAND_SYNC',
        memberships: {
          items: e.state?.serverIslands?.memberships ?? [],
          currentIslandId: arrival.currentIslandId,
          lossReason: null,
        },
      });
    await e.islands.sync().catch(() => {});
  }
  return { member: true, arrivedBefore };
}

/** 내 소속 섬 — 서버가 joined 칸에 두거나 이미 활성 멤버십이면(핀이 남은 섬 등) 가입 버튼 없이 깃발을 꽂는다. */
const isJoined = (item: TelescopeItem) =>
  item.slot === 'joined' || item.membershipStatus === 'active';

/** 잡지에서 넣은 섬 — 「찜」 리본과 잡지 칸 미리보기가 붙는다. 전망대에서 넣은 섬은 같은 핀이어도 붙지 않는다(정본 170행). */
const isMagazinePin = (item: TelescopeItem) =>
  item.slot === 'pinned' && item.pinnedFrom === 'magazine';

/** 평균 집중 — 서버가 «집계 전»이면 null 이라 0분과 구분한다. */
const averageText = (minutes: number | null) =>
  minutes == null
    ? t('telescope.averageUnknown')
    : t('telescope.averageFocus', { time: formatDuration(minutes * 60) });

/** 로딩·빈 목록·오류 안내 — 공용 Card 를 파노라마 자리에 같은 폭으로 둔다. 좌우는 위 막대·파노라마처럼 안전 영역 + 페이지 여백이라 가로 화면에서 노치 쪽에 붙지 않는다. */
function Panel({ children }: { children: React.ReactNode }) {
  const { insets } = useAppLayout();
  return (
    <Card
      style={[
        styles.panel,
        {
          marginLeft: insets.left + semanticTokens.spacing.page,
          marginRight: insets.right + semanticTokens.spacing.page,
        },
      ]}
    >
      {children}
    </Card>
  );
}

/**
 * 파노라마의 섬 하나 — 건물 수에 맞는 섬 그림(`islandStage`, 잡지 칸 섬 프로필과 같은 4장) + 이름 알약. 소속 섬은 이름만,
 * 그 밖의 섬은 「이름 · 항해 시간」. 소속 섬 그림 위에는 깃발, 잡지에서 넣은 섬 그림 왼쪽 위에는 「찜」 리본.
 * 위아래로 번갈아 어긋나게 둬 한 줄 목록처럼 안 보이게 한다.
 */
function IslandCell({
  item,
  index,
  largeText,
  disabled,
  onPress,
  hideTime = false,
}: {
  item: TelescopeItem;
  index: number;
  /** 큰 글자 — 이름 알약이 두 줄까지 늘어난다(보통은 한 줄 말줄임). */
  largeText: boolean;
  /** 항해·이동 요청 중에는 눌리지 않는다 — 말풍선을 열었다 닫으며 뒤로가기 삼킴을 흩트리지 않게. */
  disabled: boolean;
  onPress: () => void;
  hideTime?: boolean;
}) {
  const joined = isJoined(item);
  const magazine = isMagazinePin(item);
  const time = formatDuration(item.sailingMinutes * 60);
  return (
    <Pressable
      testID={`telescope-island-${item.islandId}`}
      accessibilityRole="button"
      // 소속 섬이 아니면 알약처럼 항해 시간도 읽는다
      accessibilityLabel={
        hideTime
          ? item.name
          : joined
            ? t('telescope.joinedIslandA11y', { name: item.name })
            : t('telescope.islandTimeA11y', {
                label: magazine ? t('telescope.pinnedIslandA11y', { name: item.name }) : item.name,
                time,
              })
      }
      accessibilityHint={t('telescope.islandHint')}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.cell,
        index % 2 ? { marginTop: TELESCOPE.stagger } : null,
        pressed ? { opacity: PRESSED_OPACITY } : null,
      ]}
    >
      <View style={styles.art}>
        <Image
          testID={`telescope-art-${item.islandId}`}
          source={ISLAND_STAGE_ART[islandStage(item.memberCount, item.buildingCount)]}
          resizeMode="contain"
          style={FILL}
        />
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
        {magazine && (
          // 장식 — 잡지에서 넣은 섬이라는 뜻은 위 접근성 라벨이 말한다.
          <View
            testID={`telescope-ribbon-${item.islandId}`}
            pointerEvents="none"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={styles.ribbon}
          >
            <Badge style={styles.tape}>{t('telescope.ribbon')}</Badge>
          </View>
        )}
      </View>
      {/* 긴 이름은 가운데를 줄여 끝의 「 · 항해 시간」을 남긴다(안드로이드 두 줄은 끝 말줄임만 된다) */}
      <Badge soft numberOfLines={largeText ? 2 : 1} ellipsizeMode="middle" style={styles.pill}>
        {joined || hideTime ? item.name : t('telescope.islandLabel', { name: item.name, time })}
      </Badge>
    </Pressable>
  );
}

/**
 * 잡지 칸 미리보기(SCOPE-09) — 서버가 그 섬의 오늘 호 홍보 칸(`magazineCell`)을 주면 섬장이 꾸민 칸을 잡지와 같은 `AdCell` 로
 * 그린다(칸이 섬 이름·글을 직접 읽는다). 칸의 「주민·평균」 줄은 빼고 그린다 — 실린 날 숫자라, 바로 아래 말풍선 줄의 지금 숫자와
 * 다르게 겹쳐 보인다. 칸이 없으면(편집부 칸에서 넣었거나 칸이 숨겨짐) 섬 그림만 종이 틀에 둔다 — 미리보기가 아니라 장식이라
 * 「잡지 칸 미리보기」 글도 없고 스크린리더에서도 숨긴다(섬 이름은 말풍선 제목이 읽는다).
 */
function MagazinePreview({ cell }: { cell?: MagazineCell | null }) {
  const [width, setWidth] = useState(0);
  if (cell)
    return (
      <View
        testID="telescope-magazine-cell"
        style={styles.magazineCell}
        onLayout={(ev) => setWidth(ev.nativeEvent.layout.width)}
      >
        {width > 0 && <AdCell width={width} cell={cell} hideMeta />}
        <Txt kind="meta" style={styles.magazineCaption}>
          {t('telescope.magazinePreview')}
        </Txt>
      </View>
    );
  return (
    <View
      testID="telescope-magazine-preview"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.magazine}
    >
      <View style={styles.magazinePicture}>
        <Pic id="island/whole" w="100%" h="100%" cover />
      </View>
    </View>
  );
}

/**
 * 섬 말풍선(`IslandPopup`) — 이름 · 소개 · 주민 · 평균 집중 · 항해 시간 아래에 행동 버튼.
 * 소속 섬은 가 봤으면 [돌아가기]·안 가 봤으면 [항해하기] 하나, 그 밖의 섬은 [항해하기] + 가입 버튼 하나.
 * 직접 넣은 섬(`slot=pinned`)은 맨 아래에 [망원경에서 빼기]가 더 붙고, 잡지에서 넣은 섬은 소개 아래에 잡지 칸 미리보기가 붙는다.
 */
function IslandBubble({
  item,
  locked,
  joining,
  voyaging,
  onClose,
  onSail,
  onReturn,
  onJoin,
  onUnpin,
  firstVoyage = false,
}: {
  item: TelescopeItem;
  /** 요청 중(항해·이동, 어느 섬의 가입·빼기든) — 모든 버튼을 막아 항해·가입·빼기가 겹쳐 나가지 않게 한다. */
  locked: boolean;
  /** 이 섬의 가입 요청 중 — 가입 버튼만 «처리 중»으로 보인다(다른 섬의 요청은 이 섬 버튼을 처리 중으로 보이게 하지 않는다). */
  joining: boolean;
  /** 지금 구경(항해) 중인 섬 — [망원경에서 빼기]가 흐리게 보이고, 누르면 항해를 그만둘지 먼저 묻는다. */
  voyaging: boolean;
  onClose: () => void;
  onSail: () => void;
  onReturn: () => void;
  onJoin: () => void;
  onUnpin: () => void;
  firstVoyage?: boolean;
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
      {isMagazinePin(item) && <MagazinePreview cell={item.magazineCell} />}
      <SheetGroup>
        <SheetRow
          title={t('telescope.residents', { count: item.memberCount, max: item.maxMembers })}
        />
        <SheetRow title={averageText(item.averageFocusMinutesPerDay)} />
        {!firstVoyage && (
          <SheetRow title={t('telescope.sailing', { minutes: item.sailingMinutes })} />
        )}
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
          <Btn
            dynamicHeight
            title={t(firstVoyage ? 'firstVoyage.start' : 'telescope.sail')}
            disabled={locked}
            onPress={onSail}
          />
        )
      ) : (
        <>
          <Btn
            dynamicHeight
            title={t(firstVoyage ? 'firstVoyage.start' : 'telescope.sail')}
            disabled={locked}
            onPress={onSail}
          />
          {item.memberCount > 0 && (
            <Btn
              dynamicHeight
              kind="sec"
              title={joinLabel}
              disabled={locked || pending || item.full}
              onPress={onJoin}
            />
          )}
        </>
      )}
      {item.slot === 'pinned' && (
        <Btn
          dynamicHeight
          kind="ghost"
          title={t('telescope.unpin')}
          disabled={locked}
          // 항해 중인 섬은 흐리게만 보이게 하고 disabled 로 막지 않는다 — 막으면 스크린리더 사용자는 «왜 안 되는지»를 알려 주는
          // 확인창에 닿지 못한다. 대신 힌트로 이유를 말하고, 누르면 항해를 그만둘지 묻는다. 요청 중(locked)에는 진짜 비활성이다.
          style={voyaging && !locked ? styles.voyaging : undefined}
          accessibilityHint={voyaging ? t('telescope.unpinVoyagingHint') : undefined}
          onPress={onUnpin}
        />
      )}
    </IslandPopup>
  );
}

/**
 * 망원경(GROMO-2266) — 바다 위 섬 파노라마. 일반 섬 최대 8개와 별도 무인도 후보 1개를 응답 순서대로 가로로 늘어놓고,
 * 섬을 누르면 말풍선(이름·소개·주민·평균 집중·항해 시간 + 행동)이 뜬다. 임시 입구는 뗏목 행선지 「망원경」(N5).
 *
 * - 소속 섬: 한 번 가 봤으면 [돌아가기] 로 항해 없이 현재 섬을 옮겨 홈으로, 망원경으로 가입만 하고 안 가 봤으면 [항해하기].
 * - [항해하기]는 한마디 시트 → 바다 항해 집중(`POST /focus-sessions/sea`, GROMO-2310) → 항해 화면(`sea`)이다. 섬에는 정박 뒤 내린다.
 * - 그 밖의 섬: [항해하기]는 정원이 차도 된다(`full`), 가입은 [바로 가입]/[가입 신청](`origin: 'telescope'` —
 *   즉시 가입이어도 현재 섬을 옮기지 않는다. 처음 한 번은 항해해서 가야 한다).
 * - 직접 넣은 섬(`slot=pinned`, GROMO-2273): 말풍선에 [망원경에서 빼기] — `DELETE` 가 성공하면 열린 목록이 알림(`onTelescopeChanged`)으로
 *   다시 읽고 서버가 그 자리를 무작위 섬으로 채운다. 잡지에서 넣은 섬(`pinnedFrom=magazine`)에만 「찜」 리본과 잡지 칸 미리보기(칸이 없으면 자리표시)가 붙는다.
 *   지금 구경 중인 섬은 «항해 중»이라(서버에는 항해 상태가 없어 앱이 거친다) 「항해를 그만둘까요?」 확인 뒤에 빼고 구경도 끝낸다.
 *   리본·[빼기]는 목록의 `slot` 만 본다 — 넣었다는 상태를 로컬에 따로 들지 않는다(목록이 정본).
 */
export function Telescope({ e, previewItems }: { e: any; previewItems?: TelescopeItem[] }) {
  const s: State = e.state;
  const firstVoyage = useFirstVoyage(e, !!previewItems);
  const L = useAppLayout();
  // 시스템 글자가 크면 이름 알약은 두 줄까지, 작은 버튼은 높이를 콘텐츠에 맞춘다(보통 크기의 38pt 모양은 그대로)
  const largeText = (L.fontScale ?? 1) >= semanticTokens.typography.largeTextThreshold;
  const liveList = useTelescope({
    active: !previewItems && (!!e.islands || isTelescopeMock()),
    beforeLoad: e.islandBootError ? e.islands?.sync : undefined,
  });
  const list = previewItems
    ? { ...liveList, status: 'ready' as const, items: previewItems }
    : liveList;
  const items = visibleTelescopeItems(list.items);
  const uninhabitedOnly = items.length === 1 && items[0].memberCount === 0;
  const requests = new Map(
    [...(s.serverIslands?.joinRequests ?? []), ...(s.serverIslands?.requestStatus ?? [])].map(
      (request) => [request.id, request],
    ),
  );
  const hasPendingRequest = [...requests.values()].some((request) => request.status === 'pending');
  // 읽기가 실패해 오류 안내로 바뀌면 한 번 알린다 — 안드로이드는 아래 오류 문구의 live region 이, iOS 는 여기서 직접(IslandSheet.SheetToast 와 같은 방식)
  const errorText =
    list.status === 'error' ? errorTextOr(list.error, 'telescope.loadFailed') : null;
  useEffect(() => {
    if (errorText && Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(errorText);
  }, [errorText]);
  const sail = useIslandSailing(e);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // 가입 요청 중인 섬 — 그 섬의 버튼만 «처리 중»으로 보인다. joiningRef 는 서버 중복 호출 방지(한 번에 한 가입 요청만 나간다).
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const joiningRef = useRef(false);
  // 빼기 요청 중 — 가입처럼 한 번에 하나만 나가고, 그동안 말풍선의 모든 버튼이 막힌다.
  const [unpinning, setUnpinning] = useState(false);
  const unpinningRef = useRef(false);
  // [항해하기] → 한마디 시트(GROMO-2310). starting 은 시작 요청 중 — 시트를 닫거나 다시 누를 수 없다.
  const [preparing, setPreparing] = useState<TelescopeItem | null>(null);
  const [starting, setStarting] = useState(false);
  const startingRef = useRef(false);
  const [startError, setStartError] = useState<string | undefined>();
  // 섬 띠를 바다 그림의 수평선에 맞춘다 — 그림은 cover 가운데 맞춤이라 화면 크기로 수평선 높이를 잰다. 띠는 위 막대 아래 흐름에
  // 그대로 두고 위 여백만 늘려(큰 글자·가로 화면에서 위 막대가 길어지면 기본 여백으로 물러나) 겹치지 않는다.
  // 첫 그림부터 제자리에 오게 onLayout 전에는 창 크기와 보통 글자의 위 막대 높이(안전 영역 + 여백 + 작은 버튼 터치 44)로 잡는다.
  const [scene, setScene] = useState<{ width: number; height: number } | null>(null);
  const [topBarHeight, setTopBarHeight] = useState<number | null>(null);
  const { width: sceneW, height: sceneH } = scene ?? L;
  const barH = topBarHeight ?? L.insets.top + space[2] + size.tapMin;
  const seaScale = Math.max(sceneW / telescopeSea.width, sceneH / telescopeSea.height);
  const horizonY = (sceneH - telescopeSea.height * seaScale) / 2 + telescopeSea.horizon * seaScale;
  const bandTop = Math.max(
    space[10],
    Math.round(horizonY - TELESCOPE.horizonGap - barH - FLAG_ALLOWANCE),
  );
  // 파노라마 가로 스크롤을 UI 스레드에서 바다 그림 이동으로 잇는다(스크롤마다 JS 리렌더 없음). 동작 줄이기에서도 따라간다 —
  // 장식 모션이 아니라 사용자가 미는 스크롤 그 자체라서. 뗏목 고양이는 화면에 고정이라 내가 망원경을 돌리는 것처럼 보인다.
  const scrollX = useRef(new Animated.Value(0)).current;
  const panoramaScroll = useMemo(
    () => ({
      seaX: Animated.multiply(scrollX, -1),
      onScroll: Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], {
        useNativeDriver: true,
      }),
    }),
    [scrollX],
  );
  const [panoramaW, setPanoramaW] = useState(0);
  const sea = telescopeSeaTiles(sceneW, sceneH, panoramaW);
  // 파노라마가 사라지면(빈 목록·로딩·오류 카드) 바다를 처음 자리로 돌린다 — 다시 생긴 파노라마는 스크롤 0 에서 시작하는데
  // 바다만 옛 오프셋에 남으면 섬과 어긋나고 첫 드래그에 튄다. 사라질 때의 정리에서 맞추므로 새 ScrollView 가 붙기 전이다
  const panoramaShown = list.status === 'ready' && items.length > 0;
  useEffect(() => {
    if (!panoramaShown) return;
    return () => scrollX.setValue(0);
  }, [panoramaShown, scrollX]);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // 목록이 다시 읽히면 같은 섬의 최신 값으로 말풍선을 갱신한다. 목록에서 사라진 섬이면 말풍선도 닫힌다.
  const selected = items.find((item) => item.islandId === selectedId) ?? null;
  // 지금 구경(방문) 중인 섬 — 이 섬이 «항해 중인 섬»이다. [항해하기] 요청·연출 중에는 섬 칸이 막히고 연출이 화면을 덮어
  // 말풍선이 열리지 않으므로 따로 보지 않는다.
  const voyagingId = serverVisit(s)?.island.id;
  const popupOpen = !!selected || !!preparing;
  // 말풍선이 열려 있으면 뒤로가기는 말풍선만 닫는다. 항해 중 뒤로가기 삼킴(useIslandSailing)과 겹치지 않게
  // 항해·이동을 시작할 때 말풍선을 먼저 닫고, 요청 중에는 섬이 눌리지 않아 말풍선이 열리지 않는다.
  // 정리는 «내 함수가 아직 걸려 있을 때만» 지운다 — 남이 갈아 끼운 삼킴을 지우지 않는다.
  useEffect(() => {
    if (!popupOpen || !e.backOverride) return;
    const closePopup = () => {
      // 항해 시작 요청 중에는 시트를 닫지 않고 삼킨다
      if (startingRef.current) return true;
      setSelectedId(null);
      setPreparing(null);
      return true;
    };
    e.backOverride.current = closePopup;
    return () => {
      if (e.backOverride.current === closePopup) e.backOverride.current = null;
    };
  }, [popupOpen, e.backOverride]);

  // [항해하기] = 바다 항해 집중(GROMO-2310). 섬 구경(arrive·visit)으로 들어가지 않는다 — 섬에는 항해를 마치고 내린다.
  const voyage = (item: TelescopeItem) => {
    // 집중·휴식 중에는 새 항해를 시작할 수 없다 — ServerVisit 의 [섬 둘러보기]와 같은 안내.
    if (s.session) return e.notify(t('islandVisit.sessionBlocksBrowse'));
    setSelectedId(null);
    if (firstVoyage.eligible) {
      void firstVoyage.start(item);
      return;
    }
    const prepare = () => {
      setStartError(undefined);
      setPreparing(item);
    };
    if (e.beforeSeaVoyage) e.beforeSeaVoyage(prepare);
    else prepare();
  };

  // 시작 API 는 한마디를 받지 않는다 — 출항이 성공한 뒤에 한마디를 따로 저장하고, 한마디가 실패해도 출항은 유지한다.
  const startVoyage = async (item: TelescopeItem, remark: string) => {
    if (startingRef.current) return;
    startingRef.current = true;
    setStarting(true);
    setStartError(undefined);
    const gen = sessionGeneration();
    const alive = () => mounted.current && sessionGeneration() === gen;
    // 잠금은 실패 분기에서만 먼저 푼다 — 성공하면 한마디 저장·화면 전환까지 시트의 시작·닫기·뒤로가기를 막는다(중복 시작 방지)
    const unlock = () => {
      startingRef.current = false;
      if (mounted.current) setStarting(false);
    };
    // 진행 세션 화면으로 — 출항 성공·재시도 복원·충돌 복구가 같이 쓴다
    const enter = (route: Route, name?: string) => {
      setPreparing(null);
      e.reset(route, name);
    };
    // 개발용 권한 미리보기는 서버 명령 없이 로컬 항해로 이어진다.
    if (e.focusBlockingIntroPreview && !e.focus) {
      const now = Date.now();
      e.dispatch({
        type: 'SESSION_SYNC',
        session: {
          id: uuid(),
          islandId: item.islandId,
          destinationIslandName: item.name,
          kind: 'sea',
          subject: remark,
          startedAt: now,
          syncedAt: now,
          seconds: 0,
          status: 'active',
          targetMinutes: item.sailingMinutes,
        },
      });
      enter('sea', item.name);
      unlock();
      return;
    }
    let view: Awaited<ReturnType<typeof e.focus.startSea>>;
    try {
      view = await e.focus.startSea(item.islandId);
    } catch (thrown) {
      unlock();
      if (!alive()) return;
      // 망원경 시간대가 바뀌어 목적지가 빠졌다(명령 계층이 목록을 다시 읽고도 없었다) — 안내하고 새 목록으로
      if ((thrown as { code?: string })?.code === 'SEA_DESTINATION_UNAVAILABLE') {
        setPreparing(null);
        e.notify(t('telescope.destinationGone'));
        list.reload();
        return;
      }
      // 다른 기기가 먼저 출항·집중을 시작했다 — 다시 눌러도 계속 충돌하므로 정본을 읽어 그 진행 세션 화면으로 간다
      if ((thrown as { code?: string })?.code === 'STATE_CONFLICT') {
        const route = await e.focus.recover().catch(() => null);
        if (!alive()) return;
        if (route === 'sea' || route === 'focus' || route === 'rest') return enter(route);
      }
      setStartError(errorTextOr(thrown, 'telescope.sailFailed'));
      return;
    }
    // 응답 유실 재시도면 명령 계층이 돌려준 것은 current 정본이다 — 그사이 다른 기기가 항해를 끝내고 섬 집중을
    // 시작했으면 그 화면으로 간다(null = 진행 세션 없음 → 바다 표류 화면). 바다가 아니면 한마디도 저장하지 않는다.
    const route = view ? sessionRoute(view) : 'sea';
    try {
      if (remark && route === 'sea' && !previewItems)
        await saveSeaRemark(e, remark).catch(() => e.notify(t('openSea.remarkFailed')));
      if (!alive()) return;
      // 라우트 인자는 목적지 이름 — 서버가 세션에 이름을 싣기 전(T1)에도 항해 화면이 섬 이름을 쓴다
      enter(
        route,
        route === 'sea' && (!view || view.islandId === item.islandId) ? item.name : undefined,
      );
    } finally {
      unlock();
    }
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

  // 직접 넣은 섬을 뺀다. 성공하면 말풍선을 닫고 — 항해 중이던 섬이면 구경도 끝낸다(2259 「구경 끝내기」와 같은 종료).
  // 목록은 여기서 읽지 않는다: unpinFromTelescope 가 성공을 알리면 useTelescope 구독이 다시 읽고 서버가 빈 자리를 무작위 섬으로 채운다.
  // 요청 중 이 화면을 나갔다 다시 열어 «빼기 전» 목록을 받은 새 화면도 같은 알림으로 갱신된다(이 함수는 alive() 에서 일찍 끝난다).
  // 실패하면 말풍선을 둔 채 오류만 알린다.
  const unpin = async (item: TelescopeItem, endVisit: boolean) => {
    if (unpinningRef.current) return;
    unpinningRef.current = true;
    setUnpinning(true);
    const gen = sessionGeneration();
    const alive = () => mounted.current && sessionGeneration() === gen;
    try {
      await unpinFromTelescope(item.islandId);
    } catch (thrown) {
      const message = islandErrorMessage(thrown);
      if (message && alive()) e.notify(message);
      return;
    } finally {
      unpinningRef.current = false;
      if (mounted.current) setUnpinning(false);
    }
    if (!alive()) return;
    e.notify(t('telescope.unpinned'));
    setSelectedId(null);
    if (endVisit) endServerVisit(e);
  };

  const askUnpin = (item: TelescopeItem) => {
    if (item.islandId === voyagingId) {
      e.confirm(
        t('telescope.stopSailing.title'),
        t('telescope.stopSailing.body'),
        () => {
          // 핸들러는 Promise 를 돌려주지 않는다 — 확인창 닫기가 요청을 기다리지 않게
          unpin(item, true);
        },
        { ok: t('telescope.stopSailing.ok') },
      );
      return;
    }
    unpin(item, false);
  };

  if (firstVoyage.scene) return firstVoyage.scene;
  if (sail.sailing) return sail.sailing;

  return (
    <View
      testID="telescope"
      style={styles.root}
      onLayout={(ev) => {
        const { width, height } = ev.nativeEvent.layout;
        setScene({ width, height });
      }}
    >
      {/* 말풍선이 열려 있는 동안 뒤 화면은 스크린리더 탐색에서 숨긴다 */}
      <View
        style={StyleSheet.absoluteFill}
        accessibilityElementsHidden={popupOpen}
        importantForAccessibility={popupOpen ? 'no-hide-descendants' : 'auto'}
      >
        <Animated.View
          testID="telescope-sea"
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[
            styles.sea,
            {
              top: sea.top,
              left: sea.tiles[0].left,
              width: sea.tiles.length * sea.width,
              height: sea.height,
              transform: [{ translateX: panoramaScroll.seaX }],
            },
          ]}
        >
          {sea.tiles.map((tile) => (
            <Image
              key={tile.n}
              source={telescopeSea.source}
              style={[
                styles.seaTile,
                {
                  left: tile.left - sea.tiles[0].left,
                  width: sea.width,
                  height: sea.height,
                  transform: tile.mirror ? [{ scaleX: -1 }] : undefined,
                },
              ]}
            />
          ))}
        </Animated.View>
        {/* 가로 화면에서는 섬 띠 뒤에 깔려 가리므로 세로일 때만 둔다 */}
        {sceneW <= sceneH && (
          <View
            testID="telescope-raft"
            pointerEvents="none"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={[
              styles.raft,
              {
                right: L.insets.right + TELESCOPE.raft.right,
                bottom: L.insets.bottom + TELESCOPE.raft.bottom,
              },
            ]}
          >
            <Image source={raftTelescope[s.color]} resizeMode="contain" style={FILL} />
          </View>
        )}
        {/* 위 막대와 파노라마를 세로로 쌓는다 — 큰 글자·가로 화면에서도 겹치지 않고, 화면보다 길면 세로로 밀어 끝까지 닿는다 */}
        <ScrollView
          testID="telescope-scroll"
          alwaysBounceVertical={false}
          contentContainerStyle={{ paddingBottom: L.insets.bottom + space[4] }}
        >
          <View
            testID="telescope-top-bar"
            onLayout={(ev) => setTopBarHeight(ev.nativeEvent.layout.height)}
            style={[
              styles.topBar,
              {
                paddingTop: L.insets.top + space[2],
                paddingLeft: L.insets.left + semanticTokens.spacing.page,
                paddingRight: L.insets.right + semanticTokens.spacing.page,
              },
            ]}
          >
            {/* 뒤로는 건물 안과 같은 ‹ 동그라미(DESIGN §7.14) — 글자가 없어 큰 글자에서도 크기가 같다 */}
            <NavBtn label={t('telescope.back')} onPress={e.back} />
            {hasPendingRequest && (
              <Btn
                small
                kind="glass"
                dynamicHeight={largeText}
                title={t('telescope.pendingRequests')}
                disabled={list.status !== 'ready'}
                onPress={() => e.go('approval')}
              />
            )}
            {list.minutes !== null && (
              <View style={styles.chip}>
                <Badge>{t('telescope.nextIslands', { minutes: list.minutes })}</Badge>
              </View>
            )}
          </View>
          <View testID="telescope-band" style={{ marginTop: bandTop }}>
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
            ) : items.length === 0 ? (
              <Panel>
                <Txt style={styles.panelText}>{t('telescope.empty')}</Txt>
              </Panel>
            ) : (
              <Animated.ScrollView
                testID="telescope-panorama"
                horizontal
                showsHorizontalScrollIndicator={false}
                scrollEventThrottle={16}
                onScroll={panoramaScroll.onScroll}
                onContentSizeChange={(w) => setPanoramaW(w)}
                contentContainerStyle={{
                  ...(uninhabitedOnly ? { flexGrow: 1, justifyContent: 'center' } : {}),
                  paddingTop: FLAG_ALLOWANCE,
                  paddingLeft: L.insets.left + semanticTokens.spacing.page,
                  paddingRight: L.insets.right + semanticTokens.spacing.page,
                  gap: TELESCOPE.cellGap,
                }}
              >
                {items.map((item, index) => (
                  <IslandCell
                    key={item.islandId}
                    item={item}
                    index={index}
                    largeText={largeText}
                    disabled={sail.busy || firstVoyage.pending || firstVoyage.eligible === null}
                    hideTime={firstVoyage.eligible !== false}
                    onPress={() => setSelectedId(item.islandId)}
                  />
                ))}
              </Animated.ScrollView>
            )}
          </View>
        </ScrollView>
      </View>
      {selected && (
        <IslandBubble
          item={selected}
          firstVoyage={firstVoyage.eligible === true}
          // 서버 세션이 없는 목업(EXPO_PUBLIC_MAGAZINE_MOCK=telescope)은 보기만 — 행동 버튼은 실제 API 를 부르므로 막는다
          locked={
            (!e.islands && !previewItems && !e.focusBlockingIntroPreview) ||
            sail.pending ||
            joiningId !== null ||
            unpinning ||
            firstVoyage.pending ||
            firstVoyage.eligible === null
          }
          joining={joiningId === selected.islandId}
          voyaging={selected.islandId === voyagingId}
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
          onUnpin={() => {
            askUnpin(selected);
          }}
        />
      )}
      {preparing && (
        <SeaVoyagePreparation
          destinationName={preparing.name}
          pending={starting}
          error={startError}
          onStart={(remark) => {
            startVoyage(preparing, remark);
          }}
          onClose={() => setPreparing(null)}
        />
      )}
    </View>
  );
}
