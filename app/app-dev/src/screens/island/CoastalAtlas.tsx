import React from 'react';
import {
  Atlas,
  Image,
  Mask,
  type SkImage,
  type SkRect,
  type SkRSXform,
} from '@shopify/react-native-skia';

/** Older cached atlases still contain water. Mask only their art, retaining that snapshot's nav/layout. */
export function CoastalAtlas({
  image,
  sprites,
  transforms,
  mask,
}: {
  image: SkImage;
  sprites: SkRect[];
  transforms: SkRSXform[];
  mask?: SkImage | null;
}) {
  const atlas = <Atlas image={image} sprites={sprites} transforms={transforms} />;
  return mask ? (
    <Mask
      mode="alpha"
      mask={<Image image={mask} x={0} y={0} width={1536} height={1024} fit="fill" />}
    >
      {atlas}
    </Mask>
  ) : (
    atlas
  );
}
