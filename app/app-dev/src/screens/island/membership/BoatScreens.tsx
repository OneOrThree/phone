import { C, Pic, Txt } from '@/design-system/patterns';
import { semanticTokens } from '@/design-system/tokens';
import { t } from '@/i18n';
import {
  IslandSheet,
  RowIcon,
  SheetChev,
  SheetGroup,
  SheetRow,
  st,
} from '@/screens/island/IslandSheet';
import { isHost, mainIsland, residentCount } from '@/services/model';
import { Pressable, View } from 'react-native';
import type { ScreenContext } from '../navigation/useScreenState';

function IslandCircle({ size }: { size: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 2,
        borderColor: C.brown,
        overflow: 'hidden',
        backgroundColor: C.sky,
      }}
    >
      <Pic id="island/whole" w="100%" h="100%" cover />
    </View>
  );
}

function MainIslandRadio({ selected }: { selected: boolean }) {
  return (
    <View
      style={{
        width: 24,
        height: 24,
        borderRadius: 12,
        borderWidth: 2,
        borderColor: C.brown,
        backgroundColor: C.paper,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {selected && (
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: C.pink }} />
      )}
    </View>
  );
}
export function renderBoatScreens(context: ScreenContext) {
  const {
    route,
    server,
    friendsScreen,
    friends,
    state,
    island,
    snap,
    accountBg,
    home,
    go,
    mainIslandPick,
    back,
    setMainIslandPick,
    act,
  } = context;

  if (route === 'boat') {
    const received = server
        ? friendsScreen.status === 'ready'
          ? (friendsScreen.data?.friendRequests.length ?? 0)
          : 0
        : friends.filter((f) => f.status === 'received').length,
      joinedIslands = state.islands.filter((candidate) => candidate.joined && !candidate.closed),
      primaryIsland = mainIsland(state) ?? island,
      // mainIsland(state)/island 은 로컬 목업 섬(state.islands, 기본값 소다 섬)만 찾아 서버
      // 모드에서도(특히 게스트→멤버 전환처럼 목업 섬을 하나도 가입하지 않은 상태에서) 항상 「소다
      // 섬」으로 보였다. 서버 모드는 snap.memberships 에서 mainIslandId(/me 정본, 없으면
      // currentIslandId)로 찾은 이름이 정본이다(상점 잔액 라벨과 같은 패턴).
      // mainIslandId 가 멤버십에 없으면(재검증 중·탈퇴 직후) currentIslandId 쪽 이름도 찾고, 그래도 없으면
      // 목업 섬 이름으로 떨어지지 않고 이름 없는 문구를 쓴다.
      primaryIslandName = server
        ? (snap?.memberships.find((m) => m.id === state.mainIslandId)?.name ??
          snap?.memberships.find((m) => m.id === snap.currentIslandId)?.name ??
          t('account.boat.myIslandFallback'))
        : primaryIsland.name,
      canChangeMainIsland = (server ? (snap?.memberships.length ?? 0) : joinedIslands.length) > 1;
    const mainIslandCard = (
      <>
        <IslandCircle size={112} />
        <View style={{ flex: 1, height: 128, marginLeft: 20, paddingTop: 1, paddingRight: 22 }}>
          <Txt
            kind="meta"
            style={{ fontSize: 13, lineHeight: 19, fontWeight: '600', color: C.muted }}
          >
            {t('account.boat.currentMain')}
          </Txt>
          <Txt numberOfLines={1} ellipsizeMode="tail" style={[st.h22, { marginTop: 1 }]}>
            {primaryIslandName}
          </Txt>
          <Txt kind="meta" style={{ fontSize: 12, lineHeight: 18, marginTop: 1, color: C.muted }}>
            {t('account.boat.visibleInProfile')}
          </Txt>
          {canChangeMainIsland && (
            <Txt
              style={{
                position: 'absolute',
                left: 0,
                bottom: 1,
                fontSize: 13,
                lineHeight: 19,
                fontWeight: '600',
                // 위험 행동이 아니라 Danger 색을 쓰지 않는다(DESIGN §7.2)
                color: semanticTokens.color.text,
              }}
            >
              {t('account.boat.changeMain')}
            </Txt>
          )}
          {canChangeMainIsland && (
            <View style={{ position: 'absolute', right: 0, top: 51 }}>
              <SheetChev />
            </View>
          )}
        </View>
      </>
    );
    return (
      <IslandSheet
        bg={accountBg}
        sign="boat/raft"
        title={t('account.boat.title')}
        tight
        onClose={home}
      >
        {canChangeMainIsland ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('account.boat.currentMainA11y', { name: primaryIslandName })}
            onPress={() => go('mainIsland')}
            style={({ pressed }) => ({
              height: 164,
              flexDirection: 'row',
              alignItems: 'center',
              paddingHorizontal: 16,
              backgroundColor: C.paper,
              borderWidth: 2,
              borderColor: C.brown,
              borderRadius: 20,
              boxShadow: '0px 4px 0px #8B695657',
              opacity: pressed ? 0.78 : 1,
            })}
          >
            {mainIslandCard}
          </Pressable>
        ) : (
          <View
            accessible
            accessibilityLabel={t('account.boat.currentMainOnlyA11y', { name: primaryIslandName })}
            style={{
              height: 164,
              flexDirection: 'row',
              alignItems: 'center',
              paddingHorizontal: 16,
              backgroundColor: C.paper,
              borderWidth: 2,
              borderColor: C.brown,
              borderRadius: 20,
              boxShadow: '0px 4px 0px #8B695657',
            }}
          >
            {mainIslandCard}
          </View>
        )}
        <SheetGroup>
          {server && (
            <SheetRow
              title={t('islandPicker.currentTitle')}
              sub={
                island.name
                  ? t('islandPicker.currentIslandName', { name: island.name })
                  : t('islandPicker.chooseJoined')
              }
              chevron
              onPress={() => go('currentIsland')}
            />
          )}
          <SheetRow
            title={t('account.boat.wardrobeTitle')}
            sub={t('account.boat.wardrobeSub')}
            lead={<Pic id="scarf-cat" w={28} />}
            chevron
            onPress={() => go('wardrobe')}
          />
          <SheetRow
            title={t('account.boat.friendsTitle')}
            sub={t('account.boat.friendsSub')}
            lead={<RowIcon name="group" />}
            right={
              received ? (
                <Txt
                  style={{
                    fontSize: 15,
                    lineHeight: 21.75,
                    fontWeight: '700',
                    fontVariant: ['tabular-nums'],
                  }}
                >
                  {t('account.boat.friendRequestCount', { count: received })}
                </Txt>
              ) : undefined
            }
            chevron
            onPress={() => go('friends')}
          />
          <SheetRow
            title={t('account.profile.title')}
            sub={t('account.profile.sub')}
            lead={<Pic id={'avatar/' + state.color} w={28} />}
            chevron
            onPress={() => go('profile')}
          />
          <SheetRow
            title={t('account.boat.settingsTitle')}
            sub={t('account.boat.settingsSub')}
            lead={<RowIcon name="gear" />}
            chevron
            onPress={() => go('settings')}
          />
        </SheetGroup>
      </IslandSheet>
    );
  }

  if (route === 'mainIsland') {
    const joinedIslands = state.islands.filter(
        (candidate) => candidate.joined && !candidate.closed,
      ),
      primaryIsland = mainIsland(state),
      selectedIsland =
        joinedIslands.find((candidate) => candidate.id === mainIslandPick) ?? primaryIsland,
      unchanged = !selectedIsland || selectedIsland.id === primaryIsland?.id;
    return (
      <IslandSheet
        bg={accountBg}
        sign="island/whole"
        title={t('islandPicker.mainTitle')}
        tall
        tight
        onBack={back}
        onClose={home}
      >
        <View style={{ gap: 5 }}>
          <Txt style={{ fontSize: 18, lineHeight: 25, fontWeight: '700' }}>
            {t('ui.social.chooseMainIsland')}
          </Txt>
          <Txt kind="meta" style={{ fontSize: 12, lineHeight: 18, color: C.muted }}>
            {t('islandPicker.mainDescription')}
          </Txt>
        </View>
        <View
          style={{
            backgroundColor: C.paper,
            borderWidth: 2,
            borderColor: C.brown,
            borderRadius: 18,
            overflow: 'hidden',
            boxShadow: '0px 4px 0px #8B695657',
          }}
        >
          {joinedIslands.map((candidate, index) => {
            const selected = candidate.id === selectedIsland?.id,
              current = candidate.id === primaryIsland?.id;
            return (
              <Pressable
                key={candidate.id}
                accessibilityRole="radio"
                accessibilityLabel={t('ui.social.mainIslandA11y', {
                  v0: candidate.name,
                  v1: residentCount(candidate),
                  v2: isHost(candidate) ? t('ui.social.iAmHost') : t('ui.social.member'),
                  v3: current ? t('ui.social.currentMainSuffix') : '',
                })}
                accessibilityState={{ selected }}
                onPress={() => setMainIslandPick(candidate.id)}
                style={({ pressed }) => ({
                  height: 84,
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingHorizontal: 14,
                  backgroundColor: selected ? C.soft : C.paper,
                  borderBottomWidth: index < joinedIslands.length - 1 ? 1 : 0,
                  borderBottomColor: '#8B695633',
                  opacity: pressed ? 0.76 : 1,
                })}
              >
                <IslandCircle size={56} />
                <View style={{ flex: 1, minWidth: 0, marginLeft: 14, gap: 3 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Txt style={{ fontSize: 16, lineHeight: 22, fontWeight: '700' }}>
                      {candidate.name}
                    </Txt>
                    {current ? (
                      <View
                        style={{
                          height: 22,
                          paddingHorizontal: 10,
                          borderRadius: 11,
                          backgroundColor: C.sky,
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <Txt style={{ fontSize: 10, lineHeight: 14, fontWeight: '600' }}>
                          {t('ui.social.currentMain')}
                        </Txt>
                      </View>
                    ) : (
                      selected && (
                        <Txt
                          style={{
                            fontSize: 11,
                            lineHeight: 16,
                            fontWeight: '600',
                            color: '#9A4C3E',
                          }}
                        >
                          {t('islandPicker.selected')}
                        </Txt>
                      )
                    )}
                  </View>
                  <Txt kind="meta" style={{ fontSize: 12, lineHeight: 18, color: C.muted }}>
                    {t('ui.social.residentsRole', {
                      v0: residentCount(candidate),
                      v1: isHost(candidate) ? t('ui.social.iAmHost') : t('ui.social.member'),
                    })}
                  </Txt>
                </View>
                <MainIslandRadio selected={selected} />
              </Pressable>
            );
          })}
        </View>
        <Txt
          kind="meta"
          style={{ width: '100%', fontSize: 11, lineHeight: 17, textAlign: 'center' }}
        >
          {t('ui.social.mainIslandHint')}
        </Txt>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            selectedIsland
              ? t('ui.social.changeMain', { v0: selectedIsland.name })
              : t('account.boat.changeMain')
          }
          accessibilityState={{ disabled: unchanged }}
          disabled={unchanged}
          onPress={() => {
            if (!selectedIsland) return;
            act('MAIN_ISLAND', { id: selectedIsland.id });
            back();
          }}
          style={({ pressed }) => ({
            width: '100%',
            height: 52,
            borderRadius: 26,
            borderWidth: 2,
            borderColor: C.brown,
            backgroundColor: C.pink,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: unchanged ? 0.42 : pressed ? 0.76 : 1,
          })}
        >
          <Txt style={{ fontSize: 15, lineHeight: 22, fontWeight: '800' }}>
            {selectedIsland
              ? t('ui.social.changeMain', { v0: selectedIsland.name })
              : t('account.boat.changeMain')}
          </Txt>
        </Pressable>
      </IslandSheet>
    );
  }
}
