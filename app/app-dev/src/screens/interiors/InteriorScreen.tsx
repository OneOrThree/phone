import { t } from '@/i18n';
import { NavBtn } from '@/design-system/patterns';
import { useAssetPack } from '@/hooks/useAssetPack';
import type { ScreenEnvironment } from '@/navigation/ScreenEnvironment';
import { GOWUN } from '@/screens/island/sceneKit';
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Image, Platform, View } from 'react-native';
import { artifacts } from './artifactRegistry';
import { artSize, interiorArt, kindCopy } from './assets';
import { setBoardBackgroundInert } from './board/modalFocus';
import { buildings } from './catalog';
import { NavScale } from './shared/NavScale';
import { Hotspot, Toast, hotspotAt } from './shared/SceneControls';
import { ease } from './shared/motion';
import { boardScene, interiorScene } from './shared/sceneGeometry';
import {
  BODY_FONT,
  INK,
  MAIL_LAND,
  assetUri,
  exact,
  fill,
  gradient,
  lh,
  textShadow,
  webOnly,
} from './shared/styles';
import { Text } from './shared/typography';

export function InteriorScreen({
  buildingIndex,
  conceptIndex,
  width,
  height,
  reduceMotion = false,
  hideArtifact = false,
  e,
  insets,
  sceneHeight = height,
  higherModalOpen = false,
}: {
  buildingIndex: number;
  conceptIndex: number;
  width: number;
  height: number;
  reduceMotion?: boolean;
  hideArtifact?: boolean;
  e?: ScreenEnvironment;
  insets?: { top: number; left: number; right?: number };
  sceneHeight?: number;
  higherModalOpen?: boolean;
}) {
  const building = buildings[buildingIndex],
    concept = building.concepts[conceptIndex];
  const [toast, setToast] = useState({ message: '', serial: 0 });
  const showToast = (message: string) => setToast((prev) => ({ message, serial: prev.serial + 1 }));
  // 핫스팟을 누르면 .artifact-wrap.peek: 기능 화면을 아래로 88% 내리고 흐리게 (transition .3s ease)
  const [peek, setPeek] = useState(false);
  const [boardModalOpen, setBoardModalOpen] = useState(false);
  const sceneBackRef = useRef<HTMLElement | null>(null);
  const peekAnim = useRef(new Animated.Value(0)).current;
  const [wrapHeight, setWrapHeight] = useState(0);
  useEffect(() => {
    if (Platform.OS === 'web') return;
    Animated.timing(peekAnim, {
      toValue: peek ? 1 : 0,
      duration: reduceMotion ? 0 : 300,
      easing: ease,
      useNativeDriver: true,
    }).start();
  }, [peek, reduceMotion, peekAnim]);
  const peekStyle =
    Platform.OS === 'web'
      ? [
          peek && { transform: [{ translateY: '88%' }], opacity: 0.75 },
          !reduceMotion &&
            webOnly({
              transitionProperty: 'transform, opacity',
              transitionDuration: '0.3s',
              transitionTimingFunction: 'ease',
            }),
        ]
      : {
          opacity: peekAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 0.75] }),
          transform: [
            {
              translateY: peekAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [0, wrapHeight * 0.88],
              }),
            },
          ],
        };
  const isHall = building.id === 'hall';
  const hallPack = useAssetPack(isHall ? 'interior-hall' : null);
  const sceneBackground =
    isHall && hallPack.lease?.assets.background
      ? { uri: hallPack.lease.assets.background.uri }
      : building.background;
  // 핫스폿은 시안 구경용이라 앱 화면에서는 끈다
  const hotspot = e || building.id === 'board' ? undefined : hotspotAt[concept.kind];
  const Artifact = artifacts[concept.kind];
  const modeLabel =
    isHall || building.id === 'board' || building.id === 'mail'
      ? ''
      : t('ui.misc.conceptPosition', {
          v0: String.fromCharCode(65 + conceptIndex),
          v1: kindCopy[concept.kind],
        });
  // 가로 우체통은 편지·채팅 종이를 오른쪽 열(폭 500)에 둔다
  const side = building.id === 'mail' && width > sceneHeight ? MAIL_LAND : { left: 14, right: 14 };
  const wrap =
    concept.position === 'scene'
      ? fill
      : concept.position === 'bottom'
        ? { ...side, bottom: building.id === 'mail' ? 8 : 22 }
        : building.id === 'mail'
          ? // 가운데에 두되, 화면보다 긴 편지는 위 12에 붙이고 아래로 넘친다
            wrapHeight
            ? { ...side, top: Math.max(12, (height - wrapHeight) / 2) }
            : { ...side, top: '50%' as const, transform: [{ translateY: '-50%' }] }
          : { left: 14, right: 14, top: '23%' as const };
  const screenGradient =
    'linear-gradient(180deg,#37271d12 0%,transparent 24%,transparent 70%,#37271d0c 100%)';
  // 게시판 가로 배경은 스크롤 장면 안에서 라벨과 함께 이동한다.
  const coverScene = building.id === 'board' || building.id === 'mail';
  const fullBoardScene = building.id === 'board';
  const showBoardReviewBackground = fullBoardScene && hideArtifact;
  const boardScrollScene =
    fullBoardScene && width / sceneHeight > artSize.background[0] / artSize.background[1];
  const bg = fullBoardScene
    ? boardScene(width, sceneHeight)
    : coverScene
      ? interiorScene(width, sceneHeight)
      : {
          left: (width - (height * artSize.background[0]) / artSize.background[1]) / 2,
          top: 0,
          width: (height * artSize.background[0]) / artSize.background[1],
          height,
        };
  const boardScrollOffset = boardScrollScene ? Math.max(0, bg.height - height) * 0.38 : 0;
  // 앱에서는 가짜 상태 표시줄을 빼고, 안전 영역보다 너무 위로 올라가지 않게 뒤로 가기·간판을 내린다
  const chromeTop = Math.max(0, (insets?.top ?? 0) - 52);
  const sceneBackBlocked = building.id === 'board' && (boardModalOpen || higherModalOpen);
  const navScale = React.useContext(NavScale);

  useEffect(() => {
    if (Platform.OS === 'web') setBoardBackgroundInert(sceneBackRef.current, sceneBackBlocked);
  }, [sceneBackBlocked]);

  return (
    <View
      testID="interiors-screen"
      style={[
        { width, height, overflow: 'hidden' },
        // 웹은 원본과 같은 CSS 배경으로 깔아야 그림 확대 결과가 픽셀까지 같다
        webOnly({
          backgroundImage: fullBoardScene
            ? showBoardReviewBackground
              ? `${screenGradient},url("${assetUri(interiorArt.boardBackground)}")`
              : screenGradient
            : `${screenGradient},url("${assetUri(sceneBackground)}")`,
          ...(fullBoardScene ? { backgroundRepeat: 'no-repeat' } : null),
          // 키보드로 높이가 줄면 창 높이로 계산한 위치에 그대로 둔다
          backgroundSize:
            sceneHeight !== height || fullBoardScene
              ? `100% 100%,${bg.width}px ${bg.height}px`
              : coverScene
                ? 'cover'
                : 'auto 100%',
          backgroundPosition: fullBoardScene
            ? `0 0,${bg.left}px ${bg.top - boardScrollOffset}px`
            : sceneHeight !== height
              ? `0 0,${bg.left}px ${bg.top}px`
              : coverScene
                ? 'center 38%'
                : ['hall', 'observatory'].includes(building.id)
                  ? 'center top'
                  : 'center',
        }),
      ]}
    >
      {Platform.OS !== 'web' && (!boardScrollScene || showBoardReviewBackground) && (
        <>
          <Image
            testID="interior-background-image"
            source={showBoardReviewBackground ? interiorArt.boardBackground : sceneBackground}
            onError={isHall ? hallPack.onError : undefined}
            resizeMode="stretch"
            style={{ position: 'absolute', ...bg, top: bg.top - boardScrollOffset }}
          />
          <View
            testID="interior-background-gradient"
            style={[fill, { pointerEvents: 'none' }, gradient(screenGradient)]}
          />
        </>
      )}
      {building.id === 'mail' && (
        <View
          style={[
            fill,
            { zIndex: 1, pointerEvents: 'none' },
            gradient('linear-gradient(180deg,transparent 38%,#4d25142b 82%,#381c1452)'),
          ]}
        />
      )}
      {!e && (
        <View
          testID="status-bar"
          style={{
            position: 'absolute',
            zIndex: 12,
            left: 18,
            right: 18,
            top: 8,
            flexDirection: 'row',
            justifyContent: 'space-between',
          }}
        >
          <Text style={[statusText, { fontWeight: '900' }]}>9:41</Text>
          <Text style={statusText}>● ● ▰</Text>
        </View>
      )}
      <NavBtn
        testID="scene-back"
        // 게시판은 바탕(종이)이 복잡해 뒤로 원이 잘 안 보여서, X를 반투명 원 위에 올리고 오른쪽 위에 둔다.
        // 다른 건물은 그대로 왼쪽 위의 불투명 원·뒤로 화살표.
        close={fullBoardScene}
        scrim={fullBoardScene}
        ref={sceneBackRef as any}
        disabled={sceneBackBlocked}
        accessibilityElementsHidden={sceneBackBlocked}
        {...(sceneBackBlocked ? webOnly({ 'aria-hidden': true } as any) : null)}
        label={t('focusFlow.common.backToIsland')}
        onPress={() => (e ? e.home() : showToast(t('ui.misc.returnTransition')))}
        // 원(34)이 예전 자리(좌/우 14 · 위 36)에 오게 누르는 상자(44)를 5 당긴다. 자리는 화면 좌표로 정해
        // 장면을 키워 그리는 우체통(navScale = 1/k)도 모서리 기준으로 줄여 다른 건물과 같은 화면 자리에 둔다
        style={{
          position: 'absolute',
          zIndex: 12,
          ...(fullBoardScene
            ? {
                right: navScale * (9 + Math.max(0, (insets?.right ?? 0) / navScale - 52)),
                transformOrigin: 'right top',
              }
            : {
                left: navScale * (9 + Math.max(0, (insets?.left ?? 0) / navScale - 52)),
                transformOrigin: 'left top',
              }),
          top: navScale * (31 + Math.max(0, (insets?.top ?? 0) / navScale - 52)),
          transform: [{ scale: navScale }],
        }}
      />
      {/* 가로에서 키보드가 올라와 화면이 아주 낮아지면 간판이 입력 종이를 가리지 않게 뺀다 */}
      {height >= 260 && (
        <View
          testID="place-sign"
          style={[
            {
              position: 'absolute',
              zIndex: 9,
              left: '50%',
              top: 43 + chromeTop,
              minWidth: isHall ? 115 : 94,
              paddingTop: 5,
              paddingHorizontal: 14,
              paddingBottom: 6,
              transform: [{ translateX: '-50%' }, { rotate: '-1deg' }],
              borderWidth: 1.5,
              borderColor: '#65462f',
              borderTopLeftRadius: 6,
              borderTopRightRadius: 6,
              borderBottomLeftRadius: 9,
              borderBottomRightRadius: 9,
              boxShadow: '0 3px 0 #65462f',
              alignItems: 'center',
            },
            gradient('linear-gradient(90deg,#b87848,#d19b61,#b87848)'),
          ]}
        >
          <Text
            style={[
              {
                fontFamily: BODY_FONT,
                fontSize: isHall ? 16 : 12,
                lineHeight: lh((isHall ? 16 : 12) * 1.6),
                color: '#fff7e7',
                textAlign: 'center',
              },
              textShadow(0, 1, '#684a34'),
            ]}
          >
            {building.name}
          </Text>
        </View>
      )}
      {hotspot && (
        <Hotspot
          at={hotspot}
          label={t('ui.misc.inspectBuilding', { v0: kindCopy[concept.kind] })}
          reduceMotion={reduceMotion}
          onPress={() => {
            showToast(peek ? t('ui.misc.viewRoom') : t('ui.misc.viewObject'));
            setPeek(!peek);
          }}
        />
      )}
      {!hideArtifact &&
        (concept.kind === 'village-ledger' ||
          concept.kind === 'island-management' ||
          (building.id === 'mail' && conceptIndex >= 1)) && (
          <View
            style={[
              fill,
              { zIndex: 6, backgroundColor: exact('#4e3d2918') },
              webOnly({ backdropFilter: 'blur(2.5px)' }),
            ]}
          />
        )}
      {!hideArtifact && Artifact && (
        <Animated.View
          testID="artifact-wrap"
          onLayout={(event) => setWrapHeight(event.nativeEvent.layout.height)}
          style={[
            { position: 'absolute', zIndex: 7, ...wrap },
            hotspot ? (peekStyle as any) : undefined,
          ]}
        >
          <Artifact
            building={building}
            concept={concept}
            index={conceptIndex}
            width={width}
            height={height}
            reduceMotion={reduceMotion}
            showToast={showToast}
            e={e}
            sceneHeight={sceneHeight}
            higherModalOpen={higherModalOpen}
            onBoardModalChange={setBoardModalOpen}
          />
        </Animated.View>
      )}
      {/* 원본은 동작 줄이기에서 토스트 애니메이션이 꺼져 보이지 않는다 */}
      {!reduceMotion && toast.serial > 0 && <Toast message={toast.message} serial={toast.serial} />}
      {modeLabel !== '' && (
        <View
          testID="tap-label"
          style={{
            position: 'absolute',
            zIndex: 8,
            right: 13,
            top: 82,
            paddingVertical: 3,
            paddingHorizontal: 8,
            borderWidth: 1,
            borderColor: '#725947',
            borderRadius: 99,
            backgroundColor: exact('#fffaf1d9'),
          }}
        >
          <Text
            style={{
              fontFamily: BODY_FONT,
              fontSize: 7,
              lineHeight: lh(11.2),
              fontWeight: '800',
              color: INK,
            }}
          >
            {modeLabel}
          </Text>
        </View>
      )}
      <View
        style={[
          fill,
          { zIndex: 0, pointerEvents: 'none' },
          gradient('linear-gradient(90deg,#39281b16,transparent 24%,transparent 76%,#39281b16)'),
        ]}
      />
    </View>
  );
}

const statusText = {
  fontFamily: GOWUN,
  fontSize: 9,
  lineHeight: 9,
  fontWeight: '800' as const,
  color: INK,
  ...textShadow(0, 1, '#fff8'),
};
