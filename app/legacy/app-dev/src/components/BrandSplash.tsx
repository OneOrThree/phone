import { View, Text, Image, StyleSheet } from 'react-native';
import { T } from '@/constants/theme';

// 앱 진입 스플래시 공통 비주얼 — 캐릭터(character_hi)를 가운데, 아래 GROMO 워드마크(GROMO-1029).
// OTA 준비 화면과 프로필 대기(loading) 화면이 같은 화면을 쓰도록 표현만 담은 컴포넌트.
// caption을 주면 워드마크 아래 한 줄 응원 문구를 표시한다(OTA는 퍼센트, 프로필 대기는 고정 문구).
export default function BrandSplash({ caption }: { caption?: string }) {
  return (
    <View style={s.root}>
      <Image source={require('@/assets/character_hi.png')} style={s.char} resizeMode="contain" />
      <Text style={s.brand}>GROMO</Text>
      {caption ? <Text style={s.caption}>{caption}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: T.paper },
  char: { width: 220, height: 220 },
  brand: { ...T.text.display, color: T.ink, letterSpacing: 4, marginTop: T.space.sm },
  caption: { marginTop: T.space.lg, fontSize: 14, color: T.inkSub },
});
