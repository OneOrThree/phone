import { Badge, Pic, Txt } from '@/design-system/patterns';
import { Cta, IslandSheet, Preview, st } from '@/screens/island/IslandSheet';
import { hoursMinutes, isFull, islandWeeklyAverage, residentCount } from '@/services/model';
import { View } from 'react-native';
import { AvStack } from './navigation/screenParts';
import type { ScreenContext } from './navigation/useScreenState';

export function renderVisitScreens(context: ScreenContext) {
  const {
    route,
    state,
    detail,
    visited,
    notify,
    act,
    island,
    setVisited,
    go,
    setSheetToast,
    back,
    home,
    replace,
    sheetToast,
    layout,
    now,
  } = context;

  if (route === 'visit' || route === 'approval') {
    const i =
        state.islands.find((i) => i.id === (detail || visited || state.pendingIsland)) ||
        state.islands[1],
      pending = (state.pendingIslands ?? []).includes(i.id) || state.pendingIsland === i.id;
    const sail = () => {
      if (state.session) return notify('집중을 마친 뒤 이동해 주세요.');
      act('TRAVEL_FROM', { name: island.name });
      setVisited(i.id);
      go('travel', i.id);
    };
    // 승인 필요 섬은 신청만 하고 같은 시트에 토스트 한 줄(승인 대기 화면 없음). 방장이 확인하면 알림
    const apply = () => {
      if (state.session) return notify('집중을 마친 뒤 가입해 주세요.');
      if (i.kicked) return notify('강퇴된 섬에는 다시 가입할 수 없어요.');
      if (isFull(i)) return notify('정원이 가득 찬 섬이에요');
      act('JOIN', { id: i.id });
      if (i.approval) setSheetToast('참여 신청이 완료됐어요. 섬장이 확인하면 알려드릴게요.');
      else {
        act('TRAVEL_FROM', { name: island.name });
        setVisited(i.id);
        go(state.onboarded ? 'travel' : 'arrival', i.id);
      }
    };
    return (
      <IslandSheet
        bg="tower"
        sign="bld/observatory"
        title="바다 건너 섬"
        tall
        onBack={back}
        onClose={state.onboarded ? home : () => replace('sea')}
        toast={sheetToast}
        footer={
          state.onboarded ? (
            // 소속 섬은 이동하고, 미가입 섬은 읽기 전용 관전 경로로 이동한다.
            <Cta
              note={pending ? '참여 신청을 보냈어요. 섬장이 확인하면 알려드릴게요.' : undefined}
              title={i.joined ? '이 섬으로 가기' : '섬 둘러보기'}
              onPress={sail}
            />
          ) : (
            // 첫 섬 고르기: 아직 내 섬이 없어 구경할 수 없으므로 여기서 가입한다
            <Cta
              title="배 타고 이동"
              onPress={sail}
              ghost={
                i.joined
                  ? '소속된 섬'
                  : pending
                    ? '참여 신청됨 · 취소'
                    : i.approval
                      ? '가입 신청'
                      : '이 섬에 가입'
              }
              onGhost={
                i.joined
                  ? () => notify('이미 소속된 섬이에요.')
                  : pending
                    ? () => act('CANCEL_JOIN', { id: i.id })
                    : apply
              }
            />
          )
        }
      >
        {/* 가로 패널: 그림과 정보를 나란히 */}
        <View style={layout.compact ? { flexDirection: 'row', gap: 14 } : { gap: 14 }}>
          <Preview h={220} w={layout.compact ? 220 : undefined}>
            <Pic id="island/whole" w="100%" h="100%" cover />
          </Preview>
          <View style={{ flex: layout.compact ? 1 : undefined, minWidth: 0, gap: 14 }}>
            <Txt style={st.h22}>{i.name}</Txt>
            <Txt style={st.body}>{i.intro}</Txt>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <AvStack list={i.members.slice(0, 3).map((m) => m.color)} />
              <Txt kind="meta" style={[st.meta, { flex: 1 }]}>
                {`주민 ${residentCount(i)}명 · 평균 ${hoursMinutes(islandWeeklyAverage(state, i, now))}`}
              </Txt>
            </View>
            <Badge soft>{i.approval ? '승인 필요' : '바로 참여'}</Badge>
          </View>
        </View>
      </IslandSheet>
    );
  }
}
