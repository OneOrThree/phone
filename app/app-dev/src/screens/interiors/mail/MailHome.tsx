import { formatCalendarDate } from '@/i18n/format';
import { CatAvatar } from '@/components/CatAvatar';
import { type Outfit, appearanceOutfit } from '@/components/CatOutfitLayers';
import { UserSafetySheet } from '@/components/UserSafetySheet';
import { VillageNotificationBadge } from '@/components/village-motion/VillageNotificationBadge';
import { MAGAZINE_UI } from '@/constants/magazineAssets';
import { NavBtn } from '@/design-system/patterns';
import { componentTokens, primitiveTokens, semanticTokens } from '@/design-system/tokens';
import { errorText, errorTextOr, t } from '@/i18n';
import { useMailbox } from '@/screens/interiors/useMailbox';
import { GOWUN } from '@/screens/island/sceneKit';
import { MagazineRack } from '@/screens/magazine/MagazineRack';
import { magazineUnread } from '@/screens/magazine/useMagazineToday';
import { ApiError } from '@/services/api/client';
import { isSystemLetter, isSystemLetterView } from '@/services/api/letters';
import type { MagazineToday } from '@/services/api/magazine';
import { isMockMode } from '@/services/demoMode';
import {
  State,
  canSendLetter,
  displayIsland as currentIsland,
  dayKey,
  kstDayStart,
  kstHourMinute,
  unreadLetters,
} from '@/services/model';
import { captureProductEvent } from '@/services/posthog';
import React, { useEffect, useMemo, useState } from 'react';
import { Animated, Image, Platform, Pressable, TextInput, View } from 'react-native';
import { interiorArt } from '../assets';
import { NavScale } from '../shared/NavScale';
import { Scroll } from '../shared/Scroll';
import { useReact } from '../shared/motion';
import { INK, OUTLINE, gradient, lh, webOnly } from '../shared/styles';
import { Text, obsFont } from '../shared/typography';
import { ArtifactProps } from '../types';

type MailRoute = 'home' | 'inbox' | 'letter' | 'friend-select' | 'compose';

// 화면이 그리는 모양. 목업과 앱 상태(e) 둘 다 이 모양으로 바꿔 넘긴다
type LetterView = {
  id: string;
  // 섬 시스템 편지(강퇴·가입 승인)는 발신자가 없어 null — 답장·차단 시트를 그리지 않는다.
  friendId: string | null;
  from: string;
  island: string;
  color: string | null;
  outfit?: Outfit;
  time: string;
  body: string;
  // 서버 목록 경로에서만 온다 — 읽은 편지를 옅게 그리는 데 쓴다.
  isRead?: boolean;
};

type FriendView = {
  id: string;
  name: string;
  island: string;
  color: string | null;
  outfit?: Outfit;
};

const receivedLetters: LetterView[] = [
  {
    id: '0',
    friendId: '0',
    from: '민지',
    island: '구름 섬',
    color: 'ginger',
    time: '오늘 09:12',
    body: '섬에 새 꽃이 피었어.\n다음에 놀러 와서 같이 보자.',
  },
  {
    id: '1',
    friendId: '1',
    from: '밤이',
    island: '밤비 섬',
    color: 'black',
    time: '어제 22:40',
    body: '오늘도 수고 많았어!\n내일도 같이 천천히 해보자.',
  },
  {
    id: '2',
    friendId: '2',
    from: '보리',
    island: '라임 섬',
    color: 'calico',
    time: '월요일',
    body: '새 레코드 들어봤어?\n모닥불 옆에서 들으면 정말 좋아.',
  },
];

const letterFriends: FriendView[] = [
  { id: '0', name: '민지', island: '구름 섬', color: 'ginger' },
  { id: '1', name: '밤이', island: '밤비 섬', color: 'black' },
  { id: '2', name: '보리', island: '라임 섬', color: 'calico' },
];

// 받은 편지 시각: 오늘 09:12 · 어제 22:40 · 일주일 안이면 요일 · 그 전은 M월 D일
const letterTime = (at: number, now: number) => {
  const days = Math.round((kstDayStart(dayKey(now)) - kstDayStart(dayKey(at))) / 86400000);
  if (days === 0) return t('ui.mail.today', { v0: kstHourMinute(at) });
  if (days === 1) return t('ui.mail.yesterday', { v0: kstHourMinute(at) });
  return formatCalendarDate(
    dayKey(at),
    days < 7 ? { weekday: 'long' } : { month: 'long', day: 'numeric' },
  );
};

