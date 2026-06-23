import React, { useRef, useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Easing,
  FlatList,
  ActivityIndicator,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useFocusEffect } from '@react-navigation/native';
import { useFocus } from '../contexts/FocusContext';
import { useEquipment } from '../contexts/EquipmentContext';
import { useCoins } from '../contexts/CoinContext';
import { Character2D } from '../components/character/Character2D';
import { T, inkBox } from '../components/theme';
import { api } from '../utils/api';
import type { EasingFunction } from 'react-native';
import type { TabScreenProps } from '../types/navigation';
import type { Variant } from '../components/character/characterTypes';

function formatTime(totalSeconds: number) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const sec = totalSeconds % 60;
  return [h, m, sec].map((v) => String(v).padStart(2, '0')).join(':');
}

const VARIANT_MSG: Record<Variant, string> = {
  default: '열심히 집중 중!',
  focus: '노트북 켜고 집중 중... 🖥',
  reading: '책 읽으면서 집중 중... 📚',
  yoga: '요가하면서 마음 집중 중... 🧘',
  exercise: '운동하면서 집중 중... 💪',
  study: '문제집 풀면서 집중 중... ✏',
};

interface MotionConfig {
  axis: 'x' | 'y' | 'rotate' | 'scale';
  range: number;
  duration: number;
  easing: EasingFunction;
}

const MOTION: Record<Variant, MotionConfig> = {
  default: { axis: 'y', range: 4, duration: 1800, easing: Easing.inOut(Easing.sin) },
  focus: { axis: 'y', range: 2.5, duration: 250, easing: Easing.linear },
  reading: { axis: 'rotate', range: 4, duration: 2400, easing: Easing.inOut(Easing.sin) },
  yoga: { axis: 'scale', range: 0.05, duration: 3200, easing: Easing.inOut(Easing.sin) },
  exercise: { axis: 'y', range: 14, duration: 500, easing: Easing.out(Easing.quad) },
  study: { axis: 'x', range: 3.5, duration: 180, easing: Easing.linear },
};

const REST_L = -30;
const REST_R = 30;

// 팔 애니메이션 설정 ([to, from] 각도 쌍, l/r 둘 다 null이면 정지)
interface ArmConfig {
  l: [number, number] | null;
  r: [number, number] | null;
  dur: number;
  easing: EasingFunction;
  sync: boolean;
}

const ARM_CONFIGS: Record<Variant, ArmConfig | null> = {
  default: null,
  focus: { l: [-40, REST_L], r: [40, REST_R], dur: 160, easing: Easing.linear, sync: false },
  reading: { l: null, r: [60, REST_R], dur: 1100, easing: Easing.inOut(Easing.sin), sync: true },
  yoga: {
    l: [-145, REST_L],
    r: [145, REST_R],
    dur: 2600,
    easing: Easing.inOut(Easing.sin),
    sync: true,
  },
  exercise: {
    l: [-100, REST_L],
    r: [100, REST_R],
    dur: 480,
    easing: Easing.out(Easing.quad),
    sync: true,
  },
  study: { l: null, r: [45, 20], dur: 170, easing: Easing.linear, sync: true },
};

function makeArmLoop(
  val: Animated.Value,
  [to, from]: [number, number],
  dur: number,
  easing: EasingFunction,
) {
  return Animated.loop(
    Animated.sequence([
      Animated.timing(val, { toValue: to, duration: dur, easing, useNativeDriver: true }),
      Animated.timing(val, { toValue: from, duration: dur * 0.9, easing, useNativeDriver: true }),
    ]),
  );
}

interface AnimatedCharacterProps {
  variant: Variant;
  size: number;
}

