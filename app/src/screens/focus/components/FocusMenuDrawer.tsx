import { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Pressable, Animated, StyleSheet } from 'react-native';
import { BlurView } from 'expo-blur';
import { LiquidGlassView, isLiquidGlassSupported } from '@callstack/liquid-glass';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { T, withAlpha } from '@/constants/theme';
import ScreenTimeModule from '@/services/ScreenTimeModule';
import { enforcesFocusShield, supportsFocusShield } from '@/services/screenTimeCapabilities';
import AllowedAppsListView from '@/components/AllowedAppsListView';
import { SubjectProgressList } from '@/components/SubjectProgressList';
import { useFocus } from '@/store/FocusContext';
import { useSubjects } from '@/store/SubjectContext';
import { hms } from '../format';

// 10 집중 · 메뉴 열림 / 11 메뉴 → 허용앱 — 세션 위 우측 슬라이드 드로어.
// level 'menu'(허용앱 진입·오늘 전체·과목별 현황) ↔ 'apps'(허용앱 안내).
// 허용앱 토큰은 opaque라 이름/아이콘 열람 불가 → 개수 + 사용법 안내만 표시.
//
// ⚠️ 허용앱 관련 UI는 전부 supportsFocusShield()로 감싼다(GROMO-1592 코드리뷰 반영).
//    안드로이드는 허용앱 개념 자체가 없어 getAllowedSelectionCounts가 null을 주는데,
//    호출부가 그걸 0으로 읽어 '허용앱이 없어요'로 그린다 — 없는 게 아니라 기능이 없는 거다.
//    더 나쁜 건 '허용 안 된 앱은 잠겨서 열 수 없어요' 안내다. 안드로이드엔 차단이 없으니
//    거짓말이고, MenuScreen에서 걷어낸 문구와 정확히 같은 종류다.
const PANEL_W = 270;

