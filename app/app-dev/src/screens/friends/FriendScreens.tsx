import { appearanceOutfit } from '@/components/CatOutfitLayers';
import { UserSafetySheet } from '@/components/UserSafetySheet';
import { assets } from '@/constants/assets';
import { Badge, Btn, C, EmptyState, Txt } from '@/design-system/patterns';
import { semanticTokens } from '@/design-system/tokens';
import { t } from '@/i18n';
import {
  Avatar,
  IslandSheet,
  SearchField,
  SheetGroup,
  SheetRow,
  st,
} from '@/screens/island/IslandSheet';
import {
  acceptFriendRequest,
  cancelFriendRequest,
  deleteFriend,
  friendErrorKind,
  rejectFriendRequest,
  sendFriendRequest,
} from '@/services/api/friends';
import { Friend } from '@/services/model';
import React from 'react';
import { Pressable, View } from 'react-native';
import type { ScreenContext } from '../island/navigation/useScreenState';

// 친구 찾기 목업 사용자. 닉네임이 같은 사람이 여럿일 수 있다(시안 보리 2명)
const friendDirectory: Omit<Friend, 'status' | 'messages'>[] = [
  { id: 'saebom', name: '새봄', color: 'white', island: '딸기 섬' },
  { id: 'minji', name: '민지', color: 'ginger', island: '소다 섬' },
  { id: 'haneul', name: '하늘', color: 'calico', island: '구름 섬' },
  { id: 'bori-strawberry', name: '보리', color: 'gray', island: '딸기 섬' },
  { id: 'bori', name: '보리', color: 'cream', island: '구름 섬' },
];
export function renderFriendScreens(context: ScreenContext) {
  const {
    route,
    server,
    friendsScreen,
    friends,
    search,
    setSafetyTarget,
    layout,
    act,
    confirm,
    friendCmd,
    accountBg,
    back,
    home,
    setSearch,
    e,
    safetyTarget,
    notify,
  } = context;

  if (route === 'friends' || route === 'friendSearch') {
    const serverMode = !!server;
    const data = serverMode ? friendsScreen.data : null;
    const received = serverMode
      ? (data?.friendRequests ?? [])
      : friends.filter((friend) => friend.status === 'received');
    const sent = serverMode
      ? (data?.sentFriendRequests ?? [])
      : friends.filter((friend) => friend.status === 'sent');
    const accepted = serverMode
      ? (data?.friends ?? [])
      : friends.filter((friend) => friend.status === 'friend');
    const queryValue = serverMode ? friendsScreen.query : search;
    const query = queryValue.trim().toLowerCase();
    const localResults = query
      ? friendDirectory.filter((friend) => friend.name.toLowerCase() === query)
      : [];
    const sectionTitle = (title: string, count?: number) => (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
        <Txt kind="section" style={[st.sec, { marginTop: 0 }]}>
          {title}
        </Txt>
        {count !== undefined && <Badge small>{count}</Badge>}
      </View>
    );
    const friendMenu = (id: string, name: string, onDelete?: () => void) => (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${name} 더보기`}
        hitSlop={6}
        onPress={() => setSafetyTarget({ id, name, onDelete })}
        style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}
      >
        <Txt
          style={{
            fontSize: 20,
            lineHeight: 29,
            fontWeight: '800',
            letterSpacing: 1,
            color: C.brown,
          }}
        >
          ···
        </Txt>
      </Pressable>
    );
    // 줄 끝 버튼과 ··· — 큰 글자에서는 이름 칸이 줄지 않게 세로로 쌓는다(받은·보낸 요청·검색 결과 공통)
    const rowActions = (
      actions: React.ReactNode,
      safetyMenu?: React.ReactNode,
      testID?: string,
    ) => {
      const stacked =
        !!safetyMenu && layout.fontScale >= semanticTokens.typography.largeTextThreshold;
      return (
        <View
          testID={safetyMenu ? testID : undefined}
          style={{
            flexDirection: stacked ? 'column' : 'row',
            alignItems: 'center',
            gap: 8,
          }}
        >
          {actions}
          {safetyMenu}
        </View>
      );
    };
    const requestActions = (
      onAccept: () => void,
      onReject: () => void,
      safetyMenu?: React.ReactNode,
    ) =>
      rowActions(
        <>
          <Btn small title="수락" disabled={serverMode && friendsScreen.busy} onPress={onAccept} />
          <Btn
            small
            kind="sec"
            title="거절"
            disabled={serverMode && friendsScreen.busy}
            onPress={onReject}
          />
        </>,
        safetyMenu,
        'friend-request-actions-with-safety',
      );
    const localFriendRow = (friend: (typeof friends)[number], searchResult = false) => (
      <SheetRow
        key={friend.id}
        title={friend.name}
        sub={
          friend.island +
          (friend.status === 'sent'
            ? ' · 수락 기다리는 중'
            : searchResult && friend.status === 'received'
              ? ' · 받은 요청'
              : '')
        }
        tone={friend.status === 'received' ? 'butter' : undefined}
        lead={<Avatar color={friend.color} />}
        tail={
          friend.status === 'received' ? (
            requestActions(
              () => act('FRIEND_ACCEPT', { id: friend.id }),
              () => act('FRIEND_REJECT', { id: friend.id }),
            )
          ) : friend.status === 'sent' ? (
            <Btn
              small
              kind="sec"
              title="요청 취소"
              onPress={() => act('FRIEND_CANCEL', { id: friend.id })}
            />
          ) : friend.status === 'friend' ? (
            searchResult ? (
              <Badge soft>친구</Badge>
            ) : (
              <Btn
                small
                kind="sec"
                title="친구 삭제"
                onPress={() =>
                  confirm(
                    '친구를 삭제할까요?',
                    `${friend.name}님과 더 이상 편지를 주고받을 수 없어요. 아직 읽지 않은 편지도 지워져요.`,
                    () => act('FRIEND_DELETE', { id: friend.id }),
                    { ok: '삭제', destructive: true },
                  )
                }
              />
            )
          ) : (
            <Btn
              small
              title="친구 요청"
              onPress={() => act('FRIEND_REQUEST', { id: friend.id, friend })}
            />
          )
        }
      />
    );
    const serverReceivedRows = (data?.friendRequests ?? []).map((friend) => {
      const name = friend.nickname ?? '탈퇴한 사용자';
      return (
        <SheetRow
          key={friend.requestId}
          title={name}
          tone="butter"
          lead={
            <Avatar
              userId={friend.userId}
              color={friend.catColor}
              outfit={friend.catColor ? appearanceOutfit(friend.appearance) : undefined}
            />
          }
          tail={requestActions(
            () => friendCmd(() => acceptFriendRequest(friend.requestId)),
            () => friendCmd(() => rejectFriendRequest(friend.requestId)),
            friendMenu(friend.userId, name),
          )}
        />
      );
    });
    const serverSentRows = (data?.sentFriendRequests ?? []).map((friend) => {
      const name = friend.nickname ?? '탈퇴한 사용자';
      return (
        <SheetRow
          key={friend.requestId}
          title={name}
          sub="수락 기다리는 중"
          lead={
            <Avatar
              userId={friend.userId}
              color={friend.catColor}
              outfit={friend.catColor ? appearanceOutfit(friend.appearance) : undefined}
            />
          }
          tail={rowActions(
            <Btn
              small
              kind="sec"
              title="요청 취소"
              disabled={friendsScreen.busy}
              onPress={() => friendCmd(() => cancelFriendRequest(friend.requestId))}
            />,
            friendMenu(friend.userId, name),
          )}
        />
      );
    });
    const serverFriendRows = (data?.friends ?? []).map((friend) => {
      const name = friend.nickname ?? '탈퇴한 사용자';
      return (
        <SheetRow
          key={friend.userId}
          title={name}
          sub={friend.mainIslandName ?? undefined}
          lead={
            <Avatar
              userId={friend.userId}
              color={friend.catColor}
              outfit={friend.catColor ? appearanceOutfit(friend.appearance) : undefined}
            />
          }
          tail={friendMenu(friend.userId, name, () => friendCmd(() => deleteFriend(friend.userId)))}
        />
      );
    });
    const receivedRows = serverMode
      ? serverReceivedRows
      : (received as Friend[]).map((friend) => localFriendRow(friend));
    const sentRows = serverMode
      ? serverSentRows
      : (sent as Friend[]).map((friend) => localFriendRow(friend));
    const friendRows = serverMode
      ? serverFriendRows
      : (accepted as Friend[]).map((friend) => localFriendRow(friend));
    const empty = (message = '아직 없어요.') => (
      <Txt kind="meta" style={[st.meta, { paddingVertical: 10 }]}>
        {message}
      </Txt>
    );
    const searchRows = serverMode
      ? friendsScreen.searchItems.map((friend) => (
          <SheetRow
            key={friend.userId}
            title={friend.nickname}
            sub={friend.relation === 'FRIEND' ? '친구' : undefined}
            lead={
              <Avatar
                userId={friend.userId}
                color={friend.catColor}
                outfit={friend.catColor ? appearanceOutfit(friend.appearance) : undefined}
              />
            }
            tail={rowActions(
              friend.relation === 'NONE' ? (
                <Btn
                  small
                  title="친구 요청"
                  disabled={friendsScreen.busy}
                  onPress={() => friendCmd(() => sendFriendRequest(friend.userId))}
                />
              ) : (
                <Btn
                  small
                  kind="sec"
                  disabled
                  title={friend.relation === 'PENDING' ? '요청 중' : '친구'}
                />
              ),
              friendMenu(friend.userId, friend.nickname),
            )}
          />
        ))
      : localResults.map((candidate) => {
          const existing = friends.find((friend) => friend.id === candidate.id);
          return localFriendRow(existing ?? { ...candidate, status: 'none', messages: [] }, true);
        });
    const searchContent =
      serverMode && friendsScreen.searchStatus === 'error' ? (
        <SheetGroup>
          <View style={{ alignItems: 'center', gap: 9, paddingVertical: 18 }}>
            <Txt kind="meta">{friendsScreen.searchError?.message ?? '검색하지 못했어요'}</Txt>
            <Btn small kind="sec" title="다시 시도" onPress={friendsScreen.retry} />
          </View>
        </SheetGroup>
      ) : serverMode && friendsScreen.searchStatus !== 'ready' ? (
        <Txt kind="meta" style={[st.meta, { paddingVertical: 10 }]}>
          찾는 중이에요…
        </Txt>
      ) : searchRows.length ? (
        <SheetGroup>{searchRows}</SheetGroup>
      ) : (
        <SheetGroup>
          <View style={{ paddingVertical: 24, paddingHorizontal: 18, alignItems: 'center' }}>
            <Txt style={{ fontSize: 16, lineHeight: 23, fontWeight: '700' }}>
              검색 결과가 없어요
            </Txt>
          </View>
        </SheetGroup>
      );
    const leftColumn = query ? (
      <View style={{ flex: layout.compact ? 1 : undefined, minWidth: 0, gap: 7 }}>
        {sectionTitle('검색 결과')}
        {searchContent}
      </View>
    ) : (
      <View style={{ flex: layout.compact ? 1 : undefined, minWidth: 0, gap: 16 }}>
        <View style={{ gap: 7 }}>
          {sectionTitle('받은 요청', receivedRows.length)}
          {receivedRows.length ? <SheetGroup>{receivedRows}</SheetGroup> : empty()}
        </View>
        <View style={{ gap: 7 }}>
          {sectionTitle('보낸 요청')}
          {sentRows.length ? <SheetGroup>{sentRows}</SheetGroup> : empty()}
        </View>
      </View>
    );
    const friendColumn = (
      <View style={{ flex: layout.compact ? 1 : undefined, minWidth: 0, gap: 7 }}>
        {sectionTitle('친구')}
        {serverMode && friendsScreen.status === 'loading' ? (
          <Txt kind="meta" style={[st.meta, { paddingVertical: 10 }]}>
            불러오는 중이에요
          </Txt>
        ) : serverMode && friendsScreen.status === 'error' ? (
          <View style={{ alignItems: 'center', gap: 9, paddingVertical: 12 }}>
            <Txt kind="meta">{friendsScreen.error?.message ?? '친구 목록을 불러오지 못했어요'}</Txt>
            <Btn small kind="sec" title="다시 시도" onPress={friendsScreen.retry} />
          </View>
        ) : friendRows.length ? (
          <SheetGroup>{friendRows}</SheetGroup>
        ) : (
          empty('아직 친구가 없어요.')
        )}
      </View>
    );
    return (
      <>
        <IslandSheet
          bg={accountBg}
          sign="boat/raft"
          title="친구 관리"
          tall
          onBack={back}
          onClose={home}
        >
          <SearchField
            value={queryValue}
            onChange={serverMode ? friendsScreen.setQuery : setSearch}
            placeholder="닉네임으로 친구 찾기"
          />
          {serverMode && !query && friendsScreen.status === 'loading' ? (
            <Txt kind="meta" style={[st.meta, { textAlign: 'center', paddingVertical: 24 }]}>
              불러오는 중이에요
            </Txt>
          ) : serverMode && !query && friendsScreen.status === 'error' ? (
            <View style={{ alignItems: 'center', gap: 9, paddingVertical: 24 }}>
              <Txt kind="meta">
                {friendsScreen.error?.message ?? '친구 목록을 불러오지 못했어요'}
              </Txt>
              {friendErrorKind(friendsScreen.error) === 'guest' && e.conversion ? (
                <Btn
                  small
                  title="소셜 로그인하기"
                  onPress={() => e.conversion?.offer(friendsScreen.error)}
                />
              ) : (
                <Btn small kind="sec" title="다시 시도" onPress={friendsScreen.retry} />
              )}
            </View>
          ) : !query && !receivedRows.length && !sentRows.length && !friendRows.length ? (
            // 받은·보낸 요청과 친구가 모두 없으면 빈 칸 셋 대신 빈 안내 하나
            <EmptyState
              testID="friends-empty"
              art={assets['characters/pelican/npc/idle.png']}
              title={t('emptyState.friends')}
            />
          ) : (
            <View
              style={
                layout.compact
                  ? { flexDirection: 'row', alignItems: 'flex-start', gap: 18 }
                  : { gap: 16 }
              }
            >
              {leftColumn}
              {friendColumn}
            </View>
          )}
        </IslandSheet>
        {serverMode && safetyTarget ? (
          <UserSafetySheet
            visible
            targetUserId={safetyTarget.id}
            targetName={safetyTarget.name}
            onClose={() => setSafetyTarget(null)}
            onChanged={() => {
              // 차단 성공 뒤에만 불린다. 그 상대에게 보낸 대기 요청이 있으면 취소한다(GROMO-2467) —
              // 보낸 요청 목록은 방금 차단으로 이미 걸러졌을 수 있어 거르기 전 목록에서 찾는다.
              // 취소 실패는 알리지 않는다: 요청 줄은 차단 필터로 이미 숨겨져 있다.
              const pending = friendsScreen.unfilteredSentFriendRequests.find(
                (request) => request.userId === safetyTarget.id,
              );
              if (!pending) friendsScreen.refresh();
              else
                cancelFriendRequest(pending.requestId)
                  .catch(() => {})
                  .finally(friendsScreen.refresh);
            }}
            onMessage={notify}
            extraAction={
              safetyTarget.onDelete
                ? {
                    title: '친구 삭제',
                    onPress: () =>
                      confirm(
                        '친구를 삭제할까요?',
                        `${safetyTarget.name}님과 더 이상 편지를 주고받을 수 없어요. 아직 읽지 않은 편지도 지워져요.`,
                        safetyTarget.onDelete!,
                        { ok: '삭제', destructive: true },
                      ),
                  }
                : undefined
            }
          />
        ) : null}
      </>
    );
  }
}
