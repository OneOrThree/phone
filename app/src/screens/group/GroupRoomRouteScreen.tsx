import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { T } from '@/constants/theme';
import type { V2RootStackParamList } from '@/navigation/types';
import GroupRoomScreen from './GroupRoomScreen';

// 그룹방 라우트 래퍼 (root stack 'GroupRoom') — 명세 docs/app/group-plan-2.md §0-2.
//
// 그룹방 본체는 라우트가 아니라 컴포넌트다. 그룹이 1개인 사용자는 지금까지처럼 탭 안에서
// 내장 렌더로 보고(GroupScreen), 목록에서 고른 경우에만 이 래퍼를 통해 push 된다.
// 그래서 여기가 하는 일은 라우트 파라미터 → props 변환뿐이다 — 로직을 여기에 넣지 않는다.
//
// · summary 미전달  : 목록에서 진입해도 상세 도착 전 헤더용 요약을 스택에 실어 나르지 않는다
//                     (직렬화되는 라우트 파라미터를 얇게 유지 — groupId 하나면 복원이 끝난다).
// · onShowGroups 미전달 : 이미 목록에서 들어온 화면이라 ⋯ 메뉴의 '내 그룹 목록'을 숨긴다(§0-3).
// · onLeft = goBack : 나가기에 성공하면 목록으로 되돌아간다. 목록은 GroupScreen이 포커스
//                     재조회로 갱신하므로 여기서 따로 알릴 필요가 없다.

type GroupRoomRoute = RouteProp<V2RootStackParamList, 'GroupRoom'>;

export default function GroupRoomRouteScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<V2RootStackParamList>>();
  const { params } = useRoute<GroupRoomRoute>();

  return (
    <SafeAreaView style={s.root} edges={['top']} testID="group.room.route">
      <GroupRoomScreen groupId={params.groupId} onLeft={() => navigation.goBack()} />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  // 배경은 탭 내장 렌더(GroupScreen)와 같은 흰 캔버스 — 같은 화면이 진입 경로에 따라 달라 보이지 않게.
  root: { flex: 1, backgroundColor: T.paperLight },
});
