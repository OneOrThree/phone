/**
 * 다른 고양이 정보창(GROMO-2474) — 홈·집중섬·바다 표류·휴식에서 남의 고양이를 누르면 가운데 `IslandPopup` 으로 뜬다.
 * 고양이 그림(장면이 그려 넘긴다)·닉네임·「오늘 집중」(서버 값이 있을 때만)·친구 행동 하나를 보인다.
 *
 * 친구 관계·명령은 친구 관리 화면과 같은 정본(`useFriendsScreen` 상태 — `FriendActionContext` 로 받는다)을 쓴다.
 * 서버 성공(2xx) 뒤에만 버튼 상태를 바꾸고, 정보창이 닫히거나 대상·계정이 바뀐 뒤 온 응답은 버린다.
 * 목업(서버 없음)은 로컬 친구 목록과 리듀서로 상태만 보인다.
 */
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Badge, Btn, Txt } from '@/design-system/patterns';
import { componentTokens, semanticTokens } from '@/design-system/tokens';
import { t } from '@/i18n';
import { formatDuration } from '@/i18n/format';
import { IslandPopup } from '@/screens/island/IslandSheet';
import { useGowun } from '@/screens/island/sceneKit';
import type { FriendsScreenState } from '@/screens/island/useFriendsScreen';
import { seaBubble } from '@/screens/sea/SeaScene';
import { acceptFriendRequest, friendErrorKind, sendFriendRequest } from '@/services/api/friends';
import { sessionGeneration } from '@/services/api/session';
import type { Color, Friend } from '@/services/model';

const P = componentTokens.catInfoPopup;
const { color, stroke } = semanticTokens;

/** 정보창 친구 행동의 출처 — `CurrentScreens` 가 앱의 친구 상태로 채운다. 없으면 행동 줄을 그리지 않는다. */
export type FriendActionSource = {
  /** 서버 모드의 친구 화면 상태. 목업이면 null. */
  friendsScreen: FriendsScreenState | null;
  /** 회원 전환 게이트 — 처리했으면 true. */
  conversion?: { offer: (thrown: unknown) => boolean };
  /** 목업 모드의 로컬 친구 목록·리듀서. */
  friends?: Friend[];
  dispatch?: (action: { type: string; [key: string]: unknown }) => void;
};
export const FriendActionContext = createContext<FriendActionSource | null>(null);

type Relation = 'none' | 'received' | 'sent' | 'friend';
type Phase = 'busy' | 'failed' | 'sent' | 'friend';

/** 대상 한 명과의 친구 관계·오늘 집중·행동. 출처가 없으면 null. */
export function useFriendAction(userId: string, name: string, catColor: Color) {
  const source = useContext(FriendActionContext);
  const latest = useRef(source);
  latest.current = source;
  const target = useRef(userId);
  target.current = userId;
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  // 결과는 누른 대상에 묶는다 — 정보창이 다른 고양이로 바뀌면 옛 결과·처리 중 표시를 쓰지 않는다
  const [outcome, setOutcome] = useState<{ userId: string; phase: Phase } | null>(null);
  // 같은 프레임의 연타는 state 반영 전에 들어오므로 ref 로 막는다
  const flight = useRef(false);
  if (!source) return null;
  const phase = outcome?.userId === userId ? outcome.phase : null;
  const data = source.friendsScreen?.data;
  const friend = data?.friends.find((item) => item.userId === userId);
  const received = data?.friendRequests.find((item) => item.userId === userId);
  const known: Relation = source.friendsScreen
    ? friend
      ? 'friend'
      : received
        ? 'received'
        : data?.sentFriendRequests.some((item) => item.userId === userId)
          ? 'sent'
          : 'none'
    : (source.friends?.find((item) => item.id === userId)?.status ?? 'none');
  // 서버 성공 뒤 재조회가 오기 전까지는 성공한 결과를 보인다. 재조회가 친구라고 하면 그쪽이 정본이다
  const relation: Relation =
    known === 'friend' ? 'friend' : phase === 'sent' || phase === 'friend' ? phase : known;
  const press = () => {
    if (flight.current || relation === 'sent' || relation === 'friend') return;
    const accepting = relation === 'received';
    const screen = source.friendsScreen;
    if (!screen) {
      source.dispatch?.(
        accepting
          ? { type: 'FRIEND_ACCEPT', id: userId }
          : {
              type: 'FRIEND_REQUEST',
              id: userId,
              friend: { id: userId, name, color: catColor, island: '' },
            },
      );
      return;
    }
    const requestId = received?.requestId;
    const generation = sessionGeneration();
    // 정보창이 닫혔거나 다른 고양이로 바뀌었거나 계정이 바뀌었으면 응답을 이 대상의 결과로 쓰지 않는다
    const current = () =>
      alive.current && target.current === userId && generation === sessionGeneration();
    // 이 대상의 처리 중 표시만 결과로 바꾼다 — 그 사이 다른 대상의 표시는 건드리지 않는다
    const finish = (next: Phase | null) => {
      if (!alive.current) return;
      setOutcome((previous) =>
        previous?.userId === userId ? (next ? { userId, phase: next } : null) : previous,
      );
    };
    flight.current = true;
    setOutcome({ userId, phase: 'busy' });
    let ran = false;
    screen
      .command(() => {
        ran = true;
        return accepting && requestId ? acceptFriendRequest(requestId) : sendFriendRequest(userId);
      })
      // 다른 친구 명령이 진행 중이라 이 요청이 나가지 않았으면(ran=false) 원래 버튼으로 돌린다
      .then(() => finish(ran && current() ? (accepting ? 'friend' : 'sent') : null))
      .catch((thrown: unknown) => {
        if (!current() || latest.current?.conversion?.offer(thrown)) return finish(null);
        const kind = friendErrorKind(thrown);
        // 이미 친구·이미 보낸 요청·먼저 처리된 요청은 실패가 아니다 — 목록을 다시 읽으면 버튼이 맞춰진다
        if (kind !== 'duplicate' && kind !== 'already-handled') return finish('failed');
        latest.current?.friendsScreen?.refresh();
        finish(null);
      })
      .finally(() => {
        flight.current = false;
      });
  };
  return {
    relation,
    busy: phase === 'busy' || !!source.friendsScreen?.busy,
    failed: phase === 'failed',
    /** 친구 목록의 오늘 집중 분 — 서버가 준 값만. 친구가 아니면 없다. */
    todayMinutes: friend?.focusTimeMinutes ?? null,
    press,
  };
}

