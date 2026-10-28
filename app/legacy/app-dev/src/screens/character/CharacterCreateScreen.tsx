import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import SettingsScaffold from '@/screens/settings/components/SettingsScaffold';
import CharacterCreator from '@/screens/character/CharacterCreator';
import { useUser } from '@/store/UserContext';
import { t } from '@/i18n';

// 사진에서 캐릭터 만들기 화면 — 설정 크롬(SettingsScaffold)으로 자립 생성기(CharacterCreator)를
// 감싼 얇은 래퍼다. 생성기가 저장을 끝내고 경로를 돌려주면, onComplete가 있으면 그쪽으로 넘기고
// (라우트 래퍼 CharacterCreateRoute가 CharacterContext에 반영) 없으면 이전 화면으로 돌아간다.

interface Props {
  // 저장 완료 시 만들어진 커스텀 캐릭터의 file:// 경로를 넘긴다.
  // 미지정이면(네비게이션으로 바로 열린 경우) 저장 후 이전 화면으로 돌아간다.
  onComplete?: (uri: string) => void;
}

export default function CharacterCreateScreen({ onComplete }: Props) {
  const navigation = useNavigation<NativeStackNavigationProp<never>>();
  // 이 화면은 로그인 후 메뉴에서 진입하므로 UserProvider 안 — userId를 안전하게 얻어
  // 생성기가 유저별 파일로 저장하게 넘긴다.
  const { userId } = useUser();

  return (
    <SettingsScaffold
      title={t('character.create.title')}
      onBack={() => navigation.goBack()}
      scroll={false}
    >
      <CharacterCreator
        userId={userId}
        entrySource="character_select"
        onSaved={(uri) => (onComplete ? onComplete(uri) : navigation.goBack())}
      />
    </SettingsScaffold>
  );
}
