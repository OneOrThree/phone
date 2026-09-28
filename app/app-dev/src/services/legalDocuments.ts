import { Alert, Linking } from 'react-native';

// GROMO-813에서 연결한 팀 공개 문서. 새 앱도 같은 공개 정본을 사용한다.
export const TERMS_URL = 'https://team-page.vercel.app/#/terms';
export const PRIVACY_URL = 'https://team-page.vercel.app/#/privacy';

export type LegalDocument = 'terms' | 'privacy';

export async function openLegalDocument(document: LegalDocument): Promise<void> {
  try {
    await Linking.openURL(document === 'terms' ? TERMS_URL : PRIVACY_URL);
  } catch {
    Alert.alert('문서를 열 수 없어요.', '잠시 후 다시 시도해 주세요.');
  }
}
