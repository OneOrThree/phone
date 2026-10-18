import React, { useEffect, useRef, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '@/design-system/typography';
import { semanticTokens as s, primitiveTokens as p } from '@/design-system/tokens';
import { t } from '@/i18n';
import { seaAssets } from './seaAssets';
import { art } from '@/constants/art';
import { SeaRaft } from './SeaRaft';
import { SeaParticipant, seaClock, seaPeerPages } from './seaModel';

type Props = {
  participants: readonly SeaParticipant[];
  self: SeaParticipant;
  focusing: boolean;
  reduceMotion?: boolean;
  onParticipant: (participant: SeaParticipant) => void;
  onMessage: () => void;
  children?: React.ReactNode | ((height: number) => React.ReactNode);
};

export function SeaScene({
  participants,
  self,
  focusing,
  reduceMotion = false,
  onParticipant,
  onMessage,
  children,
}: Props) {
  const [bounds, setBounds] = useState({ width: 402, height: 788 });
  const [page, setPage] = useState(0);
  const scroll = useRef<ScrollView>(null);
  const suppressPressUntil = useRef(0);
  const scrollTarget = useRef<number | null>(null);
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
    scrollTarget.current = null;
    setPage(next);
    scroll.current?.scrollTo({ x: next * bounds.width, animated: false });
  }, [pages.length, bounds.width]);
  const go = (next: number) => {
    scrollTarget.current = next;
    setPage(next);
    suppressPressUntil.current = Date.now() + 350;
    scroll.current?.scrollTo({ x: next * bounds.width, animated: !reduceMotion });
  };
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
      style={styles.scene}
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
        onTouchStart={() => {
          scrollTarget.current = null;
        }}
        onScrollBeginDrag={() => {
          scrollTarget.current = null;
          suppressPressUntil.current = Infinity;
        }}
        onScrollEndDrag={releasePressSuppression}
        onTouchEnd={releaseInterruptedDrag}
        onTouchCancel={releaseInterruptedDrag}
        onMomentumScrollEnd={releasePressSuppression}
        onScroll={(event) => {
          suppressPressUntil.current = Date.now() + 350;
          const offset = event.nativeEvent.contentOffset.x;
          if (scrollTarget.current !== null) {
            // 버튼으로 이동 중에는 중간 스크롤 이벤트가 선택 페이지를 되돌리지 않는다.
            if (Math.abs(offset - scrollTarget.current * bounds.width) < 1)
              scrollTarget.current = null;
            else return;
          }
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
              return (
                <View
                  key={person.userId}
                  style={[
                    styles.peer,
                    {
                      left: bounds.width * x - 65,
                      top: bounds.height * y - 36,
                    },
                  ]}
                >
                  <Pressable
                    testID={`sea-person-${person.userId}`}
                    accessibilityRole="button"
                    accessibilityLabel={`${person.name}, ${person.focusing ? `${person.subject || t('openSea.focusing')}, ${seaClock(person.activeSeconds)}` : t('openSea.floating')}`}
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
                      size={size * sizeScale}
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
      <View style={[styles.self, focusing && styles.focusingSelf]}>
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
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            focusing
              ? `${t('openSea.myRaft')}, ${self.subject || t('openSea.focusing')}, ${seaClock(self.activeSeconds)}`
              : t('openSea.myRaft')
          }
          onPress={() => pick(self)}
          style={styles.person}
        >
          <SeaRaft
            color={self.color}
            focusing={focusing}
            outfit={self.outfit}
            size={Math.min(160 * sizeScale, bounds.height * 0.22)}
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
      </View>
      {pages.length > 1 && (
        <View style={styles.paging}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('openSea.previous')}
            disabled={visiblePage === 0}
            onPress={() => go(visiblePage - 1)}
            style={styles.pageButton}
          >
            <Text style={visiblePage === 0 && styles.disabled}>‹</Text>
          </Pressable>
          <Text style={styles.caption}>
            {visiblePage + 1} / {pages.length}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('openSea.next')}
            disabled={visiblePage === pages.length - 1}
            onPress={() => go(visiblePage + 1)}
            style={styles.pageButton}
          >
            <Text style={visiblePage === pages.length - 1 && styles.disabled}>›</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  self: { position: 'absolute', bottom: 116, alignSelf: 'center', alignItems: 'center' },
  // 이름 아래 시간 줄이 생겨도 내 뗏목의 높이는 유지한다.
  focusingSelf: { bottom: 98 },
  peer: { position: 'absolute', width: 130, alignItems: 'center' },
  gulls: { position: 'absolute', width: 56, height: 26 },
  disabled: { opacity: 0.3 },
  scene: { flex: 1, minHeight: 660, backgroundColor: s.color.secondary, overflow: 'hidden' },
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
    color: s.color.text,
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
  paging: {
    position: 'absolute',
    bottom: 88,
    right: p.space[3],
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: `${s.color.surface}E6`,
    borderRadius: s.radius.full,
  },
  pageButton: {
    minHeight: s.size.tapMin,
    minWidth: s.size.tapMin,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emote: { position: 'absolute', right: 0, top: 0, width: 40, height: 40 },
});
