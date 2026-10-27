// 우리 섬 채팅방 — 섬 홈 위 아래 시트(GROMO-2499). 우체통 건물 안에서 꺼내 우체통이 없는 섬에서도 연다.
// 서버 모드는 useIslandChat(CurrentScreens 가 한 번 켜서 넘긴다), 목업 모드는 로컬 상태(island.messages)를 그린다.
// 뒤의 섬 홈(FinalIsland)은 부르는 쪽이 깔고 스크린리더에서 숨긴다.
import React, { useEffect, useRef } from 'react';
import { ScrollView, View } from 'react-native';
import { Btn, C, Txt, k } from '@/design-system/patterns';
import { TextInput } from '@/design-system/typography';
import { componentTokens, semanticTokens } from '@/design-system/tokens';
import { IslandSheet, Avatar, sheetInput } from '@/screens/island/IslandSheet';
import { appearanceOutfit, type Outfit } from '@/components/CatOutfitLayers';
import { ApiError } from '@/services/api/client';
import { currentIsland, dayKey, type State } from '@/services/model';
import type { IslandChat } from '@/screens/island/useIslandChat';
import { t } from '@/i18n';

const BUBBLE = componentTokens.islandChatBubble;
const stroke = semanticTokens.stroke;

// 채팅 시각: 방금 · N분 전 · N시간 전 · 그 전은 M월 D일
export const chatTime = (at: number, now: number) => {
  const minutes = Math.floor((now - at) / 60000);
  if (minutes < 1) return t('islandChat.justNow');
  if (minutes < 60) return t('islandChat.minutesAgo', { n: minutes });
  if (minutes < 1440) return t('islandChat.hoursAgo', { n: Math.floor(minutes / 60) });
  const [, month, date] = dayKey(at).split('-').map(Number);
  return t('islandChat.date', { month, date });
};

type Row = {
  id: string;
  name: string;
  text: string;
  time: string;
  color: string | null;
  outfit?: Outfit | null;
  mine: boolean;
  failed: boolean;
};

