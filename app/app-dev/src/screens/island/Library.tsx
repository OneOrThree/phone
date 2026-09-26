import React from 'react';
import { Image, Platform, Pressable, View } from 'react-native';
import Svg, { Circle, Ellipse, G, Polygon } from 'react-native-svg';
import { art } from '@/design-system/patterns';
import { semanticTokens } from '@/design-system/tokens';
import { useAppLayout } from '@/utils/layout';
import { CatSprite } from '@/components/CatSprite';
import { State } from '@/services/model';
import { BROWN, T, fill, safeOffset, useGowun, web } from '@/screens/island/sceneKit';
import { Diary } from './library/Diary';

function Flower({ outline }: { outline: boolean }) {
  return (
    <Svg width={26} height={26} viewBox="-12 -12 24 24">
      <G
        fill={outline ? 'none' : '#fff5cf'}
        stroke={outline ? '#fff5cf' : undefined}
        strokeWidth={1.6}
      >
        {[0, 72, 144, 216, 288].map((r) => (
          <Ellipse key={r} rx={3.4} ry={6} cy={-5.4} rotation={r} />
        ))}
      </G>
      <Circle r={2.4} fill="#e8c46a" />
    </Svg>
  );
}
function Cover({ nb, x, y, w, h, land, font, onPress }: any) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={nb ? '이웃들의 일기장' : '내 일기장'}
      testID={nb ? 'diary-neighbors' : 'diary-mine'}
      onPress={onPress}
      style={[
        {
          position: 'absolute',
          left: x,
          top: y,
          width: w,
          height: h,
          // iOS는 perspective·rotateX 를 준 형제가 있으면 배경 Image 가 위로 올라와 닫기 버튼·책 제목을
          // 가린다(3D 합성). 네이티브는 원근 없이 같은 비율(cos 28° ≈ 0.88)로 납작하게만 줄인다
          transform:
            Platform.OS === 'web'
              ? [{ perspective: 650 }, { rotateX: '28deg' }, { rotateZ: nb ? '9deg' : '-10deg' }]
              : [{ scaleY: 0.88 }, { rotateZ: nb ? '9deg' : '-10deg' }],
        },
        web({ filter: 'drop-shadow(rgba(96, 67, 44, 0.44) 3px 9px 3px)' }),
      ]}
    >
      {/* 책 옆면 종이 겹 */}
      <View
        style={[
          {
            position: 'absolute',
            top: h * 0.03,
            right: -w * 0.05,
            bottom: -h * 0.01,
            left: w * 0.06,
            borderWidth: 2,
            borderColor: '#795d44',
            borderTopLeftRadius: 4,
            borderBottomLeftRadius: 4,
            borderTopRightRadius: 8,
            borderBottomRightRadius: 8,
            backgroundColor: '#f4e9cf',
          },
          web({
            backgroundImage:
              'repeating-linear-gradient(rgb(244, 233, 207) 0px, rgb(244, 233, 207) 3px, rgb(195, 164, 129) 4px, rgb(244, 233, 207) 5px)',
          }),
        ]}
      />
      <View
        style={{
          ...fill,
          alignItems: 'center',
          justifyContent: 'space-around',
          borderWidth: 2,
          borderColor: '#775342',
          borderTopLeftRadius: 5,
          borderBottomLeftRadius: 5,
          borderTopRightRadius: 10,
          borderBottomRightRadius: 10,
          backgroundColor: nb ? semanticTokens.color.secondary : semanticTokens.color.primary,
          boxShadow: nb
            ? 'inset 6px 0 0 rgb(115, 158, 174), inset 10px 0 0 rgba(255, 255, 255, 0.27)'
            : 'inset 6px 0 0 rgb(189, 121, 129), inset 10px 0 0 rgba(255, 255, 255, 0.208)',
          paddingTop: w * 0.13,
          paddingRight: w * 0.08,
          paddingBottom: w * 0.12,
          paddingLeft: w * 0.13,
        }}
      >
        <View
          style={{
            position: 'absolute',
            top: 7,
            right: 6,
            bottom: 7,
            left: 13,
            borderWidth: 1,
            borderColor: '#b8897e',
            borderRadius: 3,
          }}
        />
        <T
          style={{
            fontFamily: font,
            fontSize: nb ? (land ? 16 : 18) : land ? 20 : 22,
            lineHeight: (nb ? (land ? 16 : 18) : land ? 20 : 22) * 1.25,
            textAlign: 'center',
          }}
        >
          {nb ? '이웃들의\n일기장' : '내\n일기장'}
        </T>
        <View style={{ height: 30 }}>
          <Flower outline={nb} />
        </View>
        <T style={{ fontSize: 7, lineHeight: 10.15 }}>
          {nb ? '함께 자라는 이야기' : '나의 하루를 차곡차곡'}
        </T>
      </View>
      <Svg
        width={w * 0.13}
        height={h * 0.1}
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        style={{ position: 'absolute', top: h * 0.97, left: w * 0.7 }}
      >
        <Polygon points="0,0 100,0 100,100 50,75 0,100" fill="#ffe08a" />
      </Svg>
    </Pressable>
  );
}
function Round({ title, glyph, onPress, disabled, size, style, testID }: any) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled }}
      disabled={disabled}
      testID={testID}
      hitSlop={8}
      onPress={onPress}
      style={style}
    >
      <T style={{ fontSize: size, fontWeight: '800', lineHeight: size * 1.45 }}>{glyph}</T>
    </Pressable>
  );
}