export function MailHome({ concept, height, reduceMotion, showToast, e }: ArtifactProps) {
  const navScale = React.useContext(NavScale);
  const mailFont = (
    fontSize: number,
    factor: number,
    color: string = INK,
    fontWeight: '400' | '700' | '800' | '900' = '400',
  ) => obsFont(Math.max(8, Math.round(fontSize * 1.3)), factor, color, fontWeight);
  const initialRoute: MailRoute =
    concept.kind === 'received-letters'
      ? 'inbox'
      : concept.kind === 'letter-detail'
        ? 'letter'
        : concept.kind === 'friend-select'
          ? 'friend-select'
          : concept.kind === 'friend-compose'
            ? 'compose'
            : 'home';
  const [localRoute, setRoute] = useState<MailRoute>(initialRoute);
  const [selectedFriend, setSelectedFriend] = useState('0');
  const [selectedLetter, setSelectedLetter] = useState('0');
  const [letterText, setLetterText] = useState('섬에 새 꽃이 피었어. 다음에 놀러 와서 같이 보자.');
  const [deletedLetters, setDeletedLetters] = useState<string[]>([]);
  const [letterSafetyTarget, setLetterSafetyTarget] = useState<LetterView | null>(null);
  const [magazineRack, setMagazineRack] = useState(false);
  const [reactTransform, react] = useReact(reduceMotion);
  // 앱에서는 안내를 앱 알림으로 띄운다 (장면 토스트는 동작 줄이기에서 그려지지 않는다)
  const say = (message: string) => (e ? e.notify(message) : showToast(message));

  // 앱 상태 → 우체통 화면. 받은 편지=mail+tab, 편지 상세=mail+detail, 친구 선택·편지 쓰기=friendMail
  const state: State | null = e?.state ?? null,
    island = state && currentIsland(state),
    now: number = e?.now ?? 0;
  // 라이브 앱 경로 — Board 와 같은 판정(services/demoMode)으로 review·demo 목업을 걸러 낸다.
  // 목업에서도 e 가 있으므로 e 유무만으로는 서버 경로를 켤 수 없다.
  const liveApp = !!e && !isMockMode();
  // 서버 우체통(GROMO-2016): 라이브 앱 라우트 + 비방문자일 때만 API 를 부른다. 목업·갤러리는 0콜이다.
  const serverMail = liveApp && !state?.visitingIslandId;
  const mail = useMailbox({
    active: serverMail,
    scopeKey: island ? String(island.id) : 'mock',
  });
  // 친구·편지 상대는 응답에 털색·착용이 없으면 null — 아바타가 userId 묶음 조회로 채우고, 값이 없으면 빈 상자로 그린다.
  const friendIsland = (userId: string | null) =>
    (userId && mail.friends.find((f) => f.userId === userId)?.mainIslandName) || '';
  const friends: FriendView[] = serverMail
    ? mail.friends.map((f) => ({
        id: f.userId,
        name: f.nickname ?? t('islandChat.unknown'),
        island: f.mainIslandName ?? '',
        color: f.catColor ?? null,
        outfit: appearanceOutfit(f.appearance),
      }))
    : state
      ? (state.friends ?? [])
          .filter((f) => f.status === 'friend')
          .map((f) => ({ id: f.id, name: f.name, island: f.island, color: f.color }))
      : letterFriends;
  // 섬 시스템 편지(GROMO-2275)를 친구 편지와 한 목록에 최신순으로 섞는다. sort 는 안정 정렬이라
  // 서버가 이미 최신순으로 준 친구 편지끼리의 순서는 그대로다. 안 읽음 수도 둘을 함께 센다(아래, GROMO-2489).
  const mergedLetters = useMemo(
    () =>
      [...mail.systemLetters, ...mail.letters].sort(
        (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
      ),
    [mail.systemLetters, mail.letters],
  );
  const letters: LetterView[] = serverMail
    ? mergedLetters.map((l) => {
        // 시스템 편지는 발신자 id 가 채워져 와도 친구가 아니다 — 닉네임·섬·답장·차단을 붙이지 않는다.
        const system = isSystemLetter(l);
        return {
          id: l.id,
          friendId: system ? null : l.counterpartUserId,
          from: system
            ? t('mailbox.systemSender')
            : (l.counterpartNickname ?? t('islandChat.unknown')),
          island: system ? '' : friendIsland(l.counterpartUserId),
          color: l.catColor ?? null,
          outfit: appearanceOutfit(l.appearance),
          time: letterTime(Date.parse(l.createdAt), now),
          body: l.content,
          isRead: l.isRead,
        };
      })
    : state
      ? unreadLetters(state).map(({ friend, letter }) => ({
          id: letter.id,
          friendId: friend.id,
          from: friend.name,
          island: friend.island,
          color: friend.color,
          time: letterTime(letter.at, now),
          body: letter.text,
        }))
      : receivedLetters.filter((letter) => !deletedLetters.includes(letter.id));
  // 읽음 처리한 편지도 상세 화면이 열려 있는 동안은 보여 준다
  const openedLetter: LetterView | undefined = serverMail
    ? mail.detail && mail.detail.id === e?.detail
      ? {
          id: mail.detail.id,
          friendId: isSystemLetterView(mail.detail) ? null : mail.detail.senderId,
          from: isSystemLetterView(mail.detail)
            ? t('mailbox.systemSender')
            : (mail.detail.senderNickname ?? t('islandChat.unknown')),
          island: isSystemLetterView(mail.detail) ? '' : friendIsland(mail.detail.senderId),
          color: mail.detail.catColor ?? null,
          outfit: appearanceOutfit(mail.detail.appearance),
          time: letterTime(Date.parse(mail.detail.createdAt), now),
          body: mail.detail.content,
        }
      : undefined
    : state
      ? (state.friends ?? [])
          .flatMap((f) =>
            f.messages
              .filter((m) => m.id === e?.detail && m.memberId !== 'me')
              .map((m) => ({
                id: m.id,
                friendId: f.id,
                from: f.name,
                island: f.island,
                color: f.color,
                time: letterTime(m.at, now),
                body: m.text,
              })),
          )
          .at(0)
      : receivedLetters.find((letter) => letter.id === selectedLetter);
  const friendOf = (id: string) => friends.find((f) => f.id === id);
  const route: MailRoute = !e
    ? localRoute
    : e.route === 'friendMail'
      ? friendOf(e.detail)
        ? 'compose'
        : 'friend-select'
      : e.detail && (serverMail || openedLetter)
        ? 'letter'
        : e.tab === 'inbox'
          ? 'inbox'
          : 'home';
  const chosen = friendOf(selectedFriend) ?? friends[0];
  const composeTo = e ? friendOf(e.detail) : chosen;
  // 보내지 못한 편지: 이 친구에게 쓴 마지막 실패 편지
  const failedLetter =
    state && composeTo
      ? state.friends
          ?.find((f) => f.id === composeTo.id)
          ?.messages.filter((m) => m.memberId === 'me' && m.status === 'failed')
          .at(-1)
      : undefined;
  const text = e ? e.text : letterText;
  const setText = (value: string) => (e ? e.setText(value) : setLetterText(value));

  // 받은 편지는 여는 순간 읽음 처리한다. 어떤 방법으로 나가도 받은 편지함에서 사라진다 (목업 경로)
  useEffect(() => {
    if (e && !serverMail && route === 'letter' && openedLetter)
      e.dispatch({ type: 'LETTER_READ', friend: openedLetter.friendId ?? '', id: openedLetter.id });
  }, [route, e?.detail, serverMail]);
  // 서버 경로 — 라우트가 편지를 가리키면 GET /letters/{id} 상세를 연다(읽음은 서버가 찍는다).
  useEffect(() => {
    if (serverMail && route === 'letter' && e?.detail) mail.openLetter(e.detail).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mail.openLetter 는 훅의 안정 콜백, 라우트·편지 id 가 바뀔 때만 다시 연다.
  }, [serverMail, route, e?.detail]);

  const go = (next: MailRoute, toast?: string) => {
    react();
    if (!e) {
      setRoute(next);
      if (toast) showToast(toast);
      return;
    }
    if (next === 'inbox') {
      e.go('mail');
      e.setTab('inbox');
    } else if (next === 'friend-select') e.go('friendMail', 'list');
  };
  const back = (to: MailRoute) => (e ? e.back() : go(to));

  useEffect(() => {
    if (!serverMail || route !== 'letter' || !mail.detailBlocked) return;
    // 차단 목록 재검증으로 열린 편지의 상대가 차단됐으면 상세 route를 끝낸다.
    // 내부 detail도 지워 이후 차단 해제 전까지 같은 원문이 다시 그려지지 않게 한다.
    mail.clearDetail();
    if (e) e.back();
    else setRoute('inbox');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 차단 판정이 true로 바뀌는 순간 한 번만 상세를 닫는다.
  }, [serverMail, route, mail.detailBlocked]);

  const catAvatar = (color: string | null, size = 34, outfit?: Outfit, userId?: string | null) => (
    <View
      style={{
        width: size,
        height: size,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1.2,
        borderColor: '#6d5545',
        borderRadius: size / 2,
        backgroundColor: '#f5dfbd',
        boxShadow: '0 2px 0 #b58f6b',
      }}
    >
      <CatAvatar userId={userId} color={color} outfit={color ? outfit : undefined} size={size} />
    </View>
  );

  // 보내지 못한 글·편지 아래에 작게 붙는 "보내지 못했어요 · 다시 보내기"
  const failedLine = (
    testID: string,
    onRetry: () => void,
    align: 'left' | 'right' | 'center' = 'right',
  ) => (
    <Text style={[mailFont(5.5, 1.25, '#a35952', '700'), { marginTop: 2, textAlign: align }]}>
      {t('ui.remaining.copy1')}{' '}
      <Text
        testID={testID}
        accessibilityRole="button"
        onPress={onRetry}
        style={{ textDecorationLine: 'underline' }}
      >
        {t('islandChat.resend')}
      </Text>
    </Text>
  );

  const header = (title: string, note: string, to: MailRoute = 'home') => (
    <View style={{ marginBottom: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', columnGap: 7 }}>
        <NavBtn
          testID="mail-back"
          label={t('ui.mail.back')}
          onPress={() => back(to)}
          // 누르는 상자(44)의 여백만큼 당겨 제목 줄 높이를 예전처럼 둔다
          style={{ margin: -5, transform: [{ scale: navScale }] }}
        />
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: GOWUN, fontSize: 17, lineHeight: lh(21), color: INK }}>
            {title}
          </Text>
          {/* 부제는 글자 크기 단계(xs 12)로 — 시안 6.5 를 1.3 배 해도 8 이라 읽기 어려웠다 */}
          {note ? (
            <Text style={obsFont(primitiveTokens.fontSize.xs, 1.35, '#826c5b')}>{note}</Text>
          ) : null}
        </View>
      </View>
    </View>
  );

  // 우체통 주 버튼 (전망대 Stamp와 같은 모양)
  const stamp = (label: string, onPress: () => void) => (
    <Pressable
      testID="stamp-action"
      accessibilityRole="button"
      onPress={onPress}
      style={{
        minHeight: 34,
        marginTop: 9,
        paddingVertical: 6,
        paddingHorizontal: 10,
        justifyContent: 'center',
        borderWidth: 1.5,
        borderColor: OUTLINE,
        borderRadius: 9,
        // 우체통의 주 버튼(편지 쓰기·접어서 보내기)은 Pink(DESIGN §7.2)
        backgroundColor: componentTokens.button.background,
        boxShadow: `0 2px 0 ${OUTLINE}`,
      }}
    >
      <Text style={[obsFont(9, 1.6, INK, '800'), { textAlign: 'center' }]}>{label}</Text>
    </Pressable>
  );

  // 안 읽음 수는 친구 편지 + 섬 시스템 편지(강퇴·가입 승인)를 함께 센다 — 지도 배지·「새 편지 N통」·목록 「아직 열지 않은 편지 N통」 모두 같은 기준(GROMO-2489)
  const newLetters = serverMail
    ? [...mail.letters, ...mail.systemLetters].filter((l) => !l.isRead).length
    : state
      ? letters.length
      : 3;
  // 고양이 잡지(GROMO-2289 · GROMO-2500 C안) — 예전 채팅방 자리의 큰 칸. 칸을 누르면 가장 최근 호(안 읽었으면 빨간 점),
  // 칸 안 [지난 호] 는 잡지 꽂이(최근 7호 시트)
  const magazineToday: MagazineToday | null = e?.magazineToday ?? null;
  const magazineLatest = magazineToday?.issue ?? null;
  const magazineUnreadDot = magazineUnread(magazineToday);
  const M = componentTokens.mailboxAction;
  const magazineSlot = (
    <View
      key="magazine"
      testID="mail-home-0"
      style={[
        {
          minHeight: M.slotMinHeight,
          paddingBottom: M.slotPaddingBottom,
          borderWidth: M.borderWidth,
          borderColor: M.border,
          borderRadius: M.slotRadius,
          backgroundColor: M.slot,
          boxShadow: M.slotShadow,
          transform: [{ rotate: M.slotRotate }],
        },
        webOnly({ gridRow: 'span 2' }),
      ]}
    >
      <Pressable
        testID="mail-home-magazine"
        accessibilityRole="button"
        accessibilityLabel={
          magazineLatest
            ? t(magazineUnreadDot ? 'magazine.mail.unreadA11y' : 'magazine.mail.open', {
                no: magazineLatest.issueNo,
              })
            : t('magazine.mail.slot')
        }
        disabled={!!e && !magazineLatest}
        onPress={() => {
          react();
          if (!e) return showToast(t('ui.mail.magazineOpened'));
          if (magazineLatest) e.go('magazine', magazineLatest.issueId);
        }}
        style={{
          flexGrow: 1,
          alignItems: 'center',
          justifyContent: 'flex-end',
          paddingTop: M.slotPaddingTop,
          paddingHorizontal: M.slotPaddingHorizontal,
        }}
      >
        <Image
          testID="mail-home-0-art"
          source={MAGAZINE_UI.cover}
          resizeMode="contain"
          style={{
            width: M.coverWidth,
            height: M.coverHeight,
            marginBottom: M.coverMarginBottom,
            transform: [{ rotate: M.coverTilt }],
          }}
        />
        <Text style={[mailFont(8.5, 1.25, INK, '900'), { textAlign: 'center' }]}>
          {t('magazine.mail.slot')}
        </Text>
        {magazineLatest ? (
          <Text
            style={[mailFont(6.5, 1.35, '#705b4e', '700'), { marginTop: 2, textAlign: 'center' }]}
          >
            {t('magazine.mail.issueNo', { no: magazineLatest.issueNo })}
          </Text>
        ) : null}
      </Pressable>
      {e && magazineLatest && (
        <Pressable
          testID="mail-home-rack"
          accessibilityRole="button"
          accessibilityLabel={t('magazine.mail.pastIssues')}
          onPress={() => setMagazineRack(true)}
          style={{
            alignSelf: 'center',
            minHeight: semanticTokens.size.tapMin,
            justifyContent: 'center',
          }}
        >
          <View
            style={{
              paddingVertical: M.pastIssuesPaddingVertical,
              paddingHorizontal: M.paddingHorizontal,
              borderWidth: M.borderWidth,
              borderColor: M.border,
              borderRadius: M.pillRadius,
              backgroundColor: semanticTokens.color.surface,
              boxShadow: M.shadow,
            }}
          >
            <Text style={[mailFont(7, 1.35, INK, '800'), { textAlign: 'center' }]}>
              {t('magazine.mail.pastIssues')}
            </Text>
          </View>
        </Pressable>
      )}
      {magazineUnreadDot && (
        <View
          testID="mail-home-magazine-dot"
          style={{
            position: 'absolute',
            top: M.dotInset,
            right: M.dotInset,
            width: M.dotSize,
            height: M.dotSize,
            borderRadius: M.dotSize / 2,
            borderWidth: semanticTokens.stroke.strong,
            borderColor: M.dotBorder,
            backgroundColor: semanticTokens.color.danger,
          }}
        />
      )}
    </View>
  );
  const homeItems: [string, string][] = [
    [t('ui.mail.inbox'), newLetters ? t('ui.mail.newLetters', { v0: newLetters }) : ''],
    [t('ui.mail.writeLetter'), ''],
  ];
  // 오른쪽 두 칸(받은 편지·편지 쓰기). testID 는 예전 번호(1·2)를 그대로 쓴다
  const homeSlot = (i: 1 | 2) => {
    const routes: MailRoute[] = ['inbox', 'friend-select'];
    const colors = ['#bddde0', '#efbcc4'];
    const [title, note] = homeItems[i - 1];
    // 칸 위쪽 봉투 덮개 자리. 글자는 가운데 정렬이라 「새 편지 N통」 줄이 붙으면 위로 올라온다 —
    // 글자 시작(paddingTop)을 덮개 바닥 + 5 로 둬 덮개가 제목을 가리지 않게 한다
    const art = { top: 8, height: 25 };
    return (
      <Pressable
        key={title}
        testID={`mail-home-${i}`}
        accessibilityRole="button"
        accessibilityLabel={
          i === 1 && newLetters
            ? t('home.door.inboxNewLetters', { count: newLetters })
            : t('ui.mail.open', { v0: title })
        }
        onPress={() => go(routes[i - 1], t('ui.mail.opened', { v0: title }))}
        style={{
          minHeight: 72,
          paddingTop: art.top + art.height + 5,
          paddingHorizontal: 7,
          paddingBottom: 9,
          justifyContent: 'center',
          borderWidth: 1.5,
          borderColor: '#684434',
          borderRadius: 5,
          backgroundColor: colors[i - 1],
          boxShadow: 'inset 0 -8px #c99870,0 3px 0 #3f1d18',
          transform: [{ rotate: i === 1 ? '1deg' : '-1deg' }],
        }}
      >
        <Text style={[mailFont(8.5, 1.25, INK, '900'), { textAlign: 'center' }]}>{title}</Text>
        {/* 받은 편지 칸 모서리의 새 소식 배지 — 지도 우체통과 같은 느낌표(GROMO-2489). 읽는 이름은 칸의 라벨이 맡는다 */}
        {i === 1 && newLetters > 0 && (
          <VillageNotificationBadge
            testID="mail-home-inbox-new-indicator"
            accessibilityLabel=""
            style={{
              top: componentTokens.mailInboxNewBadge.topOffset,
              right: componentTokens.mailInboxNewBadge.rightOffset,
            }}
          />
        )}
        {note ? (
          <Text
            style={[mailFont(6.5, 1.35, '#705b4e', '700'), { marginTop: 2, textAlign: 'center' }]}
          >
            {note}
          </Text>
        ) : null}
        <View
          testID={`mail-home-${i}-art`}
          style={[
            {
              position: 'absolute',
              left: 8,
              right: 8,
              top: art.top,
              height: art.height,
            },
            gradient(
              'linear-gradient(145deg,transparent 49%,#ccb176 50%),linear-gradient(215deg,transparent 49%,#ead69f 50%)',
            ),
            webOnly({ filter: 'drop-shadow(0 2px 1px #65402a33)' }),
          ]}
        />
      </Pressable>
    );
  };

  const home = (
    <>
      <View
        style={[
          {
            flexDirection: 'row',
            columnGap: 7,
            rowGap: 7,
            padding: 8,
            borderWidth: 1.5,
            borderColor: '#4c241f',
            borderRadius: 8,
            backgroundColor: '#57251f',
          },
          webOnly({ display: 'grid', gridTemplateColumns: '1.2fr 1fr' }),
        ]}
      >
        {Platform.OS === 'web' ? (
          [magazineSlot, homeSlot(1), homeSlot(2)]
        ) : (
          <>
            <View style={{ flex: 1.2 }}>{magazineSlot}</View>
            <View style={{ flex: 1, rowGap: 7 }}>
              {homeSlot(1)}
              {homeSlot(2)}
            </View>
          </>
        )}
      </View>
      {e && (
        <MagazineRack
          visible={magazineRack}
          onClose={() => setMagazineRack(false)}
          onOpen={(id) => {
            setMagazineRack(false);
            e.go('magazine', id);
          }}
        />
      )}
    </>
  );

  const mailRetry = (error: ApiError, testID: string, onRetry: () => void) => (
    <View style={{ paddingVertical: 30, alignItems: 'center', rowGap: 8 }}>
      <Text style={[mailFont(8, 1.4, '#826c5b', '800'), { textAlign: 'center' }]}>
        {errorText(error)}
      </Text>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        onPress={onRetry}
        style={{
          minHeight: 28,
          paddingVertical: 5,
          paddingHorizontal: 12,
          justifyContent: 'center',
          borderWidth: 1.2,
          borderColor: '#795642',
          borderRadius: 7,
          backgroundColor: '#fff8e8',
          boxShadow: '0 2px 0 #795642',
        }}
      >
        <Text style={[mailFont(7, 1.35, INK, '800'), { textAlign: 'center' }]}>
          {t('common.retry')}
        </Text>
      </Pressable>
    </View>
  );
  // 가운데 종이 화면은 머리·본문·바닥으로 나눈다. 본문만 스크롤하고 주 버튼은 바닥에 고정한다
  type Pane = { head: React.ReactNode; body: React.ReactNode; foot: React.ReactNode };
  // 서버 경로 상태칸 — 로딩·오류·재시도는 목록 대신 이 모양으로 보인다(가짜 성공 없음).
  const mailStatus = (label: string) => (
    <View style={{ paddingVertical: 30, alignItems: 'center' }}>
      <Text style={mailFont(8, 1.4, '#826c5b', '800')}>{label}</Text>
    </View>
  );
  const unreadCount = serverMail
    ? [...mail.letters, ...mail.systemLetters].filter((l) => !l.isRead).length
    : letters.length;
  const inbox: Pane = {
    head: header(t('ui.mail.inbox'), t('ui.mail.unreadLetters', { v0: unreadCount })),
    body:
      serverMail && (mail.blockedUsersStatus === 'loading' || (mail.loading && !mail.islandId)) ? (
        mailStatus(t('ui.mail.loadingLetters'))
      ) : serverMail && mail.error && (mail.blockedUsersStatus === 'error' || !mail.islandId) ? (
        mailRetry(mail.error, 'mailbox-retry', () => mail.retry().catch(() => {}))
      ) : (
        <View style={{ rowGap: 7 }}>
          {serverMail && mail.error ? (
            <Text style={[mailFont(6.5, 1.35, '#a35952', '800'), { textAlign: 'center' }]}>
              {errorText(mail.error)}
            </Text>
          ) : null}
          {letters.length ? (
            letters.map((letter, i) => (
              <Pressable
                key={letter.id}
                testID={`received-letter-${i}`}
                accessibilityRole="button"
                accessibilityLabel={t('ui.mail.openFrom', { v0: letter.from })}
                onPress={() => {
                  // 받은 편지를 여는 사용자 행동 1회(탭당 1회) — 서버가 readAt 을 찍는 상세 열람 지점
                  captureProductEvent('feature_used', { building: 'mail', action: 'read' });
                  if (e) return e.go('mail', letter.id);
                  setSelectedLetter(letter.id);
                  setDeletedLetters((prev) => [...prev, letter.id]);
                  go('letter', t('ui.mail.openedFrom', { v0: letter.from }));
                }}
                style={{
                  minHeight: 56,
                  paddingVertical: 10,
                  paddingRight: 9,
                  paddingLeft: 50,
                  justifyContent: 'center',
                  borderWidth: 1.2,
                  borderColor: '#ad8765',
                  borderRadius: 7,
                  backgroundColor: '#fff8e8',
                  boxShadow: '0 2px 0 #b58f6b',
                  // 서버는 읽어도 닫기 전까지 목록에 남는다 — 읽은 편지는 옅게.
                  opacity: letter.isRead ? 0.6 : 1,
                }}
              >
                <Image
                  source={interiorArt.letterEnvelope}
                  resizeMode="contain"
                  style={{
                    position: 'absolute',
                    left: 8,
                    top: 8,
                    width: 39,
                    height: 39,
                    transform: [{ rotate: i % 2 ? '2deg' : '-2deg' }],
                  }}
                />
                <Text style={mailFont(9, 1.3, INK, '900')}>{letter.from}</Text>
              </Pressable>
            ))
          ) : (
            <View style={{ paddingVertical: 35, alignItems: 'center' }}>
              <Image
                source={interiorArt.letterEnvelope}
                resizeMode="contain"
                style={{ width: 48, height: 48 }}
              />
              <Text style={[mailFont(8, 1.4, '#826c5b', '800'), { marginTop: 7 }]}>
                {t('ui.mail.emptyInbox')}
              </Text>
            </View>
          )}
          {serverMail && mail.lettersCursor ? (
            <Pressable
              testID="letters-more"
              accessibilityRole="button"
              onPress={() => mail.loadMoreLetters()}
              style={{ alignSelf: 'center', paddingVertical: 6, paddingHorizontal: 10 }}
            >
              <Text style={mailFont(6.5, 1.35, '#826c5b', '800')}>
                {mail.loadingMoreLetters ? t('account.blocked.loading') : t('ui.mail.loadEarlier')}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ),
    foot: null,
  };

  // 시스템 편지(발신자 없음)는 답장할 상대가 없다.
  const replyToId = openedLetter?.friendId ?? null;
  const letter: Pane | undefined = openedLetter && {
    head: header(t('ui.mail.inbox'), t('ui.mail.disappears'), 'inbox'),
    body: (
      <View
        style={[
          {
            minHeight: 280,
            paddingTop: 18,
            paddingHorizontal: 16,
            paddingBottom: 14,
            borderWidth: 1.2,
            borderColor: '#b68d68',
            boxShadow: '0 3px 5px #4d291e3d',
            transform: [{ rotate: '-0.5deg' }],
          },
          webOnly({ backgroundImage: 'repeating-linear-gradient(#fff9e9 0 22px,#eadbc2 23px)' }),
          Platform.OS !== 'web' && { backgroundColor: '#fff9e9' },
        ]}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', columnGap: 9 }}>
          {catAvatar(openedLetter.color, 40, openedLetter.outfit, openedLetter.friendId)}
          <View style={{ flex: 1 }}>
            <Text style={mailFont(7, 1.4, '#8d715e', '800')}>FROM.</Text>
            <Text
              style={{
                marginTop: 1,
                fontFamily: GOWUN,
                fontSize: 18,
                lineHeight: lh(23),
                color: INK,
              }}
            >
              {openedLetter.from}
            </Text>
            <Text style={[mailFont(6, 1.4, '#9b8878'), { marginTop: 1 }]}>
              {[openedLetter.island, openedLetter.time].filter(Boolean).join(' · ')}
            </Text>
          </View>
          {serverMail && openedLetter.friendId ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('ui.social.more', { v0: openedLetter.from })}
              hitSlop={8}
              onPress={() => setLetterSafetyTarget(openedLetter)}
              style={{ width: 34, height: 34, alignItems: 'center', justifyContent: 'center' }}
            >
              <Text style={mailFont(10, 1.2, '#7b493f', '900')}>···</Text>
            </Pressable>
          ) : null}
        </View>
        <Text
          style={{ marginTop: 28, fontFamily: GOWUN, fontSize: 13, lineHeight: lh(23), color: INK }}
        >
          {openedLetter.body}
        </Text>
        <Text style={[mailFont(7, 1.4, '#8d715e', '800'), { marginTop: 24, textAlign: 'right' }]}>
          {t('ui.mail.addressedToMe')}
        </Text>
      </View>
    ),
    foot: (
      <View style={{ marginTop: 9, flexDirection: 'row', columnGap: 7 }}>
        {replyToId ? (
          <Pressable
            testID="reply-to-letter"
            accessibilityRole="button"
            onPress={() => {
              if (e) return e.replace('friendMail', replyToId);
              setSelectedFriend(replyToId);
              go('compose', t('ui.mail.replyTo', { v0: openedLetter.from }));
            }}
            style={{
              minHeight: 34,
              flex: 1,
              paddingVertical: 7,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 1.5,
              borderColor: '#7b493f',
              borderRadius: 9,
              backgroundColor: componentTokens.button.background,
              boxShadow: '0 2px 0 #7b493f',
            }}
          >
            <Text style={mailFont(8, 1.4, '#54352f', '900')}>{t('ui.mail.reply')}</Text>
          </Pressable>
        ) : null}
        <Pressable
          testID="close-letter"
          accessibilityRole="button"
          onPress={() => {
            if (serverMail && e) {
              // DELETE /letters/{id} — 서버가 양쪽 목록에서 지운다. 성공(목록 재조회까지)
              // 에만 돌아간다 — 실패하면 편지를 그대로 두고 오류를 보인다.
              mail
                .close(openedLetter.id)
                .then(() => back('inbox'))
                .catch((err) => say(errorTextOr(err, 'ui.errors.closeLetterFailed')));
              return;
            }
            back('inbox');
            if (!e) showToast(t('ui.mail.closed'));
          }}
          style={{
            minHeight: 34,
            flex: 1,
            paddingVertical: 7,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 1.5,
            borderColor: '#7b493f',
            borderRadius: 9,
            backgroundColor: '#fff8e8',
            boxShadow: '0 2px 0 #7b493f',
          }}
        >
          <Text style={mailFont(8, 1.4, '#54352f', '900')}>{t('common.close')}</Text>
        </Pressable>
      </View>
    ),
  };

  const friendSelect: Pane = {
    head: header(t('ui.mail.chooseFriend'), ''),
    body:
      serverMail && (mail.blockedUsersStatus === 'loading' || (mail.loading && !mail.islandId)) ? (
        mailStatus(t('ui.mail.loadingFriends'))
      ) : serverMail && mail.error && (mail.blockedUsersStatus === 'error' || !mail.islandId) ? (
        mailRetry(mail.error, 'mailbox-retry', () => mail.retry().catch(() => {}))
      ) : (
        <View style={{ rowGap: 7 }}>
          {friends.map((friend, i) => (
            <Pressable
              key={friend.id}
              testID={`letter-friend-${i}`}
              accessibilityRole="button"
              accessibilityLabel={`${friend.name} · ${friend.island}`}
              accessibilityState={{ selected: chosen === friend }}
              onPress={() => {
                setSelectedFriend(friend.id);
                if (!e) showToast(t('ui.mail.selectedRecipient', { v0: friend.name }));
              }}
              style={{
                minHeight: 57,
                padding: 8,
                flexDirection: 'row',
                alignItems: 'center',
                columnGap: 9,
                borderWidth: chosen === friend ? 2 : 1.2,
                borderColor: chosen === friend ? '#9a654d' : '#b79273',
                borderRadius: 9,
                backgroundColor: chosen === friend ? '#fff0cf' : '#fff9ea',
                transform: chosen === friend ? [{ translateX: 3 }] : undefined,
              }}
            >
              {catAvatar(friend.color, 38, friend.outfit, friend.id)}
              <View style={{ flex: 1 }}>
                <Text style={mailFont(9, 1.3, INK, '900')}>{friend.name}</Text>
                <Text style={[mailFont(6.5, 1.35, '#826c5b'), { marginTop: 2 }]}>
                  {t('ui.mail.friendLabel', { v0: friend.island })}
                </Text>
              </View>
              <Text style={mailFont(10, 1.2, chosen === friend ? '#9a654d' : '#c5ad99', '900')}>
                {chosen === friend ? '✓' : '›'}
              </Text>
            </Pressable>
          ))}
          {!friends.length && (
            <Text
              style={[
                mailFont(8, 1.4, '#826c5b', '800'),
                { paddingVertical: 24, textAlign: 'center' },
              ]}
            >
              {t('ui.mail.addFriends')}
            </Text>
          )}
        </View>
      ),
    foot:
      chosen &&
      stamp(t('ui.mail.writeTo', { v0: chosen.name }), () => {
        if (e) return e.go('friendMail', chosen.id);
        go('compose', t('ui.mail.composeOpened', { v0: chosen.name }));
      }),
  };

  const sendLetter = () => {
    if (!composeTo) return;
    if (!text.trim()) return say(t('ui.mail.requiredBody'));
    if (!e) {
      react();
      return showToast(t('ui.mail.sent', { v0: composeTo.name }));
    }
    if (serverMail) {
      // POST /letters — 201 이 오면 발송 확정. 실패는 초안을 그대로 두고 오류를 보인다.
      // 게스트 거절(SOCIAL_LOGIN_REQUIRED)은 회원 전환 시트로 보낸다(GROMO-2005).
      mail
        .send(composeTo.id, text)
        .then(() => {
          e.setText('');
          e.notify(t('ui.mail.sent', { v0: composeTo.name }));
          e.reset('mail');
        })
        .catch((err) => {
          if (err instanceof ApiError && e.conversion?.offer(err)) return;
          say(errorTextOr(err, 'ui.errors.sendLetterFailed'));
        });
      return;
    }
    // reducer가 거절할 편지(친구 아님·내 섬에 우체통 없음)는 보냈다고 하지 않는다
    if (!canSendLetter(e.state, composeTo.id)) return say(t('ui.mail.recipientUnavailable'));
    react();
    e.dispatch({ type: 'FRIEND_MESSAGE', id: composeTo.id, text, fail: e.failNext });
    e.setText('');
    if (e.failNext) return e.setFailNext(false);
    e.notify(t('ui.mail.sent', { v0: composeTo.name }));
    e.reset('mail');
  };
  const retryLetter = () => {
    if (!e || !composeTo || !failedLetter) return;
    e.dispatch({ type: 'FRIEND_RETRY', id: failedLetter.id, friend: composeTo.id });
    e.notify(t('ui.mail.sent', { v0: composeTo.name }));
    e.reset('mail');
  };
  // 편지지 입력칸은 남은 높이에 맞춰 줄인다 (머리·편지지 여백·버튼이 약 197)
  const letterInput = Math.max(64, Math.min(210, height - 14 - 197));
  const compose: Pane | undefined = composeTo && {
    head: header(
      t('ui.mail.composeTitle'),
      `${composeTo.name} · ${composeTo.island}`,
      'friend-select',
    ),
    body: (
      <View
        style={[
          {
            minHeight: letterInput + 90,
            paddingTop: 14,
            paddingHorizontal: 13,
            paddingBottom: 12,
            borderWidth: 1.2,
            borderColor: '#b68d68',
            boxShadow: '0 3px 5px #4d291e3d',
            transform: [{ rotate: '-0.4deg' }],
          },
          webOnly({ backgroundImage: 'repeating-linear-gradient(#fff9e9 0 22px,#eadbc2 23px)' }),
          Platform.OS !== 'web' && { backgroundColor: '#fff9e9' },
        ]}
      >
        <View
          style={{
            position: 'absolute',
            right: 10,
            top: 9,
            width: 31,
            height: 36,
            borderWidth: 1,
            borderStyle: 'dashed',
            borderColor: '#ba6c62',
            backgroundColor: '#e7a097',
          }}
        />
        <Text style={mailFont(7, 1.4, '#8d715e', '800')}>TO. {composeTo.name}</Text>
        <TextInput
          testID="friend-letter-input"
          accessibilityLabel={t('ui.mail.letterTo', { v0: composeTo.name })}
          value={text}
          onChangeText={setText}
          placeholder={t('ui.mail.bodyPlaceholder')}
          placeholderTextColor="#a28e7f"
          multiline
          style={
            {
              minHeight: letterInput,
              marginTop: 18,
              padding: 0,
              fontFamily: GOWUN,
              fontSize: 13,
              lineHeight: lh(23),
              color: INK,
              textAlignVertical: 'top',
              outlineStyle: 'none',
            } as any
          }
        />
        <Text style={[mailFont(7, 1.4, '#8d715e', '800'), { textAlign: 'right' }]}>
          {t('ui.mail.fromMe')}
        </Text>
      </View>
    ),
    foot: (
      <>
        {stamp(t('ui.mail.foldAndSend'), sendLetter)}
        {failedLetter ? (
          <View style={{ alignItems: 'center' }}>
            {failedLine('letter-retry', retryLetter, 'center')}
          </View>
        ) : null}
      </>
    ),
  };

  // 서버 경로에서 상세가 아직 없을 때 — 로딩이거나 오류다(캐시된 편지를 대신 보여주지 않는다).
  const letterPending: Pane | undefined =
    serverMail && route === 'letter' && !openedLetter
      ? {
          head: header(t('ui.mail.inbox'), '', 'inbox'),
          body: mail.detailError
            ? mailRetry(mail.detailError, 'letter-retry', () =>
                (mail.blockedUsersStatus === 'error'
                  ? mail.retry().then(() => mail.openLetter(e.detail))
                  : mail.openLetter(e.detail)
                ).catch(() => {}),
              )
            : mailStatus(t('ui.mail.openingLetter')),
          foot: null,
        }
      : undefined;

  const pane: Pane | undefined =
    route === 'inbox'
      ? inbox
      : route === 'letter'
        ? (letter ?? letterPending ?? inbox)
        : route === 'friend-select'
          ? friendSelect
          : route === 'compose'
            ? (compose ?? friendSelect)
            : undefined;

  if (route !== 'home') {
    return (
      <>
        <Animated.View style={{ transform: reactTransform }}>
          <View
            style={[
              {
                padding: 11,
                borderWidth: 1.2,
                borderColor: '#b38c68',
                borderRadius: 9,
                backgroundColor: '#fff1d0',
                boxShadow: '0 8px 18px #3a1d1766',
              },
              // 가운데 종이는 화면 안(위 12·아래 2)에 들어오게 하고 넘치는 본문만 스크롤한다
              pane && { maxHeight: height - 14 },
            ]}
          >
            {pane ? (
              <>
                {pane.head}
                {/* 기운 종이·그림자가 스크롤 테두리에 잘리지 않게 안쪽 여백을 주고 같은 만큼 바깥으로 뺀다 */}
                <Scroll style={{ flexShrink: 1, minHeight: 0, margin: -8, padding: 8 }}>
                  {pane.body}
                </Scroll>
                {pane.foot}
              </>
            ) : null}
          </View>
        </Animated.View>
        {letterSafetyTarget?.friendId && serverMail ? (
          <UserSafetySheet
            visible
            targetUserId={letterSafetyTarget.friendId}
            targetName={letterSafetyTarget.from}
            reportTarget={{
              targetType: 'LETTER',
              targetId: letterSafetyTarget.id,
              targetUserId: letterSafetyTarget.friendId,
              label: letterSafetyTarget.from,
              submittedText: letterSafetyTarget.body,
            }}
            onClose={() => setLetterSafetyTarget(null)}
            onChanged={() => {
              back('inbox');
              mail.retry().catch(() => {});
            }}
            onMessage={say}
          />
        ) : null}
      </>
    );
  }

  return (
    <Animated.View
      style={{
        padding: 12,
        borderWidth: 6,
        borderColor: '#633a2e',
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
        borderBottomLeftRadius: 9,
        borderBottomRightRadius: 9,
        backgroundColor: '#a84437',
        boxShadow: 'inset 0 0 0 2px #e67965,0 7px 16px #43251a66',
        transform: reactTransform,
      }}
    >
      <View
        style={{
          position: 'absolute',
          left: 7,
          right: 7,
          top: 7,
          height: '54%',
          borderRadius: 8,
          backgroundColor: '#6f3029',
          boxShadow: 'inset 0 5px 10px #32110c88',
        }}
      />
      {serverMail && (mail.blockedUsersStatus === 'loading' || (mail.loading && !mail.islandId)) ? (
        <View style={{ padding: 20 }}>{mailStatus(t('ui.mail.openingMailbox'))}</View>
      ) : serverMail && mail.error && (mail.blockedUsersStatus === 'error' || !mail.islandId) ? (
        <View style={{ padding: 20 }}>
          {mailRetry(mail.error, 'mailbox-retry', () => mail.retry().catch(() => {}))}
        </View>
      ) : (
        home
      )}
    </Animated.View>
  );
}
