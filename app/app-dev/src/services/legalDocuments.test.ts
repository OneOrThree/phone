import { Linking } from 'react-native';
import { openLegalDocument, PRIVACY_URL, TERMS_URL } from '@/services/legalDocuments';

test('약관과 개인정보 처리방침은 기존 공개 문서로 연다', async () => {
  const openUrl = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  try {
    await openLegalDocument('terms');
    await openLegalDocument('privacy');
    expect(openUrl.mock.calls).toEqual([[TERMS_URL], [PRIVACY_URL]]);
    expect(TERMS_URL).toBe('https://team-page.vercel.app/#/terms');
    expect(PRIVACY_URL).toBe('https://team-page.vercel.app/#/privacy');
  } finally {
    openUrl.mockRestore();
  }
});