export function IslandChatSheet({ e, chat }: { e: any; chat: IslandChat }) {
  const server = !!e.islands;
  const state: State = e.state;
  const island = currentIsland(state);
  const now: number = e.now ?? 0;
  const scrollRef = useRef<ScrollView>(null);
  const text: string = e.text ?? '';

  // 채팅방은 최신 글이 아래에 온다 — 서버 목록은 오래된 것부터, 목업 섬은 최신 것부터라 뒤집는다
  const rows: Row[] = server
    ? chat.messages.map((m) => ({
        id: m.id,
        name: m.name ?? t('islandChat.unknown'),
        text: m.text,
        time: chatTime(Date.parse(m.createdAt), now),
        color: m.catColor ?? null,
        outfit: appearanceOutfit(m.appearance),
        mine: m.userId === chat.myId,
        failed: false,
      }))
    : [...island.messages].reverse().map((m) => ({
        id: m.id,
        name: m.name,
        text: m.text,
        time: chatTime(m.at, now),
        color: m.color,
        mine: m.memberId === 'me',
        failed: m.status === 'failed',
      }));

  // 목업 경로: 채팅방을 열어 둔 동안 들어온 글은 읽은 것으로 본다(서버 경로는 읽음 표시가 없다)
  useEffect(() => {
    if (!server) e.dispatch({ type: 'CHAT_READ' });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 글 수가 바뀔 때만 다시 읽음 처리한다.
  }, [server, island.messages.length]);

  // 새 글(받은 글·보낸 글)이 아래에 붙으면 맨 아래로 내린다. 이전 글을 위에 붙일 때는 그대로 둔다
  const lastId = rows.at(-1)?.id;
  useEffect(() => {
    if (!lastId) return;
    const frame = requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: false }));
    return () => cancelAnimationFrame(frame);
  }, [lastId]);

  const send = () => {
    if (!text.trim()) return e.notify(t('islandChat.emptyText'));
    if (server) {
      // 성공 응답만 목록에 붙는다 — 실패는 입력 초안을 그대로 두고 오류를 알린다
      chat
        .sendMessage(text)
        .then(() => e.setText(''))
        .catch((err) =>
          e.notify(err instanceof ApiError ? err.message : t('islandChat.sendFailed')),
        );
      return;
    }
    // 목업 서버: 다음 보내기를 실패로 만들면 글에 실패 표시와 다시 보내기가 붙는다
    e.dispatch({ type: 'MESSAGE', text, fail: e.failNext });
    if (e.failNext) e.setFailNext(false);
    e.setText('');
  };

  const status = (label: string) => (
    <Txt kind="meta" style={{ paddingVertical: 24, textAlign: 'center' }}>
      {label}
    </Txt>
  );
  const retryBox = (error: ApiError, id: string) => (
    <View style={{ alignItems: 'center', gap: 8, paddingVertical: 12 }}>
      <Txt kind="meta" style={{ textAlign: 'center', color: C.danger }}>
        {error.message}
      </Txt>
      <Btn
        id={id}
        small
        kind="sec"
        title={t('common.retry')}
        onPress={() => chat.retry().catch(() => {})}
      />
    </View>
  );

  return (
    <IslandSheet
      sign="island/whole"
      signKind="island"
      title={t('islandChat.title')}
      tall
      onClose={e.back}
      scrollRef={scrollRef}
      footer={
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
          <TextInput
            testID="island-message-input"
            accessibilityLabel={t('islandChat.placeholder')}
            value={text}
            onChangeText={e.setText}
            placeholder={t('islandChat.placeholder')}
            placeholderTextColor={componentTokens.input.placeholder}
            multiline
            style={[k.field, sheetInput, { flex: 1, maxHeight: 120 }]}
          />
          <Btn id="island-message-send" small title={t('islandChat.send')} onPress={send} />
        </View>
      }
    >
      {server && chat.loading && !rows.length
        ? status(t('islandChat.loading'))
        : server && chat.error && !rows.length
          ? retryBox(chat.error, 'chat-retry')
          : !rows.length && !chat.messagesCursor
            ? status(t('islandChat.empty'))
            : null}
      {server && chat.error && rows.length > 0 && retryBox(chat.error, 'chat-refresh-retry')}
      {/* 최신 페이지가 모두 차단한 사용자의 글이면 rows 는 비어도 커서는 남는다 — 표시 수가 아니라 커서로 버튼을 낸다 */}
      {server && chat.messagesCursor ? (
        <Btn
          id="chat-more"
          small
          kind="ghost"
          title={chat.loadingMore ? t('islandChat.loadingMore') : t('islandChat.more')}
          onPress={() => chat.loadMoreMessages()}
        />
      ) : null}
      {rows.map((m) =>
        m.mine ? (
          <View
            key={m.id}
            style={{
              alignSelf: 'flex-end',
              maxWidth: BUBBLE.mineMaxWidth,
              paddingVertical: BUBBLE.paddingVertical,
              paddingHorizontal: BUBBLE.paddingHorizontal,
              borderWidth: stroke.default,
              borderColor: C.brown,
              borderRadius: BUBBLE.radius,
              borderBottomRightRadius: BUBBLE.tailRadius,
              backgroundColor: C.soft,
            }}
          >
            <Txt>{m.text}</Txt>
            {m.failed ? (
              <Txt kind="meta" style={{ marginTop: 2, textAlign: 'right', color: C.danger }}>
                {t('islandChat.failed')} ·{' '}
                <Txt
                  testID={`chat-retry-${m.id}`}
                  accessibilityRole="button"
                  onPress={() => e.dispatch({ type: 'RETRY_MESSAGE', id: m.id })}
                  style={{ color: C.danger, textDecorationLine: 'underline' }}
                >
                  {t('islandChat.resend')}
                </Txt>
              </Txt>
            ) : (
              <Txt kind="meta" style={{ marginTop: 2, textAlign: 'right' }}>
                {t('islandChat.me')} · {m.time}
              </Txt>
            )}
          </View>
        ) : (
          <View
            key={m.id}
            style={{ flexDirection: 'row', alignItems: 'flex-start', gap: BUBBLE.gap }}
          >
            <Avatar color={m.color ?? 'gray'} outfit={m.color ? m.outfit : undefined} size={36} />
            {/* 꼬리(왼쪽 위 각진 모서리)는 프로필을 향한다(DESIGN §8.5) */}
            <View
              style={{
                flexShrink: 1,
                paddingVertical: BUBBLE.paddingVertical,
                paddingHorizontal: BUBBLE.paddingHorizontal,
                borderWidth: stroke.default,
                borderColor: C.brown,
                borderRadius: BUBBLE.radius,
                borderTopLeftRadius: BUBBLE.tailRadius,
                backgroundColor: C.paper,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
                <Txt style={{ fontWeight: '700' }}>{m.name}</Txt>
                <Txt kind="meta">{m.time}</Txt>
              </View>
              <Txt style={{ marginTop: 2 }}>{m.text}</Txt>
            </View>
          </View>
        ),
      )}
    </IslandSheet>
  );
}