export function shouldObserveLibraryIndicator(route: string) {
  // 도서관에서 일기장·통계 화면으로 이동해도 같은 건물 열람 흐름으로 취급한다.
  return route === 'library' || route === 'diary' || route === 'stats';
}

export function Library({ e }: any) {
  const font = useGowun();
  const L = useAppLayout(),
    off = safeOffset(L),
    land = L.landscape,
    W = L.width,
    H = L.height;
  if (e.route === 'library') {
    // 원형 테이블: 세로는 583px 폭 장면을 가운데에, 가로는 화면 폭 전체 기준
    const rw = land ? W : 583,
      rx = (W - rw) / 2,
      cw = rw * (land ? 0.135 : 0.23),
      ch = H * (land ? 0.34 : 0.18),
      cy = H * (land ? 0.53 : 0.47);
    return (
      <View style={{ flex: 1 }}>
        <Image source={art[land ? 'L/lib/room' : 'lib/room']} style={fill} resizeMode="cover" />
        <View
          pointerEvents="none"
          testID="library-reading-cat"
          style={{
            position: 'absolute',
            left: rx + rw * (land ? 0.72 : 0.65),
            top: cy - (land ? 40 : 55),
            zIndex: 5,
          }}
        >
          <CatSprite
            color={(e.state as State).color}
            motion="read"
            size={land ? 95 : 85}
            reduce={(e.state as State).settings.reduceMotion}
          />
        </View>
        {[false, true].map((nb) => (
          <Cover
            key={String(nb)}
            nb={nb}
            land={land}
            font={font}
            x={rx + rw * (nb ? (land ? 0.525 : 0.52) : land ? 0.34 : 0.25)}
            y={cy}
            w={cw}
            h={ch}
            onPress={() => e.go('diary', nb ? 'residents' : '')}
          />
        ))}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="닫기"
          onPress={e.home}
          style={{
            position: 'absolute',
            right: (land ? 56 : 16) + off.right,
            top: (land ? 14 : 62) + off.top,
            width: 42,
            height: 42,
            borderRadius: 21,
            borderWidth: 2,
            borderColor: BROWN,
            backgroundColor: '#fff7eb',
            boxShadow: `0px 3px 0px ${BROWN}`,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <T style={{ fontSize: 24, fontWeight: '800', lineHeight: 34.8 }}>×</T>
        </Pressable>
      </View>
    );
  }
  return <Diary e={e} font={font} />;
}
