import React, { useContext, useEffect, useRef, useState } from 'react';
import { BackHandler, ScrollView, StyleSheet, View } from 'react-native';
import { Btn, Overlay, Txt, k } from '@/design-system/patterns';
import { TextInput } from '@/design-system/typography';
import { MotionContext, useScreenInsets } from '@/design-system/primitives';
import {
  componentTokens as c,
  primitiveTokens as p,
  semanticTokens as s,
} from '@/design-system/tokens';
import { t } from '@/i18n';
import { SeaArrival, SeaParticipant, SeaVoyage, SeaEmote, seaEmotes, seaClock } from './seaModel';
import { SeaScene } from './SeaScene';
import { SeaRaft } from './SeaRaft';
import { SeaArrivalResult } from './SeaArrivalResult';
import { SeaMagazineDelivery } from './SeaMagazineDelivery';
import { SeaRewardArt } from './seaRewardCatalog';
import { art } from '@/constants/art';

export type SeaScreenProps = {
  self: SeaParticipant;
  participants: readonly SeaParticipant[];
  voyage: SeaVoyage | null;
  /** 서버 종료/미확인 결과 응답을 받은 뒤에만 전달한다. */
  result: SeaArrival | null;
  messageCooldownSeconds?: number;
  /** 재시도 멱등 키와 버전, 인벤토리 갱신은 세션 명령 어댑터에서 관리한다. */
  onFinish: (sessionId: string, intent: 'disembark' | 'stop') => Promise<void>;
  /** 결과 확인 및 목적지 방문/주민 라우트 전환을 모두 처리한다. */
  onExplore: (result: SeaArrival) => Promise<void>;
  onTelescope: () => void;
  onMessage: (message: string) => Promise<void>;
  onEmote: (emote: SeaEmote) => Promise<void>;
  /** 서버가 요청 생성을 확인하면 true. 로그인 안내·실패 처리는 호스트가 맡는다. */
  onFriendRequest?: (userId: string) => Promise<boolean>;
  rewardCatalog?: Readonly<Record<string, SeaRewardArt>>;
  /**
   * 오늘 고양이 잡지(GROMO-2314) — 표류 중에만 그린다. `delivery` 면 펠리컨 배달(B1)을 다른 창이 없을 때 화면 전체로 띄우고
   * (실제로 뜬 순간 `onShown`), `received` 면 내 뗏목 옆에 잡지 물건(B3, 안 읽었으면 빨간 점)을 둔다. 바다에는 길게 누르기(꽂이)가 없다.
   */
  magazine?: {
    issueNo: number;
    delivery: boolean;
    received: boolean;
    unread: boolean;
    onShown: () => void;
    onOpen: () => void;
    onLater: () => void;
  } | null;
} & (
  | { guest?: false; onSignIn?: () => void }
  // 게스트 여부가 동적이면 로그인 진입 경로도 반드시 함께 제공한다.
  | { guest: boolean; onSignIn: () => void }
);

type Panel = 'stop' | 'message' | 'emote' | { userId: string } | null;

