// React Navigation 파라미터 타입 정의.
// ReactNavigation.RootParamList 전역 augmentation으로 useNavigation/useRoute가
// 모든 화면 이름과 파라미터를 인식하게 한다.
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { FocusResult, GroupMember } from './api';

// 그룹 상세 내부 탭 키
export type GroupTabKey = 'group' | 'challenge' | 'chat' | 'notice';

// 탭(+숨김 스택) 네비게이터 파라미터
export type TabParamList = {
  홈: { focusResult?: FocusResult } | undefined;
  그룹: undefined;
  상점: undefined;
  마이페이지: undefined;
  FocusCategoryScreen: undefined;
  FocusMode: { tagId?: string | null; tagName?: string; subject?: string };
  GroupDetail: { groupId: string; activeTab?: GroupTabKey };
};

// 루트 스택 네비게이터 파라미터
export type RootStackParamList = {
  Tabs: undefined;
  MemberCalendar: { member: GroupMember; groupId: string };
};

// 두 네비게이터를 합친 전역 파라미터 목록
export type AppParamList = RootStackParamList & TabParamList;

// 화면 컴포넌트 props 헬퍼
export type TabScreenProps<T extends keyof TabParamList> = BottomTabScreenProps<TabParamList, T>;
export type RootStackScreenProps<T extends keyof RootStackParamList> = NativeStackScreenProps<
  RootStackParamList,
  T
>;

declare global {
  namespace ReactNavigation {
    interface RootParamList extends AppParamList {}
  }
}
