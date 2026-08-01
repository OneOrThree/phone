// DeepLinkGate — 딥링크 수신 배선 테스트(docs/app/group-plan.md §6-6).
// 이 컴포넌트의 존재 이유가 '어디서·몇 번 구독하는가'라서, 그 두 가지를 여기서 잠근다:
//   1) getInitialURL()은 프로세스당 1회만 소비한다(재마운트로 이미 닫은 초대가 되살아나지 않게).
//   2) 실행 중 도착한 'url' 이벤트를 넘기고, 언마운트에서 구독을 푼다.
// ⚠️ 소비 여부는 모듈 스코프 플래그라 **파일 전체에서 1회성**이다 — 아래 테스트는 순서에 의존한다
//    (첫 테스트가 콜드 스타트를 소비하고, 두 번째가 '재마운트해도 다시 열리지 않음'을 본다).
import { act, render } from '@testing-library/react-native';
import { Linking } from 'react-native';
import { DeepLinkGate } from './DeepLinkGate';
import { navigateToDeepLink } from '@/navigation/navigationRef';

jest.mock('@/navigation/navigationRef', () => ({ navigateToDeepLink: jest.fn() }));

const LINK = 'gromo://join?g=0197e0c3-4d1b-7a2e-9f60-3b7c1f2a8d55';
const mockNavigate = navigateToDeepLink as jest.MockedFunction<typeof navigateToDeepLink>;
const remove = jest.fn();

async function renderGate() {
  const result = await render(<DeepLinkGate />);
  await act(async () => {});
  return result;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Linking, 'getInitialURL').mockResolvedValue(LINK);
  jest
    .spyOn(Linking, 'addEventListener')
    .mockReturnValue({ remove } as unknown as ReturnType<typeof Linking.addEventListener>);
});

test('콜드 스타트 초기 URL을 딥링크로 넘긴다', async () => {
  await renderGate();

  expect(mockNavigate).toHaveBeenCalledWith(LINK);
});

// 계정 전환·재로그인으로 트리가 리마운트돼도 네이티브는 같은 초기 URL을 계속 돌려준다 —
// 매번 소비하면 사용자가 닫은 초대가 프로세스 내내 다시 열린다
// (푸시의 initialNotificationHandled와 같은 방어 — services/push.ts).
test('리마운트해도 초기 URL을 다시 소비하지 않는다', async () => {
  await renderGate();

  expect(Linking.getInitialURL).not.toHaveBeenCalled();
  expect(mockNavigate).not.toHaveBeenCalled();
});

test('실행 중 도착한 url 이벤트를 넘기고, 언마운트에서 구독을 푼다', async () => {
  const { unmount } = await renderGate();

  const handler = (Linking.addEventListener as jest.Mock).mock.calls[0][1] as (e: {
    url: string;
  }) => void;
  await act(async () => {
    handler({ url: LINK });
  });
  expect(mockNavigate).toHaveBeenCalledWith(LINK);

  await act(async () => {
    unmount();
  });
  expect(remove).toHaveBeenCalled();
});
