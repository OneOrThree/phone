import { GOWUN } from '@/screens/island/sceneKit';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, Platform, Pressable, View, ViewStyle } from 'react-native';
import Svg, { Polygon } from 'react-native-svg';
import { interiorArt, kindCopy } from '../assets';
import { ease } from '../shared/motion';
import { BODY_FONT, INK, OUTLINE, assetUri, exact, gradient, lh, webOnly } from '../shared/styles';
import { Text } from '../shared/typography';
import { ArtifactProps, ArtifactRenderer } from '../types';

// ───────────── 상점·축음기 ─────────────

// 상점·축음기 기능 화면: tryon · counter · themes · records · player · catalog
// 원본 app.js artifactMarkup · handleChoice · data-control(play/stamp) 과 style.css 상점/축음기 규칙을 옮겼다.

const PINK = '#f4a7bb';

const SHOP_SKY = '#a9d9e7';

const controlCopy: Record<string, string> = {
  counter: '종 울려 구매하기',
  records: '바늘 내리기',
  player: '재생',
  catalog: '30초 미리듣기',
};

// .object-choice 기본값 위에 건물별 규칙 (.tryon-mirror/.record-player/.record-crate/.album-catalog .object-choice)
const choiceBox: Record<string, ViewStyle> = {
  tryon: { minHeight: 31 },
  player: { minHeight: 29, paddingTop: 4, paddingBottom: 4, paddingHorizontal: 4 },
  records: { minHeight: 69, paddingTop: 30, borderRadius: 4 },
  catalog: { minHeight: 76, paddingTop: 40 },
};

