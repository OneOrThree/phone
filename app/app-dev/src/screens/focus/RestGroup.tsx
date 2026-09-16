import { Text } from '@/design-system/typography';
import React, { useRef, useState, useEffect } from 'react';
import { View, Image } from 'react-native';
import { useFonts } from 'expo-font';
import { State, currentIsland } from '@/services/model';
import { assets } from '@/constants/assets';
import { useAppLayout } from '@/utils/layout';
import { Btn } from '@/design-system/patterns';
import { Button, useScreenInsets } from '@/design-system/primitives';
import { clock } from '@/screens/focus/FocusSea';

// Same chair layers, reading atlas and per-user page-turn cycle as rest-group.html.
export function RestGroup({
  state,
  resume,
  home,
  endRest,
}: {
  state: State;
  resume: () => void;
  home: () => void;
  endRest?: () => void;
}) {
  const layout = useAppLayout();
  const [now, setNow] = useState(Date.now()),
    [size, setSize] = useState({ w: 402, h: 874 });
  const started = useRef(state.session?.restStartedAt || Date.now()).current;
  const insets = useScreenInsets();
  const [loaded] = useFonts({
    GromoSailing: require('@/assets/fonts/gowun-dodum.ttf'),
  });
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 125);
    return () => clearInterval(id);
  }, []);
  const actors = [
    { id: 'me', name: state.name, color: state.color, restStartedAt: started },
    ...currentIsland(state).members.filter((m) => !m.focusing && m.restStartedAt),
  ];
  const [page, setPage] = useState(0),
    pages = Math.max(1, Math.ceil(actors.length / 4));
  const sc = Math.min(size.w / 1024, size.h / 1800, 0.66),
    sprite = 315 * sc;
  return (
    <View
      testID="rest-group"
      style={{ flex: 1, overflow: 'hidden' }}
      onLayout={(e) =>
        setSize({
          w: e.nativeEvent.layout.width,
          h: e.nativeEvent.layout.height,
        })
      }
    >
      <Image
        source={assets['backgrounds/rest/day.png']}
        resizeMode="cover"
        style={{ position: 'absolute', width: '100%', height: '100%' }}
      />
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: insets.top + 14,
          left: 0,
          right: 0,
          alignItems: 'center',
        }}
      >
        <Text
          style={{
            fontFamily: loaded ? 'GromoSailing' : undefined,
            color: '#354b39',
            fontSize: 15,
            backgroundColor: '#FFFDFAE0',
            borderRadius: 999,
            paddingHorizontal: 16,
            paddingVertical: 6,
          }}
        >
          모닥불 · 잠깐의 쉼
        </Text>
      </View>
      {[0, 1, 2, 3].map((slot) => {
        const right = slot % 2 === 1,
          x = size.w * (layout.landscape ? [0.17, 0.39, 0.61, 0.83][slot] : right ? 0.755 : 0.252),
          y = size.h * (layout.landscape ? 0.64 : slot < 2 ? 0.37 : 0.77),
          a = actors[page * 4 + slot];
        const offset = Array.from(a?.id || '').reduce((n, c) => n + c.charCodeAt(0) * 37, 0) % 3700,
          t = (now + offset) % 5250;
        const frame =
          state.settings.reduceMotion || t < 4500 ? 0 : Math.min(5, Math.floor((t - 4500) / 125));
        return (
          <View key={slot} style={{ position: 'absolute', left: x, top: y }}>
            <View style={{ transform: [{ scaleX: right ? -1 : 1 }] }}>
              <Image
                source={assets['props/rest/reading-chair.png']}
                style={{
                  position: 'absolute',
                  width: sprite,
                  height: sprite,
                  left: -sprite / 2,
                  top: (-sprite * 480) / 512,
                }}
              />
              {a && (
                <View
                  testID={`reading-${a.id}`}
                  style={{
                    position: 'absolute',
                    width: sprite,
                    height: sprite,
                    left: -sprite / 2,
                    top: -61 * sc - (sprite * 464) / 512,
                    overflow: 'hidden',
                  }}
                >
                  <Image
                    source={assets[`characters/cat/${a.color}/reading/atlas.png`]}
                    style={{
                      position: 'absolute',
                      width: sprite * 6,
                      height: sprite,
                      left: -frame * sprite,
                      top: 0,
                    }}
                  />
                </View>
              )}
            </View>
            {a && (
              <>
                <View
                  style={{
                    position: 'absolute',
                    top: -sprite - 8,
                    left: -60,
                    width: 120,
                    alignItems: 'center',
                  }}
                >
                  <Text
                    style={{
                      fontSize: 11.5,
                      color: '#493B39',
                      backgroundColor: '#FFFDFAA6',
                      borderRadius: 999,
                      paddingHorizontal: 11,
                      paddingVertical: 4,
                    }}
                  >
                    {clock(Math.max(0, (now - (a.restStartedAt || started)) / 1000))}
                  </Text>
                </View>
                <View
                  style={{
                    position: 'absolute',
                    top: 14,
                    left: -60,
                    width: 120,
                    alignItems: 'center',
                  }}
                >
                  <Text
                    style={{
                      fontSize: 12,
                      fontWeight: '700',
                      color: '#493B39',
                      backgroundColor: '#FFFDFAA6',
                      borderRadius: 999,
                      paddingHorizontal: 11,
                      paddingVertical: 4,
                    }}
                  >
                    {a.name}
                  </Text>
                </View>
              </>
            )}
          </View>
        );
      })}
      <View
        style={{
          position: 'absolute',
          bottom: insets.bottom + 12,
          left: (size.w - layout.floatingWidth) / 2,
          width: layout.floatingWidth,
          gap: 10,
        }}
      >
        {pages > 1 && (
          <Button title="다음 자리" secondary onPress={() => setPage((page + 1) % pages)} />
        )}
        <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
          <Btn
            style={{ flex: 1 }}
            title={state.session ? '집중 이어가기' : '섬으로 돌아가기'}
            onPress={state.session ? resume : home}
          />
          {state.session && (
            <Btn style={{ flex: 1 }} title="휴식 종료하기" kind="glass" onPress={endRest || home} />
          )}
        </View>
      </View>
    </View>
  );
}
