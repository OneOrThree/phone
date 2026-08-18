// 오픈채팅 링크 열기(docs/prd/inquiry/low-level-design.md §2).
// 부수효과를 화면에서 떼어 내 테스트 가능하게 만든다 — 성공/실패만 돌려주고 UI는 건드리지 않는다.
import { Linking } from 'react-native';

/**
 * 오픈채팅 URL을 연다. 성공하면 true, 열지 못하면 false.
 *
 * ⚠️ `Linking.canOpenURL`로 사전 검사하지 않는다 — iOS에서는 `Info.plist`의
 *    `LSApplicationQueriesSchemes` 화이트리스트에 걸려 **멀쩡한 링크에도 false**를 뱉는다.
 *    그러면 우리가 정상 링크를 스스로 막게 된다. 곧장 열고 예외를 잡는다.
 *    (링크는 https라 카카오톡이 없어도 브라우저로 열린다 — policy.md D7)
 */
export async function openInquiryChat(url: string): Promise<boolean> {
  try {
    await Linking.openURL(url);
    return true;
  } catch {
    // 실패 처리는 호출부(확인 모달)의 몫이다 — 여기서 Alert을 띄우지 않는다.
    return false;
  }
}
