import { useCallback } from 'react';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import CharacterCreateScreen from '@/screens/character/CharacterCreateScreen';
import { useCharacter } from '@/store/CharacterContext';
import type { V2RootStackParamList } from '@/navigation/types';

// '사진에서 캐릭터 만들기' 라우트 래퍼 — 생성 화면(CharacterCreateScreen)과 CharacterContext를
// 잇는 얇은 스크린. 생성이 끝나면 저장 경로를 커스텀 캐릭터로 등록하고 이전 화면으로 돌아간다.
export default function CharacterCreateRoute() {
  const navigation = useNavigation<NativeStackNavigationProp<V2RootStackParamList>>();
  const { setCustomUri } = useCharacter();

  const handleComplete = useCallback(
    (uri: string) => {
      // 저장 경로는 고정 파일(customCharacter.png)을 매번 덮어써서, 그대로 두면 RN <Image>가
      // URI를 캐시 키로 잡아 옛 이미지가 남는다. 캐시버스트 쿼리를 붙여 매 저장마다 키를 바꾼다
      // (iOS file:// 로더는 쿼리를 캐시 키엔 반영하고 파일 경로 해석 시엔 무시한다).
      // 장착(setChoice)은 여기서 하지 않는다 — 나중 캐릭터 선택 화면에서 명시적으로 고른다.
      setCustomUri(`${uri}?t=${Date.now()}`);
      navigation.goBack();
    },
    [setCustomUri, navigation],
  );

  return <CharacterCreateScreen onComplete={handleComplete} />;
}
