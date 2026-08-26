// openInquiryChat — 링크 열기 성공/실패 계약(docs/prd/inquiry/low-level-design.md §8.2).
// `Linking`은 전역 목이 없어 `jest.spyOn`으로 갈아끼운다(components/DeepLinkGate.test.tsx와 같은 방식).
import { Linking } from 'react-native';
import { openInquiryChat } from './inquiryLink';

const CHAT_URL = 'https://open.kakao.com/o/gTestRoom';

beforeEach(() => {
  jest.restoreAllMocks();
});

describe('openInquiryChat', () => {
  // 성공 경로 — 넘긴 URL이 그대로 열려야 한다(가공하면 D7의 https 계약이 조용히 깨진다).
  test('openURL 성공 시 true를 돌려주고 받은 URL을 그대로 넘긴다', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);

    await expect(openInquiryChat(CHAT_URL)).resolves.toBe(true);
    expect(openURL).toHaveBeenCalledWith(CHAT_URL);
  });

  // 실패가 예외로 새면 화면이 그대로 죽는다 — 실패 모달(§6.1)이 유일한 수동 복구 경로라
  // 여기서 반드시 boolean으로 눌러 담아야 한다.
  test('openURL이 reject하면 false를 돌려주고 예외가 밖으로 새지 않는다', async () => {
    jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('no handler'));

    await expect(openInquiryChat(CHAT_URL)).resolves.toBe(false);
  });

  // 사전 검사 금지 규약을 잠근다 — iOS의 LSApplicationQueriesSchemes 화이트리스트 탓에
  // canOpenURL은 멀쩡한 링크에도 false를 뱉어, 넣는 순간 우리가 정상 링크를 스스로 막는다.
  test('canOpenURL을 호출하지 않는다', async () => {
    jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const canOpenURL = jest.spyOn(Linking, 'canOpenURL').mockResolvedValue(true);

    await openInquiryChat(CHAT_URL);

    expect(canOpenURL).not.toHaveBeenCalled();
  });
});
