import { Text } from '@/design-system/typography';
import React, { useRef, useState } from 'react';
import { View, Pressable, Animated } from 'react-native';
import { Island } from '@/services/model';
import { IslandPreview } from '@/screens/cosmetics/Cosmetics';
import { C, H, T, Button, Avatar } from '@/design-system/primitives';

export function IslandDiscovery({
  islands,
  onJoin,
  reduce,
}: {
  islands: Island[];
  onJoin: (island: Island) => void;
  reduce: boolean;
}) {
  const [order] = useState(() => {
    const ids = islands.map((i) => i.id);
    for (let n = ids.length - 1; n > 0; n--) {
      const j = Math.floor(Math.random() * (n + 1));
      [ids[n], ids[j]] = [ids[j], ids[n]];
    }
    return ids;
  });
  const [index, setIndex] = useState(0);
  const alpha = useRef(new Animated.Value(1)).current;
  const candidates = order
    .map((id) => islands.find((i) => i.id === id))
    .filter(Boolean) as Island[];
  const island = candidates[index % candidates.length];
  const next = () => {
    if (reduce) {
      setIndex((n) => n + 1);
      return;
    }
    Animated.timing(alpha, {
      toValue: 0.3,
      duration: 100,
      useNativeDriver: true,
    }).start(() => {
      setIndex((n) => n + 1);
      Animated.timing(alpha, {
        toValue: 1,
        duration: 180,
        useNativeDriver: true,
      }).start();
    });
  };
  return (
    <View style={{ gap: 20 }}>
      {island ? (
        <>
          <Animated.View style={{ opacity: alpha, gap: 16 }}>
            <IslandPreview height={300} island={island} />
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 14,
              }}
            >
              <View style={{ flex: 1, gap: 5 }}>
                <H large>{island.name}</H>
                <T>{island.intro}</T>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="다른 섬 찾기"
                accessibilityState={{ disabled: candidates.length < 2 }}
                disabled={candidates.length < 2}
                onPress={next}
                style={({ pressed }) => ({
                  width: 54,
                  height: 54,
                  borderRadius: 27,
                  borderWidth: 1.5,
                  borderColor: C.brown,
                  backgroundColor: C.butter,
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: candidates.length < 2 ? 0.35 : pressed ? 0.7 : 1,
                })}
              >
                <Text style={{ fontSize: 28, color: C.ink }}>→</Text>
              </Pressable>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              {island.members.slice(0, 4).map((m) => (
                <Avatar key={m.id} color={m.color} size={38} />
              ))}
              <T small>
                {island.members.length}명 · {island.approval ? '가입 승인 필요' : '바로 참여'}
              </T>
            </View>
          </Animated.View>
          <Button fill title="참여하기" onPress={() => onJoin(island)} />
        </>
      ) : (
        <T>지금 참여할 수 있는 공개 섬이 없어요.</T>
      )}
    </View>
  );
}
