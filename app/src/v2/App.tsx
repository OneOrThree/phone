import { UserProvider } from '@/store/UserContext';
import { CoinProvider } from '@/store/CoinContext';
import { EquipmentProvider } from '@/store/EquipmentContext';
import { FocusProvider } from '@/store/FocusContext';
import { RootNavigator } from '@/v2/navigation/RootNavigator';

// v2 새 앱의 뿌리 — UI/화면/네비를 처음부터 새로 구성한다.
// 백엔드(back/)가 그대로라 데이터/로직 층(@/store, @/services, @/types, @/utils)은
// 기존 것을 그대로 공유한다(새로 짜지 않음).
// 기존 @/App · @/screens · @/navigation · @/components 는 수정·삭제 없이 "참고용"으로
// 보존한다(어디서도 import 하지 않음 → 새 앱은 기존 프레젠테이션을 0개 참조).
//
// TODO: 인증 게이팅(로딩/로그인/온보딩)·로그아웃/탈퇴 흐름을 v2 화면으로 재구현한다.
//       기존 @/App 의 흐름을 참고하되, 데이터 엔진(@/services, @/utils)은 그대로 재사용.
export default function App() {
  return (
    <UserProvider>
      <CoinProvider>
        <EquipmentProvider>
          <FocusProvider>
            <RootNavigator />
          </FocusProvider>
        </EquipmentProvider>
      </CoinProvider>
    </UserProvider>
  );
}