function ShopGramArtifact({ concept, reduceMotion, showToast }: ArtifactProps) {
  const kind = concept.kind;
  const [selected, setSelected] = useState(0);
  // 진열대 .stamped · 축음기 .is-playing (null = 아직 안 눌러서 처음 문구)
  const [on, setOn] = useState<boolean | null>(null);
  const react = useRef(new Animated.Value(0)).current;
  const spin = useRef(new Animated.Value(0)).current;
  const spinning = kind === 'player' && !!on && !reduceMotion;

  // .is-playing .vinyl { animation: spin 2.3s linear infinite }
  useEffect(() => {
    if (!spinning) return;
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 2300,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => {
      loop.stop();
      spin.setValue(0);
    };
  }, [spinning, spin]);

  const choose = (i: number) => {
    setSelected(i);
    // .artifact.reacting { animation: object-react .42s ease } · 45%에서 scale(1.025) rotate(-.5deg)
    if (!reduceMotion) {
      react.setValue(0);
      Animated.sequence([
        Animated.timing(react, { toValue: 1, duration: 189, easing: ease, useNativeDriver: false }),
        Animated.timing(react, { toValue: 0, duration: 231, easing: ease, useNativeDriver: false }),
      ]).start();
    }
    showToast(`${concept.items[i][0]} 선택`);
  };

  const toggle = () => {
    const next = !on;
    setOn(next);
    showToast(
      kind === 'counter'
        ? '종이에 도장을 꾹 찍었어요'
        : next
          ? '모닥불 주변에 음악이 흘러요'
          : '음악을 잠시 멈췄어요',
    );
  };

  const side = kind === 'tryon' || kind === 'player'; // grid 2단: 그림 | 글
  const center = kind === 'themes'; // .theme-dome { text-align:center }
  const color = kind === 'catalog' ? '#fffaf0' : INK; // .album-catalog { color:#fffaf0 } 는 태그·제목·버튼 글자까지 물려받는다
  const item = concept.items[selected];
  const control = controlCopy[kind];
  const controlLabel =
    on === null
      ? control
      : kind === 'counter'
        ? on
          ? '도장 완료 ✓'
          : '다시 확인'
        : on
          ? '잠시 멈추기'
          : '다시 재생';

  const looks: Record<string, ViewStyle> = {
    tryon: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      borderWidth: 7,
      borderColor: '#b57a46',
      borderTopLeftRadius: '45%',
      borderTopRightRadius: '45%',
      borderBottomLeftRadius: 14,
      borderBottomRightRadius: 14,
      backgroundColor: exact('#d8ebdcdd'),
      boxShadow: 'inset 0 0 0 3px #f0ca83,0 6px 14px #3b291c55',
    },
    counter: {
      borderTopLeftRadius: 60,
      borderTopRightRadius: 60,
      borderBottomLeftRadius: 10,
      borderBottomRightRadius: 10,
      backgroundColor: '#b97c49',
      boxShadow: 'inset 0 3px #e4b477,0 7px 14px #3b291c55',
    },
    themes: {
      borderWidth: 6,
      borderColor: '#b77949',
      borderTopLeftRadius: '50%',
      borderTopRightRadius: '50%',
      borderBottomLeftRadius: 14,
      borderBottomRightRadius: 14,
      backgroundColor: exact('#d8ebdcdd'),
    },
    records: {
      borderWidth: 6,
      borderRadius: 7,
      backgroundColor: '#ad7348',
      boxShadow: 'inset 0 0 0 2px #ddaa73,0 7px 14px #3b291c66',
    },
    player: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 9,
      borderRadius: 10,
      backgroundColor: '#9c6440',
      boxShadow: 'inset 0 0 0 4px #cd9160,0 7px 14px #3b291c66',
    },
    catalog: {
      borderRadius: 12,
      backgroundColor: '#6f4f3d',
      boxShadow: 'inset 0 0 0 4px #ad7954,0 7px 14px #3b291c66',
    },
  };

  const body = (
    <>
      {/* .artifact-tag: inline-block이라 부모 줄(15px/24px) 안에서 위로 7px 내려앉는다 */}
      <View
        style={{
          alignSelf: center ? 'center' : 'flex-start',
          marginVertical: 7,
          paddingVertical: 2,
          paddingHorizontal: 8,
          borderWidth: 1,
          borderColor: '#7f624f',
          borderRadius: 99,
          backgroundColor: '#fff8e9',
        }}
      >
        <Text
          style={{
            fontFamily: BODY_FONT,
            fontSize: 7,
            lineHeight: lh(7 * 1.6),
            fontWeight: '800',
            letterSpacing: 0.7,
            color,
          }}
        >
          {kindCopy[kind]}
        </Text>
      </View>
      <View style={{ gap: 1, marginBottom: 9 }}>
        <Text
          testID="selection-title"
          style={{
            fontFamily: GOWUN,
            fontSize: side ? 13 : 16,
            lineHeight: lh(side ? 13 * 1.25 : 16 * 1.25),
            color,
            textAlign: center ? 'center' : undefined,
          }}
        >
          {item[1]}
        </Text>
        <Text
          testID="selection-note"
          style={{
            fontFamily: BODY_FONT,
            fontSize: 8,
            lineHeight: lh(8 * 1.4),
            color: kind === 'catalog' ? '#e8d8c9' : '#79685d',
            textAlign: center ? 'center' : undefined,
          }}
        >
          {item[2]}
        </Text>
      </View>
      {kind === 'counter' && (
        // .product-stage (margin-top -5px는 위 margin 9px과 겹쳐 4px이 된다 · flex에서도 합이 같다)
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'flex-end',
            justifyContent: 'center',
            gap: 18,
            height: 54,
            marginTop: -5,
          }}
        >
          {['#f3d590', SHOP_SKY, '#edbcc5'].map((c, i) => (
            <View
              key={c}
              style={{
                width: 35,
                height: i === 1 ? 42 : 30,
                borderWidth: 2,
                borderColor: '#76543e',
                borderTopLeftRadius: '50%',
                borderTopRightRadius: '50%',
                borderBottomLeftRadius: 9,
                borderBottomRightRadius: 9,
                backgroundColor: c,
              }}
            />
          ))}
        </View>
      )}
      {kind === 'themes' && (
        // .glass-dome
        <View
          style={[
            {
              alignSelf: 'center',
              width: 112,
              height: 78,
              marginTop: -1,
              marginBottom: 8,
              borderWidth: 3,
              borderColor: exact('#eaf7eccc'),
              borderTopLeftRadius: 60,
              borderTopRightRadius: 60,
              borderBottomLeftRadius: 15,
              borderBottomRightRadius: 15,
              backgroundColor: exact('#9cd7df55'),
              boxShadow: 'inset 0 -9px #70b6c4',
            },
            gradient('linear-gradient(145deg,#fff8 0 12%,transparent 13%)'),
          ]}
        >
          <View
            style={{
              position: 'absolute',
              left: 23,
              right: 23,
              bottom: 10,
              height: 26,
              borderRadius: '50%',
              backgroundColor: '#85ad6f',
            }}
          />
          {Platform.OS === 'web' ? (
            <View
              style={[
                {
                  position: 'absolute',
                  left: 48,
                  bottom: 29,
                  width: 16,
                  height: 28,
                  backgroundColor: '#608e59',
                },
                webOnly({ clipPath: 'polygon(45% 0,70% 50%,100% 100%,0 100%,28% 50%)' }),
              ]}
            />
          ) : (
            <Svg width={16} height={28} style={{ position: 'absolute', left: 48, bottom: 29 }}>
              <Polygon points="7.2,0 11.2,14 16,28 0,28 4.48,14" fill="#608e59" />
            </Svg>
          )}
        </View>
      )}
      <View style={{ flexDirection: side ? 'column' : 'row', gap: 6 }}>
        {concept.items.map((choice, i) => (
          <Pressable
            key={choice[0]}
            testID={`choice-${i}`}
            accessibilityRole="button"
            accessibilityState={{ selected: i === selected }}
            onPress={() => choose(i)}
            style={[
              {
                flex: side ? undefined : 1,
                minHeight: 40,
                paddingTop: 7,
                paddingBottom: 7,
                paddingHorizontal: 3,
                justifyContent: 'center',
                borderWidth: 1.5,
                borderColor: OUTLINE,
                borderRadius: 8,
                boxShadow: `0 2px 0 ${OUTLINE}`,
              },
              choiceBox[kind],
              // 레코드 상자·음원 상자는 뒤에 오는 규칙이 눌림 분홍 배경을 덮는다
              {
                backgroundColor:
                  kind === 'records'
                    ? '#ead39f'
                    : kind === 'catalog'
                      ? ['#e6c58f', '#abcfc5', '#a9bedb'][i]
                      : i === selected
                        ? PINK
                        : '#fffaf0',
              },
              i === selected && { transform: [{ translateY: -3 }] },
            ]}
          >
            {(kind === 'records' || kind === 'catalog') && (
              // .object-choice::before 레코드판
              <View
                style={[
                  {
                    position: 'absolute',
                    left: '50%',
                    top: 7,
                    width: 30,
                    height: 30,
                    borderRadius: 15,
                    transform: [{ translateX: '-50%' }],
                  },
                  gradient(
                    `radial-gradient(circle,${kind === 'records' ? ['#e89c7d', '#9dcfbb', '#8fbad5'][i] : '#e89c7d'} 0 4px,#26211f 5px 14px,#4b443e 15px)`,
                  ),
                ]}
              />
            )}
            <Text
              style={{
                fontFamily: BODY_FONT,
                fontSize: 8,
                lineHeight: lh(8 * 1.25),
                fontWeight: '800',
                color: INK,
                textAlign: 'center',
              }}
            >
              {choice[0]}
            </Text>
            <View
              style={{
                alignSelf: 'center',
                width: 11,
                height: 3,
                marginTop: 4,
                borderRadius: 99,
                backgroundColor: exact('#7f624f55'),
              }}
            />
          </Pressable>
        ))}
      </View>
      {control && (
        <Pressable
          testID="artifact-control"
          accessibilityRole="button"
          onPress={toggle}
          style={{
            minHeight: 34,
            marginTop: 9,
            paddingVertical: 6,
            paddingHorizontal: 10,
            justifyContent: 'center',
            borderWidth: 1.5,
            borderColor: OUTLINE,
            borderRadius: 9,
            backgroundColor: on ? SHOP_SKY : PINK,
            boxShadow: `0 2px 0 ${OUTLINE}`,
          }}
        >
          <Text
            style={{
              fontFamily: BODY_FONT,
              fontSize: 9,
              lineHeight: lh(9 * 1.6),
              fontWeight: '800',
              color,
              textAlign: 'center',
            }}
          >
            {controlLabel}
          </Text>
        </Pressable>
      )}
    </>
  );

  return (
    <Animated.View
      testID="artifact"
      style={[
        { padding: 14, borderWidth: 1.5, borderColor: OUTLINE, boxShadow: '0 5px 12px #3e291d42' },
        looks[kind],
        !reduceMotion && {
          transform: [
            { scale: react.interpolate({ inputRange: [0, 1], outputRange: [1, 1.025] }) },
            { rotate: react.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-0.5deg'] }) },
          ],
        },
      ]}
    >
      {kind === 'tryon' &&
        (Platform.OS === 'web' ? (
          // 웹은 원본 <img>와 같은 결과가 나오게 CSS 배경으로 그린다
          <View
            accessibilityLabel="검은 고양이 미리보기"
            style={[
              { width: '35%', aspectRatio: 1 },
              webOnly({
                backgroundImage: `url("${assetUri(interiorArt.catBlack)}")`,
                backgroundSize: '100% 100%',
                filter: 'drop-shadow(0 5px 3px #51372b44)',
              }),
            ]}
          />
        ) : (
          <Image
            accessibilityLabel="검은 고양이 미리보기"
            source={interiorArt.catBlack}
            style={{ width: '35%', aspectRatio: 1 }}
          />
        ))}
      {kind === 'player' && (
        // .vinyl: 네이티브는 repeating-radial-gradient가 없어 단색으로 대신한다
        <Animated.View
          style={[
            { width: '42%', aspectRatio: 1, borderRadius: '50%', boxShadow: '0 4px 4px #34221866' },
            webOnly({
              backgroundImage: 'repeating-radial-gradient(circle,#24211f 0 3px,#3a3631 4px 6px)',
            }) ?? { backgroundColor: '#2f2b28' },
            spinning && {
              transform: [
                {
                  rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }),
                },
              ],
            },
          ]}
        >
          <View
            style={{
              position: 'absolute',
              left: '38%',
              right: '38%',
              top: '38%',
              bottom: '38%',
              borderRadius: '50%',
              backgroundColor: PINK,
            }}
          />
        </Animated.View>
      )}
      {side ? <View style={{ flex: 1 }}>{body}</View> : body}
    </Animated.View>
  );
}

export const shopGramArtifacts: Record<string, ArtifactRenderer> = {
  tryon: ShopGramArtifact,
  counter: ShopGramArtifact,
  themes: ShopGramArtifact,
  records: ShopGramArtifact,
  player: ShopGramArtifact,
  catalog: ShopGramArtifact,
};
