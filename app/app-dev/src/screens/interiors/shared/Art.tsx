import React from 'react';
import { Image, ImageSourcePropType, Platform, View } from 'react-native';
import { assetUri } from './styles';

// 원본 <img object-fit:contain>. CSS 배경은 축소 결과가 달라서 웹은 같은 <img>를 상자에 꽉 채운다
export function Art({ source, style }: { source: ImageSourcePropType; style: any }) {
  if (Platform.OS !== 'web') return <Image source={source} resizeMode="contain" style={style} />;
  return (
    <View style={style}>
      {React.createElement('img', {
        src: assetUri(source),
        alt: '',
        style: { display: 'block', width: '100%', height: '100%', objectFit: 'contain' },
      })}
    </View>
  );
}