function AnimatedCharacter({ variant, size }: AnimatedCharacterProps) {
  const bodyAnim = useRef(new Animated.Value(0)).current;
  const leftArm = useRef(new Animated.Value(REST_L)).current;
  const rightArm = useRef(new Animated.Value(REST_R)).current;

  useEffect(() => {
    bodyAnim.setValue(0);
    leftArm.setValue(REST_L);
    rightArm.setValue(REST_R);

    const bodyCfg = MOTION[variant] ?? MOTION.default;
    const bodyLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(bodyAnim, {
          toValue: 1,
          duration: bodyCfg.duration,
          easing: bodyCfg.easing,
          useNativeDriver: true,
        }),
        Animated.timing(bodyAnim, {
          toValue: -1,
          duration: bodyCfg.duration,
          easing: bodyCfg.easing,
          useNativeDriver: true,
        }),
      ]),
    );
    bodyLoop.start();

    const armCfg = ARM_CONFIGS[variant];
    const armLoops: Animated.CompositeAnimation[] = [];
    if (armCfg) {
      if (armCfg.l) {
        const lp = makeArmLoop(leftArm, armCfg.l, armCfg.dur, armCfg.easing);
        armLoops.push(lp);
        lp.start();
      }
      if (armCfg.r) {
        const lp = makeArmLoop(rightArm, armCfg.r, armCfg.dur, armCfg.easing);
        armLoops.push(lp);
        if (!armCfg.sync) {
          Animated.delay(armCfg.dur).start(() => lp.start());
        } else {
          lp.start();
        }
      }
    }

    return () => {
      bodyLoop.stop();
      armLoops.forEach((l) => l.stop());
    };
  }, [variant, bodyAnim, leftArm, rightArm]);

  const bodyCfg = MOTION[variant] ?? MOTION.default;
  let bodyStyle;
  if (bodyCfg.axis === 'y')
    bodyStyle = {
      transform: [
        {
          translateY: bodyAnim.interpolate({
            inputRange: [-1, 1],
            outputRange: [-bodyCfg.range, bodyCfg.range],
          }),
        },
      ],
    };
  else if (bodyCfg.axis === 'x')
    bodyStyle = {
      transform: [
        {
          translateX: bodyAnim.interpolate({
            inputRange: [-1, 1],
            outputRange: [-bodyCfg.range, bodyCfg.range],
          }),
        },
      ],
    };
  else if (bodyCfg.axis === 'rotate')
    bodyStyle = {
      transform: [
        {
          rotate: bodyAnim.interpolate({
            inputRange: [-1, 1],
            outputRange: [`-${bodyCfg.range}deg`, `${bodyCfg.range}deg`],
          }),
        },
      ],
    };
  else
    bodyStyle = {
      transform: [
        {
          scale: bodyAnim.interpolate({
            inputRange: [-1, 1],
            outputRange: [1 - bodyCfg.range, 1 + bodyCfg.range],
          }),
        },
      ],
    };

  return (
    <Animated.View style={bodyStyle}>
      <Character2D size={size} variant={variant} leftArmAngle={leftArm} rightArmAngle={rightArm} />
    </Animated.View>
  );
}

// 그룹 — 서버 응답에 id/groupId가 섞여 들어와 둘 다 옵셔널로 둔다
interface GroupSummary {
  id?: number;
  groupId?: number;
  name?: string;
}

// 그룹 멤버 — 좌석 표시에 쓰는 필드만
interface GroupMemberSummary {
  id?: number;
  userId?: number;
  nickname?: string;
  name?: string;
}

interface GroupDetail extends GroupSummary {
  members?: GroupMemberSummary[];
}

function SeatSlot({ member }: { member: GroupMemberSummary }) {
  return (
    <View style={s.seat}>
      <View style={s.seatCharWrap}>
        <Character2D size={60} variant="focus" costumeSlots={[]} />
      </View>
      <View style={s.deskSurface} />
      <Text style={s.seatName} numberOfLines={1}>
        {member.nickname ?? member.name ?? '?'}
      </Text>
    </View>
  );
}

const VARIANT_CARD_COLOR: Record<Variant, string> = {
  default: T.paperDark,
  focus: T.sky,
  reading: T.yellow,
  yoga: T.mint,
  exercise: T.coral,
  study: T.lavender,
};

