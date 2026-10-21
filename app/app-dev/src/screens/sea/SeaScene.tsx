import React, { useEffect, useRef, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '@/design-system/typography';
import { useScreenInsets } from '@/design-system/primitives';
import {
  semanticTokens as s,
  primitiveTokens as p,
  componentTokens as c,
} from '@/design-system/tokens';
import { t } from '@/i18n';
import { seaAssets } from './seaAssets';
import { art } from '@/constants/art';
import { MAGAZINE_UI } from '@/constants/magazineAssets';
import { SeaRaft } from './SeaRaft';
import { SeaParticipant, seaClock, seaPeerPages } from './seaModel';

type Props = {
  participants: readonly SeaParticipant[];
  self: SeaParticipant;
  focusing: boolean;
  compact?: boolean;
  footerHeight?: number;
  reduceMotion?: boolean;
  onParticipant: (participant: SeaParticipant) => void;
  onMessage: () => void;
  /** 내 뗏목 오른쪽 잡지 물건(GROMO-2314 B3) — 받은 오늘 호가 있을 때만. 누르면 그 호, 안 읽었으면 빨간 점. */
  magazine?: { issueNo: number; unread: boolean; onOpen: () => void } | null;
  children?: React.ReactNode | ((height: number) => React.ReactNode);
};

const M = c.magazineReader.seaObject;
const DOT = c.magazineReader.unreadDot;

export function SeaScene({
  participants,
  self,
  focusing,
  compact = false,
  footerHeight = 88,
  reduceMotion = false,
  onParticipant,
  onMessage,
  magazine,
  children,
}: Props) {
  const insets = useScreenInsets();
  const [bounds, setBounds] = useState({ width: 402, height: 788 });
  const [page, setPage] = useState(0);
  const scroll = useRef<ScrollView>(null);
  const suppressPressUntil = useRef(0);
  const [order, setOrder] = useState<string[]>(() => participants.map((person) => person.userId));
  // 새 스냅샷의 배열 순서가 달라도 기존 자리를 유지한다. 입장자는 뒤에 추가한다.
  useEffect(() => {
    const ids = new Set(participants.map((person) => person.userId));
    setOrder((previous) => {
      const next = [
        ...previous.filter((id) => ids.has(id)),
        ...[...ids].filter((id) => !previous.includes(id)),
      ];
      return next.join('\0') === previous.join('\0') ? previous : next;
    });
  }, [participants]);
  const byId = new Map(participants.map((person) => [person.userId, person]));
  const ordered = order.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  const pages = seaPeerPages(ordered, self.userId);
  const visiblePage = Math.min(page, pages.length - 1);
  const pageRef = useRef(visiblePage);
  pageRef.current = visiblePage;
  useEffect(() => {
    const next = Math.min(pageRef.current, pages.length - 1);
    setPage(next);
    scroll.current?.scrollTo({ x: next * bounds.width, animated: false });
  }, [pages.length, bounds.width]);
  const releasePressSuppression = () => {
    suppressPressUntil.current = Date.now() + 350;
  };
  const releaseInterruptedDrag = () => {
    if (suppressPressUntil.current === Infinity) releasePressSuppression();
  };
  const pick = (participant: SeaParticipant) => {
    if (Date.now() >= suppressPressUntil.current) onParticipant(participant);
  };
  const sizeScale = Math.min(bounds.width / 402, 1.3);
  const safeWidth = bounds.width - insets.left - insets.right;
  const portraitFooter = Math.max(88, footerHeight);
  const compactHeader = insets.top + 72;
  const compactRow = Math.max(0, (bounds.height - footerHeight - compactHeader) / 2);
  const compactRaft = Math.min(64, Math.max(32, compactRow - 50));
  const selfRaft = compact ? compactRaft : Math.min(160 * sizeScale, bounds.height * 0.22);
  // 잡지 표지 — 보통은 뗏목 위 고양이 오른쪽에 얹고, 뗏목이 작은 compact 에서는 뗏목 크기에 비례해 줄여 옆에 나란히 둔다
  // (작은 뗏목을 덮어 뗏목 누르는 자리를 44 아래로 줄이지 않게)
  const coverWidth = compact ? selfRaft * M.compactArtRatio : M.art.width;
  const coverHeight = (coverWidth * M.art.height) / M.art.width;
  const compactSlots = [
    [1 / 6, 0],
    [1 / 2, 0],
    [5 / 6, 0],
    [1 / 2, 1],
    [5 / 6, 1],
  ];
  const peerSlots = focusing
    ? [
        [0.65, 0.323, 58],
        [0.2, 0.42, 67],
        [0.78, 0.446, 70],
        [0.22, 0.596, 88],
        [0.76, 0.617, 82],
      ]
    : [
        [0.79, 0.25, 48],
        [0.24, 0.33, 66],
        [0.71, 0.42, 76],
        [0.23, 0.58, 94],
        [0.76, 0.62, 82],
      ];

  return (
    <View
      testID="sea-scene"
      style={[styles.scene, compact && styles.compactScene]}
      onLayout={(event) => setBounds(event.nativeEvent.layout)}
    >
      <Image
        source={seaAssets.background}
        resizeMode="cover"
        style={[StyleSheet.absoluteFill, { width: bounds.width, height: bounds.height }]}
        accessible={false}
      />
      <Image
        source={seaAssets.gulls}
        resizeMode="contain"
        style={[styles.gulls, { left: bounds.width * 0.16, top: bounds.height * 0.08 }]}
        accessible={false}
      />
      <ScrollView
        ref={scroll}
        testID="sea-participants"
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        style={StyleSheet.absoluteFill}
        scrollEventThrottle={32}
        onScrollBeginDrag={() => {
          suppressPressUntil.current = Infinity;
        }}
        onScrollEndDrag={releasePressSuppression}
        onTouchEnd={releaseInterruptedDrag}
        onTouchCancel={releaseInterruptedDrag}
        onMomentumScrollEnd={releasePressSuppression}
        onScroll={(event) => {
          suppressPressUntil.current = Date.now() + 350;
          const offset = event.nativeEvent.contentOffset.x;
          setPage(Math.min(pages.length - 1, Math.max(0, Math.round(offset / bounds.width))));
        }}
      >
        {pages.map((peers, index) => (
          <View
            key={index}
            style={{ width: bounds.width, height: bounds.height }}
            accessibilityElementsHidden={index !== visiblePage}
            importantForAccessibility={index !== visiblePage ? 'no-hide-descendants' : 'auto'}
            aria-hidden={index !== visiblePage}
          >
            {peers.map((person, slot) => {
              const [x, y, size] = peerSlots[slot];
              const [compactX, compactY] = compactSlots[slot];
              return (
                <View
                  key={person.userId}
                  style={[
                    styles.peer,
                    {
                      left: compact
                        ? insets.left + safeWidth * compactX - 65
                        : bounds.width * x - 65,
                      top: compact ? compactHeader + compactRow * compactY : bounds.height * y - 36,
                    },
                  ]}
                >
                  <Pressable
                    testID={`sea-person-${person.userId}`}
                    accessibilityRole="button"
                    accessibilityLabel={[
                      person.name,
                      person.focusing
                        ? `${person.subject || t('openSea.focusing')}, ${seaClock(person.activeSeconds)}`
                        : t('openSea.floating'),
                      person.emote ? t(`openSea.emoteNames.${person.emote}`) : undefined,
                    ]
                      .filter(Boolean)
                      .join(', ')}
                    onPress={() => pick(person)}
                    style={styles.person}
                  >
                    <View style={styles.bubble}>
                      <Text numberOfLines={1} style={styles.caption}>
                        {/* 한마디는 집중 중에도 머리 위에 늘 뜬다(GROMO-2310) — 바다 세션은 과목이 비어 있다 */}
                        {person.message ||
                          (person.focusing
                            ? person.subject || t('openSea.focusing')
                            : t('openSea.floating'))}
                      </Text>
                      <View style={styles.bubbleTail} accessible={false} />
                    </View>
                    <SeaRaft
                      color={person.color}
                      focusing={person.focusing}
                      outfit={person.outfit}
                      size={compact ? compactRaft : size * sizeScale}
                      reduceMotion={reduceMotion || index !== visiblePage}
                    />
                    <Text numberOfLines={1} style={styles.name}>
                      {person.name}
                    </Text>
                    {person.focusing && (
                      <Text style={styles.clock}>{seaClock(person.activeSeconds)}</Text>
                    )}
                    {!!person.emote && (
                      <Image
                        source={art[`emote/${person.emote}`]}
                        style={styles.emote}
                        accessible={false}
                      />
                    )}
                  </Pressable>
                </View>
              );
            })}
          </View>
        ))}
      </ScrollView>
      {typeof children === 'function' ? children(bounds.height) : children}
      <View
        testID="sea-self"
        style={[
          styles.self,
          { bottom: portraitFooter + (focusing ? 10 : 28) },
          compact && {
            top: compactHeader + compactRow,
            bottom: 'auto',
            left: insets.left + safeWidth / 6 - 65,
            width: 130,
          },
        ]}
      >
        {focusing ? (
          <View style={[styles.bubble, styles.selfSubject]}>
            <Text numberOfLines={1} style={styles.caption}>
              {self.message || self.subject || t('openSea.focusing')}
            </Text>
            <View style={styles.bubbleTail} accessible={false} />
          </View>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('openSea.writeMessage')}
            onPress={onMessage}
            style={styles.messageTouch}
          >
            <View style={styles.bubble}>
              <Text style={styles.caption}>{self.message || t('openSea.writeMessage')}</Text>
            </View>
          </Pressable>
        )}
        <View testID="sea-self-row" style={compact && styles.besideRaft}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={[
              t('openSea.myRaft'),
              focusing
                ? `${self.subject || t('openSea.focusing')}, ${seaClock(self.activeSeconds)}`
                : undefined,
              self.emote ? t(`openSea.emoteNames.${self.emote}`) : undefined,
            ]
              .filter(Boolean)
              .join(', ')}
            onPress={() => pick(self)}
            style={styles.person}
          >
            <SeaRaft
              color={self.color}
              focusing={focusing}
              outfit={self.outfit}
              size={selfRaft}
              reduceMotion={reduceMotion}
            />
            <Text style={[styles.name, styles.me]}>{t('openSea.me')}</Text>
            {focusing && (
              <Text testID="sea-self-clock" style={styles.clock}>
                {seaClock(self.activeSeconds)}
              </Text>
            )}
            {!!self.emote && (
              <Image source={art[`emote/${self.emote}`]} style={styles.emote} accessible={false} />
            )}
          </Pressable>
          {magazine && (
            // 뗏목 누름과 겹치지 않게 뗏목 Pressable 밖의 형제로 둔다
            <Pressable
              testID="sea-magazine-object"
              accessibilityRole="button"
              accessibilityLabel={t(
                magazine.unread ? 'magazine.delivery.objectUnread' : 'magazine.delivery.object',
                { no: magazine.issueNo },
              )}
              onPress={magazine.onOpen}
              style={[
                styles.magazine,
                compact
                  ? {
                      width: Math.max(s.size.tapMin, coverWidth),
                      height: Math.max(s.size.tapMin, coverHeight),
                    }
                  : [styles.magazineOnRaft, { left: selfRaft * M.left, top: selfRaft * M.top }],
              ]}
            >
              <View style={{ width: coverWidth, height: coverHeight }}>
                <Image
                  testID="sea-magazine-object-art"
                  source={MAGAZINE_UI.cover}
                  resizeMode="contain"
                  accessible={false}
                  style={{
                    width: coverWidth,
                    height: coverHeight,
                    transform: [{ rotate: M.tilt }],
                  }}
                />
                {magazine.unread && <View testID="sea-magazine-object-dot" style={styles.dot} />}
              </View>
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  self: { position: 'absolute', alignSelf: 'center', alignItems: 'center' },
  peer: { position: 'absolute', width: 130, alignItems: 'center' },
  gulls: { position: 'absolute', width: 56, height: 26 },
  scene: { flex: 1, minHeight: 660, backgroundColor: s.color.secondary, overflow: 'hidden' },
  compactScene: { minHeight: 0 },
  person: { alignItems: 'center', minWidth: s.size.tapMin, minHeight: s.size.tapMin },
  bubble: {
    backgroundColor: `${s.color.surface}E6`,
    borderRadius: s.radius.control,
    paddingHorizontal: p.space[2],
    paddingVertical: p.space[1],
    alignItems: 'center',
    maxWidth: 130,
  },
  bubbleTail: {
    position: 'absolute',
    bottom: -7,
    left: '50%',
    marginLeft: -6,
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 7,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: `${s.color.surface}E6`,
  },
  caption: { fontSize: s.typography.caption, color: s.color.textMuted, textAlign: 'center' },
  clock: {
    fontSize: s.typography.caption,
    lineHeight: 16,
    color: c.seaParticipant.focusInk,
    backgroundColor: c.seaParticipant.clockBackground,
    borderRadius: s.radius.control,
    paddingHorizontal: p.space[1],
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  selfSubject: { marginBottom: -p.space[2] },
  name: {
    fontSize: s.typography.caption,
    color: s.color.text,
    backgroundColor: `${s.color.surface}8C`,
    borderRadius: p.radius.control,
    lineHeight: 16,
    includeFontPadding: false,
    paddingHorizontal: 2,
    paddingVertical: 0,
    marginTop: -p.space[2],
  },
  me: { color: s.color.text, backgroundColor: s.color.selected },
  messageTouch: { minHeight: s.size.tapMin, justifyContent: 'center', marginBottom: -p.space[5] },
  emote: { position: 'absolute', right: 0, top: 0, width: 40, height: 40 },
  besideRaft: { flexDirection: 'row', alignItems: 'center' },
  magazine: { alignItems: 'center', justifyContent: 'center' },
  magazineOnRaft: { position: 'absolute', width: M.width, height: M.height },
  dot: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    borderWidth: s.stroke.strong,
    borderColor: s.color.surface,
    backgroundColor: s.color.danger,
  },
});
