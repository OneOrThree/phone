import { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Pressable, Animated, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { T } from '@/v2/constants/theme';
import { useFocus } from '@/store/FocusContext';
import { useSubjects } from '@/store/SubjectContext';
import { hms } from '../format';
import { EXAMPLE_ALLOWED_APPS } from '../data';

// 10 집중 · 메뉴 열림 / 11 메뉴 → 허용앱 — 세션 위 우측 슬라이드 드로어.
// level 'menu'(허용앱 진입·오늘 전체·과목별 현황) ↔ 'apps'(허용앱 리스트).
const PANEL_W = 270;

export function FocusMenuDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const { todayFocusSeconds } = useFocus();
  const { subjects } = useSubjects();
  const maxSeconds = Math.max(1, ...subjects.map((x) => x.accumulatedSeconds));
  const [level, setLevel] = useState<'menu' | 'apps'>('menu');
  const tx = useRef(new Animated.Value(PANEL_W)).current;
  const backdrop = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (open) setLevel('menu'); // 열 때마다 1단계부터
    Animated.parallel([
      Animated.timing(tx, { toValue: open ? 0 : PANEL_W, duration: 220, useNativeDriver: true }),
      Animated.timing(backdrop, { toValue: open ? 1 : 0, duration: 220, useNativeDriver: true }),
    ]).start();
  }, [open, tx, backdrop]);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={open ? 'auto' : 'none'}>
      <Animated.View style={[s.backdrop, { opacity: backdrop }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>

      <Animated.View
        style={[s.panel, { paddingTop: insets.top + 20, transform: [{ translateX: tx }] }]}
      >
        {level === 'menu' ? (
          <>
            <View style={s.menuHead}>
              <Text style={s.menuTitle}>메뉴</Text>
              <TouchableOpacity style={s.closeBtn} activeOpacity={0.7} onPress={onClose}>
                <Ionicons name="close" size={16} color={T.link} />
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={s.card} activeOpacity={0.85} onPress={() => setLevel('apps')}>
              <View style={s.cardIcon}>
                <Ionicons name="grid-outline" size={19} color={T.accentDeep} />
              </View>
              <View style={s.flex1}>
                <Text style={s.cardTitle}>허용앱 사용하기</Text>
                <Text style={s.cardSub}>집중 중 쓸 수 있는 앱</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={T.inkMuted} />
            </TouchableOpacity>

            <View style={s.card}>
              <View style={s.flex1}>
                <Text style={s.statLabel}>오늘 전체 집중 현황</Text>
                <Text style={s.statValue}>{hms(todayFocusSeconds)}</Text>
              </View>
            </View>

            <View style={s.cardBlock}>
              <Text style={s.statLabel}>과목별 집중 현황</Text>
              <View style={s.progressList}>
                {subjects.map((p) => (
                  <View key={p.id}>
                    <View style={s.progressTop}>
                      <Text style={s.progressName}>{p.name}</Text>
                      <Text style={s.progressTime}>{hms(p.accumulatedSeconds)}</Text>
                    </View>
                    <View style={s.track}>
                      <View
                        style={[s.fill, { width: `${(p.accumulatedSeconds / maxSeconds) * 100}%` }]}
                      />
                    </View>
                  </View>
                ))}
              </View>
            </View>
          </>
        ) : (
          <>
            <View style={s.appsHead}>
              <TouchableOpacity
                style={s.closeBtn}
                activeOpacity={0.7}
                onPress={() => setLevel('menu')}
              >
                <Ionicons name="chevron-back" size={16} color={T.link} />
              </TouchableOpacity>
              <Text style={s.menuTitle}>허용앱 사용하기</Text>
            </View>
            <Text style={s.appsSub}>여기서 연 앱은 집중으로 인정돼요.</Text>

            <View style={s.appList}>
              {EXAMPLE_ALLOWED_APPS.map((app) => (
                <View key={app.id} style={s.appRow}>
                  <View style={[s.appIcon, { backgroundColor: app.color }]}>
                    <Text style={s.appInitial}>{app.initial}</Text>
                  </View>
                  <Text style={s.appName}>{app.name}</Text>
                  {/* 스텁: 실제 앱 실행(shielding)은 후속 티켓 */}
                  <Text style={s.appOpen}>열기 ↗</Text>
                </View>
              ))}
            </View>

            <View style={s.warnBox}>
              <Ionicons name="ban-outline" size={14} color={T.accentAlt} />
              <Text style={s.warnText}>목록에 없는 앱은 집중이 멈춰요</Text>
            </View>
          </>
        )}
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(10,7,4,0.5)' },
  panel: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    width: PANEL_W,
    backgroundColor: T.paperLight,
    paddingHorizontal: 18,
    paddingBottom: 24,
    shadowColor: T.black,
    shadowOpacity: 0.4,
    shadowRadius: 44,
    shadowOffset: { width: -14, height: 0 },
    elevation: 24,
  },

  menuHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  menuTitle: { ...T.text.body, fontWeight: '800', color: T.ink },
  closeBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: T.caramel,
    alignItems: 'center',
    justifyContent: 'center',
  },

  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.paperAlt,
    borderRadius: 15,
    paddingVertical: 14,
    paddingHorizontal: 15,
    marginBottom: 11,
  },
  cardBlock: {
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.paperAlt,
    borderRadius: 15,
    paddingVertical: 15,
    paddingHorizontal: 16,
  },
  cardIcon: {
    width: 38,
    height: 38,
    borderRadius: 11,
    backgroundColor: T.caramel,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flex1: { flex: 1 },
  cardTitle: { ...T.text.label, fontWeight: '700', color: T.ink },
  cardSub: { ...T.text.caption, fontWeight: '500', color: T.inkMuted, marginTop: 1 },
  statLabel: { ...T.text.caption, fontWeight: '700', color: T.ink, marginBottom: 8 },
  statValue: {
    ...T.text.title,
    letterSpacing: -1,
    color: T.ink,
    fontVariant: ['tabular-nums'],
  },

  progressList: { gap: 11 },
  progressTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 },
  progressName: { ...T.text.caption, color: T.ink },
  progressTime: {
    ...T.text.caption,
    fontWeight: '700',
    color: T.inkSub,
    fontVariant: ['tabular-nums'],
  },
  track: { height: 7, borderRadius: 4, backgroundColor: T.caramel, overflow: 'hidden' },
  fill: { height: 7, borderRadius: 4, backgroundColor: T.accent },

  appsHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  appsSub: { ...T.text.caption, fontWeight: '500', color: T.inkMuted, marginBottom: 12 },
  appList: { gap: 8 },
  appRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.paperAlt,
    borderRadius: 13,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  appIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  appInitial: { ...T.text.label, fontWeight: '800', color: T.white },
  appName: { flex: 1, ...T.text.label, fontWeight: '600', color: T.ink },
  appOpen: { ...T.text.caption, fontWeight: '700', color: T.accent },

  warnBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: T.dangerBg,
    borderWidth: 1,
    borderColor: T.dangerBorder,
    borderRadius: 12,
    paddingVertical: 11,
    paddingHorizontal: 13,
    marginTop: 12,
  },
  warnText: { ...T.text.caption, color: T.dangerInk },
});
