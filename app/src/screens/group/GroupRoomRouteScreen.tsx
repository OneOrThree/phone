import { useCallback } from 'react';
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
// · onShowGroups 미전달 : 이미 목록에서 들어온 화면이라 ⋯ 메뉴의 '그룹 전환·추가'를 숨긴다(§0-3).
// · onLeft = goBack : 나가기에 성공하면 목록으로 되돌아간다. 목록은 GroupScreen이 포커스
//                     재조회로 갱신하므로 여기서 따로 알릴 필요가 없다.
// · onBack = goBack : 루트 스택이 headerShown:false이고 이 화면엔 탭바도 없다 —
//                     넘기지 않으면 목록으로 돌아갈 명시 경로가 0개가 된다.
//
// ⚠️ 두 콜백 모두 useCallback으로 고정한다. GroupRoomScreen의 load→reload→useFocusEffect가
//    이 신원에 매달려 있어, 인라인 함수를 넘기면 스택이 재렌더될 때마다 포커스 이펙트가
//    다시 돌아 상세·공지·챌린지 3콜이 한 세트씩 더 나간다.

type GroupRoomRoute = RouteProp<V2RootStackParamList, 'GroupRoom'>;

export default function GroupRoomRouteScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<V2RootStackParamList>>();
  const { params } = useRoute<GroupRoomRoute>();

  const goBack = useCallback(() => navigation.goBack(), [navigation]);

  return (
    <SafeAreaView style={s.root} edges={['top']} testID="group.room.route">
      <GroupRoomScreen groupId={params.groupId} onLeft={goBack} onBack={goBack} />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  // 배경은 탭 내장 렌더(GroupScreen)와 같은 흰 캔버스 — 같은 화면이 진입 경로에 따라 달라 보이지 않게.
  root: { flex: 1, backgroundColor: T.paperLight },
});