export function FocusMenuDrawer({
  open,
  onClose,
  liveSubjectId,
  liveSeconds,
}: {
  open: boolean;
  onClose: () => void;
  liveSubjectId: string; // 진행 중 세션의 과목
  // 아직 정산 안 된 집중 초 중 '오늘' 몫(GROMO-1252) — 자정을 걸친 세션의 어제 몫은 빠져 있고,
  // 이미 정산된 블록(뽀모도로)도 빠져 있다. 그래서 저장분에 그대로 더하면 된다.
  liveSeconds: number;
}) {
  const insets = useSafeAreaInsets();
  const { todayFocusSeconds } = useFocus();
  const { subjects } = useSubjects();
  // 저장(정산)은 블록 단위라, 아직 정산 안 된 오늘 몫을 표시값에 실시간 합산한다.
  const rows = subjects.map((x) =>
    x.id === liveSubjectId ? { ...x, accumulatedSeconds: x.accumulatedSeconds + liveSeconds } : x,
  );
  const [level, setLevel] = useState<'menu' | 'apps'>('menu');
  // 허용앱 개수 — 열 때마다 갱신(전체 탭에서 바꿨을 수 있음). null = 로드 전.
  const [allowedApps, setAllowedApps] = useState<number | null>(null);
  const tx = useRef(new Animated.Value(PANEL_W)).current;
  const backdrop = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (open) {
      setLevel('menu'); // 열 때마다 1단계부터
      // 지원하지 않는 플랫폼에선 아예 부르지 않는다 — null을 0으로 읽어 '허용앱이 없어요'가 된다.
      if (supportsFocusShield()) {
        ScreenTimeModule.getAllowedSelectionCounts()
          .then((c) => setAllowedApps(c?.applications ?? 0))
          .catch(() => setAllowedApps(0));
      }
    }
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
        {/* 리퀴드 글래스 패널(GROMO-848) — iOS 26+는 네이티브 리퀴드 글래스(굴절·반사),
            미지원(iOS 25 이하)은 블러 + 반투명 흰 오버레이 폴백. 오버레이는 잉크 텍스트 가독성용. */}
        {isLiquidGlassSupported ? (
          // clear + 흰 틴트 — regular는 블러 폴백과 구분이 안 될 만큼 뿌예서,
          // 뒤 세션 화면이 비치는 clear로 유리 질감을 살리고 틴트로 잉크 텍스트 가독성 확보
          <LiquidGlassView
            effect="clear"
            colorScheme="light"
            tintColor={withAlpha(T.white, 0.4)}
            style={StyleSheet.absoluteFill}
          />
        ) : (
          <>
            <BlurView intensity={55} tint="light" style={StyleSheet.absoluteFill} />
            <View style={s.panelTint} />
          </>
        )}
        {level === 'menu' ? (
          <>
            <View style={s.menuHead}>
              <Text style={s.menuTitle}>메뉴</Text>
              <TouchableOpacity style={s.closeBtn} activeOpacity={0.7} onPress={onClose}>
                <Ionicons name="close" size={16} color={T.link} />
              </TouchableOpacity>
            </View>

            {supportsFocusShield() && (
              <TouchableOpacity
                style={s.card}
                activeOpacity={0.85}
                onPress={() => setLevel('apps')}
              >
                <View style={s.cardIcon}>
                  <Ionicons name="grid-outline" size={19} color={T.accentDeep} />
                </View>
                <View style={s.flex1}>
                  <Text style={s.cardTitle}>허용앱 사용하기</Text>
                  <Text style={s.cardSub}>집중 중 쓸 수 있는 앱</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={T.inkMuted} />
              </TouchableOpacity>
            )}

            <View style={s.card}>
              <View style={s.flex1}>
                <Text style={s.statLabel}>오늘 전체 집중 현황</Text>
                <Text style={s.statValue}>{hms(todayFocusSeconds + liveSeconds)}</Text>
              </View>
            </View>

            <View style={s.cardBlock}>
              <Text style={s.statLabel}>과목별 집중 현황</Text>
              {/* 행 목록+비율 바는 통계 일 탭과 공용(SubjectProgressList로 승격, GROMO-762) */}
              <SubjectProgressList rows={rows} />
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
            <Text style={s.appsSub}>허용앱을 쓰는 시간도 집중으로 인정돼요.</Text>

            {/* 개수 + 허용앱 목록(opaque 토큰이라 네이티브 뷰로 아이콘·이름 렌더) + 사용법 안내 */}
            <View style={s.allowedCard}>
              <View style={s.allowedIcon}>
                <Ionicons name="lock-open-outline" size={19} color={T.greenDeep} />
              </View>
              <Text style={s.allowedCount}>
                {allowedApps === null
                  ? '허용앱 확인 중…'
                  : allowedApps > 0
                    ? `앱 ${allowedApps}개 허용 중`
                    : '허용앱이 없어요'}
              </Text>
              {allowedApps !== null && allowedApps > 0 && AllowedAppsListView && (
                <AllowedAppsListView
                  style={[s.allowedList, { height: Math.min(allowedApps, 6) * 34 }]}
                />
              )}
              <Text style={s.allowedHint}>
                홈 화면으로 나가서 허용앱을 직접 열면 돼요.{'\n'}허용앱은 전체 탭 → 집중 중 허용
                앱에서 바꿀 수 있어요.
              </Text>
            </View>

            {/* 실제로 잠기는 플랫폼에서만 — 안 잠기는데 잠긴다고 하면 그게 거짓 안내다.
                지금은 위 카드가 이미 막아 안드로이드에선 도달할 수 없지만, apps 단으로 가는
                경로가 하나 더 생겨도 문구가 되살아나지 않게 술어를 여기에도 둔다. */}
            {enforcesFocusShield() && (
              <View style={s.warnBox}>
                <Ionicons name="ban-outline" size={14} color={T.accentAlt} />
                <Text style={s.warnText}>허용 안 된 앱은 잠겨서 열 수 없어요</Text>
              </View>
            )}
          </>
        )}
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: withAlpha(T.night.bottom, 0.5) },
  panel: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    width: PANEL_W,
    // 배경은 LiquidGlassView(또는 블러 폴백)가 그린다 — 뷰 자체는 투명 유지.
    // 왼쪽 모서리 라운드는 유리 굴절 하이라이트가 모서리에서 드러나게 하는 용도.
    backgroundColor: 'transparent',
    overflow: 'hidden',
    borderTopLeftRadius: 24,
    borderBottomLeftRadius: 24,
    paddingHorizontal: T.space.xl,
    paddingBottom: T.space.xxl,
    shadowColor: T.black,
    shadowOpacity: 0.4,
    shadowRadius: 44,
    shadowOffset: { width: -14, height: 0 },
    elevation: 24,
  },
  panelTint: { ...StyleSheet.absoluteFill, backgroundColor: withAlpha(T.white, 0.6) },

  menuHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: T.space.xl,
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

  // 카드 배경도 반투명 — 불투명 흰색이면 패널 대부분을 덮어 유리 느낌이 죽는다
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space.md,
    backgroundColor: withAlpha(T.white, 0.55),
    borderWidth: 1,
    borderColor: T.paperAlt,
    borderRadius: 15,
    paddingVertical: T.space.lg,
    paddingHorizontal: T.space.lg,
    marginBottom: T.space.md,
  },
  cardBlock: {
    backgroundColor: withAlpha(T.white, 0.55),
    borderWidth: 1,
    borderColor: T.paperAlt,
    borderRadius: 15,
    paddingVertical: T.space.lg,
    paddingHorizontal: T.space.lg,
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
  statLabel: { ...T.text.caption, fontWeight: '700', color: T.ink, marginBottom: T.space.sm },
  statValue: {
    ...T.text.title,
    letterSpacing: -1,
    color: T.ink,
    fontVariant: ['tabular-nums'],
  },

  appsHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space.md,
    marginBottom: T.space.md,
  },
  appsSub: { ...T.text.caption, fontWeight: '500', color: T.inkMuted, marginBottom: T.space.md },
  allowedCard: {
    alignItems: 'center',
    gap: T.space.sm,
    backgroundColor: withAlpha(T.white, 0.55),
    borderWidth: 1,
    borderColor: T.paperAlt,
    borderRadius: 15,
    paddingVertical: T.space.xl,
    paddingHorizontal: T.space.lg,
  },
  allowedIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: T.greenBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  allowedCount: { ...T.text.label, fontWeight: '700', color: T.ink },
  allowedList: { alignSelf: 'stretch', marginTop: T.space.sm, marginBottom: 2 },
  allowedHint: {
    ...T.text.caption,
    fontWeight: '500',
    color: T.inkMuted,
    textAlign: 'center',
    lineHeight: 18,
  },

  warnBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space.sm,
    backgroundColor: T.dangerBg,
    borderWidth: 1,
    borderColor: T.dangerBorder,
    borderRadius: 12,
    paddingVertical: T.space.md,
    paddingHorizontal: T.space.md,
    marginTop: T.space.md,
  },
  warnText: { ...T.text.caption, color: T.dangerInk },
});