/** 바다 한마디 — 바다 장면 말풍선(`seaBubble`) 모양에 Brown 선과 아래로 향한 꼬리. */
function MessageBubble({ text, font }: { text: string; font: string }) {
  return (
    <View testID="cat-info-message" style={[seaBubble.box, styles.bubble]}>
      <Txt style={[seaBubble.text, { fontFamily: font }]}>{text}</Txt>
      <Svg width={P.tailWidth} height={P.tailHeight} style={styles.tail}>
        <Path
          d={`M0 0 L${P.tailWidth / 2} ${P.tailHeight - stroke.default} L${P.tailWidth} 0`}
          fill={StyleSheet.flatten(seaBubble.box).backgroundColor as string}
          stroke={color.outline}
          strokeWidth={stroke.default}
          strokeLinejoin="round"
        />
      </Svg>
    </View>
  );
}

export function CatInfoPopup({
  userId,
  name,
  catColor,
  art,
  message,
  onClose,
}: {
  userId: string;
  name: string;
  /** 목업 친구 요청에 남기는 털색 — 서버 모드는 쓰지 않는다. */
  catColor: Color;
  /** 장면과 같은 그리기 부품으로 그린 고양이(홈 idle · 집중섬 낚시 · 바다 뗏목 · 휴식 자세). */
  art: React.ReactNode;
  /** 바다 표류의 한마디 — 고양이 머리 위 말풍선. 없으면 말풍선도 없다. */
  message?: string;
  onClose: () => void;
}) {
  const gowun = useGowun();
  const font = { fontFamily: gowun };
  const action = useFriendAction(userId, name, catColor);
  const close = useRef(onClose);
  close.current = onClose;
  // 안드로이드 뒤로 가기는 장면을 떠나지 않고 정보창만 닫는다 — 정보창이 뜬 뒤 건 리스너가 먼저 불린다
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      close.current();
      return true;
    });
    return () => subscription.remove();
  }, []);
  return (
    // 장면 HUD(zIndex)가 정보창 위로 올라오지 않게 한 층 위에 띄운다. iOS 스크린리더는 이 층만 읽는다
    <View
      style={[StyleSheet.absoluteFill, styles.layer]}
      pointerEvents="box-none"
      accessibilityViewIsModal
    >
      <IslandPopup onClose={onClose}>
        <View style={styles.cat}>
          {!!message && <MessageBubble text={message} font={gowun} />}
          <View
            testID="cat-info-art"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            {art}
          </View>
        </View>
        <Txt
          testID="cat-info-name"
          kind="h17"
          accessibilityRole="header"
          numberOfLines={2}
          style={[styles.center, font]}
        >
          {name}
        </Txt>
        {action?.todayMinutes != null && (
          <Txt testID="cat-info-today" style={[styles.center, font]}>
            {t('catInfo.todayFocus', { duration: formatDuration(action.todayMinutes * 60) })}
          </Txt>
        )}
        {action?.relation === 'friend' ? (
          <Badge soft style={styles.badge}>
            {t('catInfo.friends')}
          </Badge>
        ) : (
          action && (
            <>
              {action.failed && (
                <Txt accessibilityRole="alert" style={[styles.center, styles.failed, font]}>
                  {t('catInfo.failed')}
                </Txt>
              )}
              <Btn
                id="cat-info-action"
                dynamicHeight
                font={gowun}
                title={t(
                  action.busy
                    ? 'catInfo.processing'
                    : action.relation === 'sent'
                      ? 'catInfo.requested'
                      : action.relation === 'received'
                        ? 'catInfo.accept'
                        : 'catInfo.request',
                )}
                disabled={action.busy || action.relation === 'sent'}
                onPress={action.press}
              />
            </>
          )
        )}
      </IslandPopup>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { zIndex: 50 },
  cat: { alignItems: 'center', gap: P.gap },
  bubble: {
    maxWidth: P.bubbleMaxWidth,
    borderWidth: stroke.default,
    borderColor: color.outline,
  },
  // 상자 안쪽 아래 끝에서 시작해 아래 선을 덮는다 — 선이 꼬리 자리에서 끊겨 말풍선과 꼬리가 한 덩어리로 보인다
  tail: { position: 'absolute', bottom: -P.tailHeight, left: '50%', marginLeft: -P.tailWidth / 2 },
  center: { textAlign: 'center' },
  failed: { color: color.danger },
  badge: { alignSelf: 'center' },
});