/** 외부 정본 스냅샷을 표시한다. 로컬 경과 시간으로 도착·종료·보상을 만들지 않는다. */
export function SeaScreen(props: SeaScreenProps) {
  const { self, participants, voyage, result } = props;
  const reduceMotion = useContext(MotionContext);
  const insets = useScreenInsets();
  const [viewport, setViewport] = useState({ width: 402, height: 788 });
  const [footerHeight, setFooterHeight] = useState(88);
  const compact = viewport.width > viewport.height && viewport.height < 660;
  const [panel, setPanel] = useState<Panel>(null);
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [requested, setRequested] = useState<ReadonlySet<string>>(new Set());
  const busy = useRef(false);
  const requestVersion = useRef(0);
  const mounted = useRef(true);
  const scope = `${self.userId}/${voyage?.sessionId || ''}/${result?.recordId || ''}`;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    requestVersion.current += 1;
    busy.current = false;
    setPending(false);
    setPanel(null);
    setError('');
  }, [scope]);
  useEffect(() => setRequested(new Set()), [self.userId]);

  const run = async (action: () => Promise<void>, close = false) => {
    if (busy.current) return false;
    busy.current = true;
    const requestScope = scopeRef.current;
    const version = requestVersion.current;
    setPending(true);
    setError('');
    try {
      await action();
      if (
        mounted.current &&
        scopeRef.current === requestScope &&
        requestVersion.current === version
      ) {
        if (close) setPanel(null);
        return true;
      }
    } catch {
      if (
        mounted.current &&
        scopeRef.current === requestScope &&
        requestVersion.current === version
      )
        setError(t('openSea.retry'));
    } finally {
      if (requestVersion.current === version) {
        busy.current = false;
        if (mounted.current) setPending(false);
      }
    }
    return false;
  };
  const open = (next: Panel) => {
    if (!busy.current) {
      setError('');
      setPanel(next);
    }
  };
  const close = () => open(null);
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (delivery) {
        magazine!.onLater();
        return true;
      }
      if (pending || result) return true;
      if (panel) {
        close();
        return true;
      }
      if (voyage) {
        open('stop');
        return true;
      }
      return false;
    });
    return () => subscription.remove();
  });
  const currentSelf: SeaParticipant = {
    ...self,
    focusing: !!voyage,
    subject: voyage?.subject ?? self.subject,
    activeSeconds: voyage?.activeSeconds ?? self.activeSeconds,
  };
  const selected =
    typeof panel === 'object' && panel
      ? panel.userId === self.userId
        ? currentSelf
        : participants.find((person) => person.userId === panel.userId)
      : undefined;
  const magazine = voyage ? null : props.magazine;
  const delivery = !!magazine?.delivery && !result && !panel;
  const modal = !!result || !!panel || delivery;
  const finish = (intent: 'disembark' | 'stop') => {
    if (voyage) run(() => props.onFinish(voyage.sessionId, intent), true);
  };
  const buttonTitle = pending
    ? t('openSea.processing')
    : voyage
      ? t(voyage.canDisembark ? 'openSea.disembark' : 'openSea.stop')
      : t('openSea.telescope');
  const cooldown = Math.max(0, props.messageCooldownSeconds || 0);

  return (
    <View
      testID="sea-screen"
      style={styles.root}
      onLayout={(event) => setViewport(event.nativeEvent.layout)}
    >
      <View
        style={styles.root}
        pointerEvents={modal ? 'none' : 'auto'}
        accessibilityElementsHidden={modal}
        importantForAccessibility={modal ? 'no-hide-descendants' : 'auto'}
        aria-hidden={modal}
      >
        <ScrollView style={styles.root} contentContainerStyle={styles.sceneContent} bounces={false}>
          <SeaScene
            participants={participants}
            self={currentSelf}
            focusing={!!voyage}
            compact={compact}
            footerHeight={footerHeight}
            reduceMotion={reduceMotion}
            onParticipant={(person) => open({ userId: person.userId })}
            onMessage={() => {
              setMessage(self.message || '');
              open('message');
            }}
            magazine={
              magazine?.received
                ? { issueNo: magazine.issueNo, unread: magazine.unread, onOpen: magazine.onOpen }
                : null
            }
          >
            {(sceneHeight) =>
              voyage && (
                <View
                  pointerEvents="none"
                  style={[
                    styles.hud,
                    compact && styles.compactHud,
                    {
                      top: Math.max(
                        (sceneHeight >= 760 ? sceneHeight * 0.1 : p.space[6]) - p.space[8],
                        insets.top + p.space[2],
                      ),
                      ...(compact && {
                        left: insets.left + p.space[5],
                        right: insets.right + 160,
                      }),
                    },
                  ]}
                >
                  {!compact && <Txt style={styles.subject}>{voyage.subject}</Txt>}
                  <Txt
                    testID="sea-focus-clock"
                    style={[styles.timer, compact && styles.compactTimer]}
                  >
                    {seaClock(voyage.activeSeconds)}
                  </Txt>
                  <View style={[styles.badge, compact && styles.compactBadge]}>
                    <Txt
                      numberOfLines={compact ? 2 : undefined}
                      style={[styles.badgeText, compact && styles.compactBadgeText]}
                    >
                      {voyage.canDisembark
                        ? t('openSea.destinationReached', { name: voyage.destinationName })
                        : voyage.activeSeconds >= voyage.requiredSeconds
                          ? t('openSea.checkingArrival')
                          : t('openSea.remaining', {
                              name: voyage.destinationName,
                              minutes: Math.ceil(
                                (voyage.requiredSeconds - voyage.activeSeconds) / 60,
                              ),
                            })}
                    </Txt>
                  </View>
                  <View
                    accessibilityRole="progressbar"
                    accessibilityValue={{
                      min: 0,
                      max: 100,
                      now: Math.round(
                        Math.min(1, voyage.activeSeconds / Math.max(1, voyage.requiredSeconds)) *
                          100,
                      ),
                    }}
                    style={[styles.track, compact && styles.compactTrack]}
                  >
                    <View
                      style={[
                        styles.progress,
                        {
                          width: `${Math.min(100, Math.max(0, (voyage.activeSeconds / Math.max(1, voyage.requiredSeconds)) * 100))}%`,
                        },
                      ]}
                    />
                  </View>
                </View>
              )
            }
          </SeaScene>
        </ScrollView>
        <View
          testID="sea-footer"
          onLayout={(event) => setFooterHeight(event.nativeEvent.layout.height)}
          style={[
            styles.footer,
            {
              paddingBottom: Math.max(insets.bottom, p.space[6]),
              paddingLeft: insets.left + p.space[5],
              paddingRight: insets.right + p.space[5],
            },
          ]}
        >
          {!!error && (
            <Txt accessibilityRole="alert" style={styles.error}>
              {error}
            </Txt>
          )}
          <View style={styles.actions}>
            <Btn
              title={t('openSea.emotes')}
              icon={art['emote/cheer']}
              kind="butter"
              disabled={pending}
              onPress={() => open('emote')}
              style={styles.emoteButton}
            />
            <Btn
              id="sea-primary-action"
              dynamicHeight
              title={buttonTitle}
              kind={voyage && !voyage.canDisembark ? 'glass' : ''}
              disabled={pending}
              style={styles.primary}
              onPress={() =>
                voyage
                  ? voyage.canDisembark
                    ? finish('disembark')
                    : open('stop')
                  : props.onTelescope()
              }
            />
          </View>
        </View>
      </View>
      {delivery && (
        <SeaMagazineDelivery
          onShown={magazine!.onShown}
          onOpen={magazine!.onOpen}
          onLater={magazine!.onLater}
        />
      )}
      {!!result && (
        <SeaArrivalResult
          result={result}
          pending={pending}
          error={error}
          onExplore={() => run(() => props.onExplore(result))}
          catalog={props.rewardCatalog}
        />
      )}
      {!result && !!panel && (
        <Overlay close={pending ? undefined : close} maxWidth={c.seaParticipant.cardMaxWidth}>
          <View accessibilityViewIsModal style={styles.panel}>
            {panel === 'stop' && (
              <>
                <Txt accessibilityRole="header" kind="h">
                  {t(voyage?.canDisembark ? 'openSea.readyTitle' : 'openSea.stopTitle', {
                    name: voyage?.destinationName ?? '',
                  })}
                </Txt>
                <Txt>
                  {t(voyage?.canDisembark ? 'openSea.readyBody' : 'openSea.stopBody', {
                    minutes: Math.floor((voyage?.activeSeconds ?? 0) / 60),
                  })}
                </Txt>
                <Btn
                  dynamicHeight
                  title={t(voyage?.canDisembark ? 'openSea.disembark' : 'openSea.stop')}
                  disabled={pending}
                  onPress={() => finish(voyage?.canDisembark ? 'disembark' : 'stop')}
                />
              </>
            )}
            {typeof panel === 'object' && (
              <>
                <Txt accessibilityRole="header" kind="h">
                  {selected?.name || t('openSea.departed')}
                </Txt>
                {selected && (
                  <>
                    <View testID="sea-participant-avatar" style={styles.avatar} accessible={false}>
                      <SeaRaft
                        color={selected.color}
                        focusing={selected.focusing}
                        outfit={selected.outfit}
                        size={c.seaParticipant.cardRaftSize}
                        reduceMotion={reduceMotion}
                      />
                    </View>
                    <Txt>
                      {selected.focusing
                        ? selected.subject || t('openSea.focusing')
                        : t('openSea.floating')}
                    </Txt>
                    <Txt kind="meta">{t('openSea.focusTime')}</Txt>
                    <Txt kind="h" style={selected.focusing ? styles.focusClock : undefined}>
                      {seaClock(selected.activeSeconds)}
                    </Txt>
                    {!!selected.message && <Txt>{selected.message}</Txt>}
                    {selected.userId !== self.userId && props.onFriendRequest && (
                      <Btn
                        dynamicHeight
                        title={t(
                          pending
                            ? 'openSea.processing'
                            : requested.has(selected.userId)
                              ? 'openSea.friendRequested'
                              : 'openSea.requestFriend',
                        )}
                        disabled={pending || requested.has(selected.userId)}
                        onPress={() => {
                          if (props.guest) return props.onSignIn();
                          const target = selected.userId;
                          let sent = false;
                          run(async () => {
                            sent = await props.onFriendRequest!(target);
                          }).then((current) => {
                            if (current && sent)
                              setRequested((previous) => new Set([...previous, target]));
                          });
                        }}
                      />
                    )}
                  </>
                )}
              </>
            )}
            {panel === 'message' && (
              <>
                <Txt accessibilityRole="header" kind="h">
                  {t('openSea.messageTitle')}
                </Txt>
                {props.guest ? (
                  <>
                    <Txt>{t('openSea.signInBody')}</Txt>
                    <Btn title={t('openSea.signIn')} onPress={props.onSignIn} />
                  </>
                ) : cooldown > 0 ? (
                  <Txt>{t('openSea.messageWait', { minutes: Math.ceil(cooldown / 60) })}</Txt>
                ) : (
                  <>
                    <TextInput
                      accessibilityLabel={t('openSea.messageTitle')}
                      value={message}
                      onChangeText={(value) => setMessage(Array.from(value).slice(0, 20).join(''))}
                      placeholder={t('openSea.messagePlaceholder')}
                      style={k.field}
                      editable={!pending}
                    />
                    <Txt kind="meta">{Array.from(message).length} / 20</Txt>
                    <Btn
                      dynamicHeight
                      title={t(
                        self.message?.trim() && !message.trim()
                          ? 'openSea.deleteMessage'
                          : 'openSea.saveMessage',
                      )}
                      disabled={pending || (!message.trim() && !self.message?.trim())}
                      onPress={() => run(() => props.onMessage(message.trim()), true)}
                    />
                  </>
                )}
              </>
            )}
            {panel === 'emote' && (
              <>
                <Txt accessibilityRole="header" kind="h">
                  {t('openSea.emotes')}
                </Txt>
                <View style={styles.emotes}>
                  {seaEmotes.map((emote) => (
                    <Btn
                      key={emote}
                      title={t(`openSea.emoteNames.${emote}`)}
                      icon={art[`emote/${emote}`]}
                      disabled={pending}
                      onPress={() => run(() => props.onEmote(emote), true)}
                    />
                  ))}
                </View>
              </>
            )}
            {!!error && (
              <Txt accessibilityRole="alert" style={styles.error}>
                {error}
              </Txt>
            )}
            <Btn
              dynamicHeight
              title={t(panel === 'stop' ? 'openSea.keepFocusing' : 'openSea.close')}
              kind="glass"
              disabled={pending}
              onPress={close}
            />
          </View>
        </Overlay>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: s.color.secondary },
  sceneContent: { flexGrow: 1 },
  hud: {
    position: 'absolute',
    left: p.space[5],
    right: p.space[5],
    alignItems: 'center',
    gap: p.space[1],
  },
  subject: { fontSize: s.typography.body, textAlign: 'center' },
  timer: { fontSize: 40, lineHeight: 60, fontVariant: ['tabular-nums'] },
  compactHud: {
    height: 52,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'flex-start',
    gap: p.space[2],
  },
  compactTimer: { fontSize: s.typography.title, lineHeight: 32 },
  compactBadge: { flexShrink: 1, paddingVertical: 0 },
  compactBadgeText: { fontSize: s.typography.caption, lineHeight: 16 },
  compactTrack: { position: 'absolute', bottom: 0, left: '50%', marginLeft: -80 },
  badge: {
    paddingHorizontal: p.space[3],
    paddingVertical: p.space[1],
    backgroundColor: s.color.accent,
    borderWidth: s.stroke.default,
    borderColor: s.color.outline,
    borderRadius: s.radius.full,
  },
  badgeText: { fontSize: s.typography.label, textAlign: 'center' },
  track: {
    width: 160,
    height: c.progress.height,
    backgroundColor: c.progress.track,
    borderRadius: s.radius.full,
    overflow: 'hidden',
    marginTop: p.space[1],
  },
  progress: { height: c.progress.height, backgroundColor: c.progress.fill },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: p.space[5],
    paddingTop: p.space[2],
    gap: p.space[2],
  },
  actions: { flexDirection: 'row', alignItems: 'center', gap: p.space[3] },
  primary: { flex: 1 },
  emoteButton: { maxWidth: 100 },
  panel: { gap: p.space[4] },
  avatar: { alignItems: 'center' },
  focusClock: { color: c.seaParticipant.focusInk },
  emotes: { flexDirection: 'row', flexWrap: 'wrap', gap: p.space[3] },
  error: { color: s.color.danger, textAlign: 'center' },
});