export default function FocusModeScreen({ navigation, route }: TabScreenProps<'FocusMode'>) {
  const { tagId, tagName, subject } = route.params ?? {};
  const { todayFocusSeconds, addFocusSeconds } = useFocus();
  const { equippedItem } = useEquipment();
  const { addCoins } = useCoins();
  const [sessionSeconds, setSessionSeconds] = useState(0);
  const startTimeRef = useRef<number | null>(null);
  const startedAtRef = useRef<string | null>(null);
  const lastCoinRef = useRef(0);
  const addCoinsRef = useRef(addCoins);
  useEffect(() => {
    addCoinsRef.current = addCoins;
  }, [addCoins]);

  // ── 페이지 네비게이션: 0 = 개인, 1..N = 그룹 ──
  const [pageIdx, setPageIdx] = useState(0);
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [membersMap, setMembersMap] = useState<Record<number, GroupMemberSummary[]>>({});
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [loadingMembers, setLoadingMembers] = useState(false);

  async function fetchGroupMembers(groupId: number) {
    if (membersMap[groupId]) return;
    setLoadingMembers(true);
    try {
      const res = await api.get<GroupDetail>(`/api/v1/groups/${groupId}`);
      const members = res.data?.members ?? [];
      setMembersMap((prev) => ({ ...prev, [groupId]: members }));
    } catch {
      setMembersMap((prev) => ({ ...prev, [groupId]: [] }));
    } finally {
      setLoadingMembers(false);
    }
  }

  useEffect(() => {
    setLoadingGroups(true);
    api
      .get<unknown>('/api/v1/groups')
      .then((res) => {
        const data = res.data;
        const list: GroupSummary[] = Array.isArray(data) ? (data as GroupSummary[]) : [];
        setGroups(list);
      })
      .catch(() => setGroups([]))
      .finally(() => setLoadingGroups(false));
  }, []);

  function goPage(nextIdx: number) {
    if (nextIdx < 0 || nextIdx > groups.length) return;
    setPageIdx(nextIdx);
    if (nextIdx > 0) {
      const g = groups[nextIdx - 1];
      const gid = g?.id ?? g?.groupId;
      if (gid != null) fetchGroupMembers(gid);
    }
  }

  const variant = equippedItem?.focusVariant ?? 'default';
  const msg = VARIANT_MSG[variant] ?? VARIANT_MSG.default;
  const cardColor = VARIANT_CARD_COLOR[variant] ?? T.paperDark;

  const currentGroup = pageIdx > 0 ? groups[pageIdx - 1] : null;
  const currentGroupId = currentGroup?.id ?? currentGroup?.groupId;
  const currentMembers = currentGroupId ? (membersMap[currentGroupId] ?? []) : [];

  useFocusEffect(
    React.useCallback(() => {
      startTimeRef.current = Date.now();
      startedAtRef.current = new Date().toISOString();
      lastCoinRef.current = 0;
      setSessionSeconds(0);
      const id = setInterval(() => {
        const elapsed = Math.floor((Date.now() - (startTimeRef.current ?? Date.now())) / 1000);
        setSessionSeconds(elapsed);
        const earned = Math.floor(elapsed / 10);
        if (earned > lastCoinRef.current) {
          addCoinsRef.current(earned - lastCoinRef.current);
          lastCoinRef.current = earned;
        }
      }, 1000);
      return () => clearInterval(id);
    }, []),
  );

  async function handleStop() {
    const elapsed = Math.floor((Date.now() - (startTimeRef.current ?? Date.now())) / 1000);
    const endedAt = new Date().toISOString();

    addFocusSeconds(elapsed);

    try {
      await api.post('/api/v1/focus-session', {
        focusTagId: tagId ?? null,
        subject: subject ?? null,
        startedAt: startedAtRef.current,
        endedAt,
        distractionCount: 0,
        totalDistractionSeconds: 0,
      });
    } catch {}

    navigation.navigate('홈', {
      focusResult: {
        sessionSeconds: elapsed,
        totalSeconds: todayFocusSeconds + elapsed,
        coinsEarned: Math.floor(elapsed / 10),
        tagName: tagName ?? null,
        subject: subject ?? null,
      },
    });
  }

  return (
    <View style={s.container}>
      <StatusBar style="dark" />

      {/* 헤더 */}
      <View style={s.headerRow}>
        <View>
          <Text style={s.pageLabel}>✏ 집중 중이에요</Text>
          {(tagName || subject) && (
            <Text style={s.sessionInfo}>
              {tagName}
              {tagName && subject ? '  ·  ' : ''}
              {subject}
            </Text>
          )}
        </View>
        <Text style={s.decoStar}>★ ★</Text>
      </View>

      {/* 현재 세션 타이머 */}
      <View style={[s.timerCard, inkBox(T.yellow)]}>
        <Text style={s.timerSmall}>현재 세션</Text>
        <Text style={s.timerText}>{formatTime(sessionSeconds)}</Text>
      </View>

      {/* 카드: 개인 뷰 or 그룹 뷰 */}
      <View style={[s.charCard, inkBox(cardColor)]}>
        {pageIdx === 0 ? (
          /* 개인 뷰 — 캐릭터 애니메이션 */
          <>
            <Text style={s.charMsg}>{msg}</Text>
            <View style={s.charInner}>
              <AnimatedCharacter size={200} variant={variant} />
            </View>
          </>
        ) : (
          /* 그룹 뷰 — 도서관 룸 */
          <>
            <Text style={s.groupViewTitle} numberOfLines={1}>
              {currentGroup?.name ?? ''}
            </Text>
            <View style={s.room}>
              <View style={s.roomWall} />
              <View style={s.roomFloor} />
              <View style={s.seatsWrap}>
                {loadingMembers ? (
                  <ActivityIndicator color={T.ink} />
                ) : currentMembers.length === 0 ? (
                  <Text style={s.emptyText}>멤버가 없어요</Text>
                ) : (
                  <FlatList
                    data={currentMembers}
                    keyExtractor={(item) => String(item.id ?? item.userId)}
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={s.seatList}
                    renderItem={({ item }) => <SeatSlot member={item} />}
                  />
                )}
              </View>
            </View>
          </>
        )}

        {/* 페이지 네비게이션 바 */}
        <View style={s.pageNav}>
          <TouchableOpacity
            onPress={() => goPage(pageIdx - 1)}
            disabled={pageIdx === 0}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={[s.pageNavArrow, pageIdx === 0 && s.pageNavArrowDisabled]}>←</Text>
          </TouchableOpacity>
          <View style={s.pageNavCenter}>
            {loadingGroups ? (
              <ActivityIndicator size="small" color={T.ink} />
            ) : pageIdx === 0 ? (
              <Text style={s.pageNavLabel}>개인</Text>
            ) : (
              <>
                <Text style={s.pageNavLabel} numberOfLines={1}>
                  {currentGroup?.name ?? ''}
                </Text>
                <Text style={s.pageNavPager}>
                  {pageIdx} / {groups.length}
                </Text>
              </>
            )}
          </View>
          <TouchableOpacity
            onPress={() => goPage(pageIdx + 1)}
            disabled={pageIdx >= groups.length}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={[s.pageNavArrow, pageIdx >= groups.length && s.pageNavArrowDisabled]}>
              →
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* 오늘 누적 */}
      <View style={s.accumRow}>
        <Text style={s.accumLabel}>오늘 누적 ⏱</Text>
        <Text style={s.accumTime}>{formatTime(todayFocusSeconds + sessionSeconds)}</Text>
      </View>

      {/* 중지 */}
      <TouchableOpacity style={s.stopBtn} onPress={handleStop} activeOpacity={0.7}>
        <Text style={s.stopBtnText}>중지하기</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: T.paper,
    paddingTop: 56,
    paddingHorizontal: 20,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  pageLabel: { fontSize: 20, fontWeight: '900', color: T.ink },
  sessionInfo: { fontSize: 13, fontWeight: '600', color: T.inkMed, marginTop: 2 },
  decoStar: { fontSize: 14, color: T.inkLight, letterSpacing: 4 },

  timerCard: {
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 24,
    marginBottom: 12,
  },
  timerSmall: { fontSize: 13, fontWeight: '700', color: T.inkMed, marginBottom: 2 },
  timerText: { fontSize: 56, fontWeight: '900', color: T.ink, letterSpacing: -2 },

  charCard: {
    flex: 1,
    marginBottom: 12,
    overflow: 'hidden',
  },
  charMsg: {
    fontSize: 13,
    fontWeight: '700',
    color: T.inkMed,
    textAlign: 'center',
    paddingTop: 12,
    marginBottom: 4,
  },
  charInner: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  // 그룹 뷰 제목
  groupViewTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: T.ink,
    textAlign: 'center',
    paddingVertical: 10,
  },

  // 도서관 룸
  room: { flex: 1, position: 'relative' },
  roomWall: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '57%',
    backgroundColor: '#F0F0F0',
  },
  roomFloor: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '45%',
    backgroundColor: '#E0E0E0',
    borderTopWidth: 2,
    borderTopColor: T.ink,
  },

  // 멤버 자리
  seatsWrap: {
    position: 'absolute',
    bottom: '10%',
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  seatList: { paddingHorizontal: 16, gap: 10 },
  seat: { width: 64, alignItems: 'center' },
  seatCharWrap: { alignItems: 'center' },
  deskSurface: {
    width: 56,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#BBBBBB',
    borderWidth: 1.5,
    borderColor: T.ink,
    marginTop: 2,
  },
  seatName: {
    marginTop: 3,
    fontSize: 9,
    fontWeight: '700',
    color: T.ink,
    textAlign: 'center',
    maxWidth: 60,
  },
  emptyText: { fontSize: 12, fontWeight: '600', color: T.inkLight },

  // 페이지 네비게이션 바
  pageNav: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderTopWidth: 1.5,
    borderTopColor: T.ink,
  },
  pageNavCenter: { flex: 1, alignItems: 'center' },
  pageNavLabel: { fontSize: 12, fontWeight: '800', color: T.ink },
  pageNavPager: { fontSize: 10, fontWeight: '600', color: T.inkMed, marginTop: 1 },
  pageNavArrow: { fontSize: 16, fontWeight: '700', color: T.ink, paddingHorizontal: 4 },
  pageNavArrowDisabled: { color: T.inkLight },

  accumRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 4,
    marginBottom: 16,
  },
  accumLabel: { fontSize: 13, fontWeight: '700', color: T.inkMed },
  accumTime: { fontSize: 18, fontWeight: '900', color: T.ink, letterSpacing: -0.5 },

  stopBtn: {
    backgroundColor: T.ink,
    borderRadius: 8,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 16,
  },
  stopBtnText: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
});
