import React, { useEffect, useState } from 'react';
import { Image } from 'react-native';
import { cat } from '@/constants/assets';
import metrics from '@/constants/motion-metrics.json';
import { Color } from '@/services/model';
export function catFrameBox(color: Color, motion: 'blink' | 'walking' | 'reading', size: number) {
  const m = metrics[color][motion],
    extent = size * m.scale;
  return {
    extent,
    x: (extent * m.footAnchor[0]) / 512,
    y: (extent * m.footAnchor[1]) / 512,
  };
}
export function CatSprite({
  color,
  motion = 'blink',
  size = 126,
  left = false,
  reduce = false,
  anchored = true,
}: {
  color: Color;
  motion?: 'blink' | 'walking' | 'reading';
  size?: number;
  left?: boolean;
  reduce?: boolean;
  anchored?: boolean;
}) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    setTick(0);
    if (reduce || motion === 'reading') return;
    const id = setInterval(() => setTick((v) => v + 1), motion === 'walking' ? 125 : 120);
    return () => clearInterval(id);
  }, [motion, reduce]);
  const m = metrics[color][motion],
    s = size * m.scale,
    frame = motion === 'walking' ? tick % 6 : [0, 1, 2, 1, 0][Math.max(0, (tick % 40) - 35)] || 0;
  const path = motion === 'reading' ? 'poses/reading' : `${motion}/${motion}-frame-${frame}`;
  return (
    <Image
      source={cat(color, path)}
      style={{
        position: 'absolute',
        width: s,
        height: s,
        left: anchored ? (-s * m.footAnchor[0]) / 512 : 0,
        top: anchored ? (-s * m.footAnchor[1]) / 512 : 0,
        transform: [{ scaleX: left ? -1 : 1 }],
      }}
      resizeMode="contain"
    />
  );
}
