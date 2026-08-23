import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Image,
  TextInput,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import ScreenTimeModule, { type InstalledApp } from '@/services/ScreenTimeModule';
import SettingsScaffold from '@/screens/settings/components/SettingsScaffold';
import type { V2RootStackParamList } from '@/navigation/types';
import { STORAGE_KEYS } from '@/types/storage';
import { todayStr } from '@/utils/localDate';
import { T } from '@/constants/theme';

// SET · 앱 고르기(안드로이드) — 측정 대상(GROMO-1593)과 집중 중 허용앱(GROMO-1603)이 함께 쓴다.
//
// iOS는 FamilyActivityPicker가 시스템 모달로 뜨고 선택 결과가 opaque 토큰이라 JS가 앱 이름조차
// 못 읽는다. 안드로이드는 패키지명이 그대로 보이므로 목록만 네이티브에서 받고 화면은 여기서 그린다.
//
// **한 화면을 두 용도로 쓰는 이유**: 목록·검색·아이콘·저장 흐름이 완전히 같다. 복제하면
// 한쪽만 고쳐지는 일이 반드시 생긴다. 다른 건 문구와 저장 대상뿐이라 mode로 가른다.
//
// ⚠️ **빈 선택의 뜻이 두 모드에서 정반대다.**
//    - measured: 0개 = 전체 앱 측정(미설정과 같음)
//    - allowed : 0개 = 허용앱 없음
//    문구가 이걸 정확히 말하지 않으면 사용자는 정반대 결과를 얻는다. 아래 MODE로 묶어 둔다.

export type AppPickerMode = 'measured' | 'allowed';

interface ModeSpec {
  title: string;
  noteLead: string;
  noteStrong: string;
  ctaEmpty: string;
  ctaCount: (n: number) => string;
  load: () => Promise<string[]>;
  save: (packages: string[]) => Promise<void>;
}

const MODE: Record<AppPickerMode, ModeSpec> = {
  measured: {
    title: '측정 대상 앱 설정',
    noteLead: '고른 앱의 사용시간만 집계해요.',
    noteStrong: '하나도 고르지 않으면 전체 앱을 집계해요.',
    ctaEmpty: '전체 앱 측정으로 저장',
    ctaCount: (n) => `${n}개 앱만 측정하도록 저장`,
    load: () => ScreenTimeModule.getSelectionPackages(),
    save: (packages) => ScreenTimeModule.setSelectionPackages(packages),
  },
  allowed: {
    title: '집중 중 허용 앱',
    noteLead: '집중 중에도 쓸 수 있게 열어둘 앱이에요.',
    noteStrong: '고르지 않으면 허용앱이 없어요.',
    ctaEmpty: '허용앱 없이 저장',
    ctaCount: (n) => `${n}개 앱 허용으로 저장`,
    load: () => ScreenTimeModule.getAllowedPackages(),
    save: (packages) => ScreenTimeModule.setAllowedPackages(packages),
  },
};

export default function AppPickerScreen() {
  const navigation = useNavigation();
  const route = useRoute<RouteProp<V2RootStackParamList, 'SettingsAppPicker'>>();
  const mode = route.params?.mode ?? 'measured';
  const spec = MODE[mode];

  const [apps, setApps] = useState<InstalledApp[] | null>(null); // null = 로딩 중
  const [failed, setFailed] = useState(false); // 목록 조회 자체가 실패 — 빈 목록과 구분한다
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([ScreenTimeModule.getInstalledApps(), spec.load()])
      .then(([list, saved]) => {
        if (cancelled) return;
        setApps(list);
        // 설치 목록에 남아 있는 것만 복원한다(코드리뷰 반영). 지웠거나 런처 항목이 사라진
        // 앱은 여기 행이 없는데, 그대로 넣으면 **체크된 행이 하나도 없는데 개수만 올라간다.**
        // 사용자가 화면에서 풀 방법이 없고, 저장해도 그 값이 계속 보존돼 앱을 재설치하면
        // 의도치 않게 다시 측정 대상이 된다.
        const installed = new Set(list.map((a) => a.packageName));
        setSelected(new Set(saved.filter((pkg) => installed.has(pkg))));
      })
      // ⚠️ 실패를 빈 목록으로 뭉개지 않는다. 처음엔 catch에서 setApps([])를 했는데, 그러면
      // '앱이 하나도 없음'과 '네이티브 호출 실패'가 화면에서 똑같아 보인다 — 실제로 네이티브가
      // 빠진 빌드에서 목록이 비어 보였고, 로그를 심기 전까지 원인을 못 봤다.
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [spec]);

  const filtered = useMemo(() => {
    if (!apps) return [];
    const q = query.trim().toLowerCase();
    if (!q) return apps;
    // 패키지명으로도 찾게 둔다 — 한글 라벨을 모르는 앱(시스템 앱 등)을 집어내는 유일한 방법이다.
    return apps.filter(
      (a) => a.label.toLowerCase().includes(q) || a.packageName.toLowerCase().includes(q),
    );
  }, [apps, query]);

  const toggle = useCallback((packageName: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(packageName)) next.delete(packageName);
      else next.add(packageName);
      return next;
    });
  }, []);

  /**
   * 오늘자 동기화 캐시만 버린다. 과거 날짜면 그대로 둔다(위 주석 참고).
   *
   * 실패는 삼킨다 — 저장 자체를 붙잡을 이유가 없고, 다음 동기화가 어차피 값을 덮는다.
   */
  async function clearTodaySyncCache() {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEYS.screentimeSyncState);
      if (!raw) return;
      const state = JSON.parse(raw) as { date?: string };
      if (state.date !== todayStr()) return; // 과거 backlog — 건드리지 않는다.
      await AsyncStorage.removeItem(STORAGE_KEYS.screentimeSyncState);
    } catch {
      // 깨진 값이면 판단 근거가 없다 — 과거 backlog 일 수도 있으니 그대로 둔다.
    }
  }

  // 저장 준비가 안 된 상태 — 목록 로딩 중이거나 조회가 실패했을 때(코드리뷰 반영).
  //
  // ⚠️ 이걸 안 막으면 **기존 측정 대상이 조용히 삭제된다.** 로딩 중에는 selected 가 빈 집합인데
  //    버튼은 살아 있어서, 그대로 누르면 save([]) 가 나간다. 빈 배열은 '0개 측정'이 아니라
  //    '미설정 = 전체 앱 측정'이라 되돌리기도 어렵다(사용자는 뭘 지웠는지 모른다).
  const notReady = apps === null || failed;

  async function save() {
    if (saving || notReady) return;
    setSaving(true);
    try {
      await spec.save([...selected]);
      // ⚠️ 측정 대상을 바꾸면 **오늘 동기화 캐시를 버린다**(코드리뷰 8차). 그 캐시에는 바꾸기
      //    전 기준으로 올린 큰 분값이 남아 있는데, 다음날 마감이 새 대상으로 재계산한 값과
      //    Math.max 로 합친다 — **바꾸기 전 사용량이 최종 서버 기록과 목표 판정에 박힌다.**
      //    (측정 대상 저장에만 해당한다 — 허용앱은 사용량 계산과 무관하다.)
      //
      // ⚠️⚠️ **오늘 것일 때만** 지운다(코드리뷰 9차). 이 키는 단순한 오늘 캐시가 아니라,
      //    오프라인·마감 실패로 밀린 **과거 날짜의 backlog** 이기도 하다(screentimeSync 의
      //    '지난 중간 동기화 행 확정'). 무조건 지우면 그 날짜의 isFinal 보고와 목표 판정이
      //    영구히 누락된다 — 지금 고르는 대상과 아무 상관 없는 과거 기록을 잃는 것이다.
      if (mode === 'measured') {
        // 진행 중이던 동기화가 **바꾸기 전 기준의 값**을 뒤늦게 쓰는 것도 막아야 한다
        // (코드리뷰 10차). 삭제만 하면 그 작업이 네트워크를 마치고 옛 분값을 되살린다.
        // 변경 시각을 먼저 남겨, 그 뒤에 끝나는 동기화가 자기 값을 버리게 한다.
        await AsyncStorage.setItem(
          STORAGE_KEYS.screentimeSelectionChangedAt,
          String(Date.now()),
        ).catch(() => {});
        await clearTodaySyncCache();
      }
      navigation.goBack();
    } finally {
      setSaving(false);
    }
  }

  const count = selected.size;

  return (
    <SettingsScaffold
      title={spec.title}
      onBack={() => navigation.goBack()}
      scroll={false}
      footer={
        <TouchableOpacity
          testID="appPicker.save"
          style={[s.cta, saving || notReady ? s.ctaDisabled : null]}
          disabled={saving || notReady}
          activeOpacity={0.85}
          onPress={save}
        >
          <Text style={s.ctaText}>{count === 0 ? spec.ctaEmpty : spec.ctaCount(count)}</Text>
        </TouchableOpacity>
      }
    >
      <View style={s.noteCard}>
        <Text style={s.noteBody}>
          {spec.noteLead}
          {'\n'}
          <Text style={s.noteStrong}>{spec.noteStrong}</Text>
        </Text>
      </View>

      <View style={s.searchRow}>
        <Ionicons name="search" size={16} color={T.inkMuted} />
        <TextInput
          testID="appPicker.search"
          value={query}
          onChangeText={setQuery}
          placeholder="앱 이름 검색"
          placeholderTextColor={T.inkMuted}
          style={s.searchInput}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      {failed ? (
        <Text testID="appPicker.error" style={s.empty}>
          앱 목록을 불러오지 못했어요.{'\n'}앱을 다시 켜고 시도해 주세요.
        </Text>
      ) : apps === null ? (
        <View style={s.center}>
          <ActivityIndicator color={T.accent} />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.packageName}
          keyboardShouldPersistTaps="handled"
          // 목록이 길어 행 마운트가 곧 '보이는 범위'다 — 아이콘은 그때 행이 직접 받아온다.
          renderItem={({ item }) => (
            <AppRow
              app={item}
              checked={selected.has(item.packageName)}
              onToggle={() => toggle(item.packageName)}
            />
          )}
          ListEmptyComponent={<Text style={s.empty}>검색 결과가 없어요</Text>}
          contentContainerStyle={s.listContent}
        />
      )}
    </SettingsScaffold>
  );
}

// 아이콘 캐시 — FlatList 는 스크롤로 행을 언마운트했다 다시 붙이므로, 캐시가 없으면 같은 앱의
// 아이콘을 위아래로 스크롤할 때마다 네이티브에서 다시 인코딩한다. 모듈 수명 동안만 유지한다.
const iconCache = new Map<string, string | null>();

function AppRow({
  app,
  checked,
  onToggle,
}: {
  app: InstalledApp;
  checked: boolean;
  onToggle: () => void;
}) {
  const [icon, setIcon] = useState<string | null>(() => iconCache.get(app.packageName) ?? null);
  const requested = useRef(false);

  useEffect(() => {
    if (requested.current || iconCache.has(app.packageName)) return;
    requested.current = true;
    let cancelled = false;
    ScreenTimeModule.getAppIcon(app.packageName)
      .then((data) => {
        iconCache.set(app.packageName, data);
        if (!cancelled) setIcon(data);
      })
      .catch(() => iconCache.set(app.packageName, null));
    return () => {
      cancelled = true;
    };
  }, [app.packageName]);

  return (
    <TouchableOpacity
      testID={`appPicker.row.${app.packageName}`}
      style={s.row}
      activeOpacity={0.7}
      onPress={onToggle}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={app.label}
    >
      {icon ? (
        <Image source={{ uri: `data:image/png;base64,${icon}` }} style={s.icon} />
      ) : (
        // 아이콘이 늦게 와도 행 높이가 안 바뀌게 같은 크기의 자리를 먼저 잡아 둔다.
        <View style={[s.icon, s.iconPlaceholder]} />
      )}
      <Text style={s.label} numberOfLines={1}>
        {app.label}
      </Text>
      <Ionicons
        name={checked ? 'checkbox' : 'square-outline'}
        size={22}
        color={checked ? T.accent : T.inkFaint}
      />
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  noteCard: {
    backgroundColor: T.accentBg,
    borderRadius: 14,
    padding: T.space.md,
    marginBottom: T.space.md,
  },
  noteBody: { ...T.text.label, color: T.inkSub, lineHeight: 20 },
  noteStrong: { color: T.accentDeep, fontWeight: '700' },

  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space.sm,
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.paperAlt,
    borderRadius: 12,
    paddingHorizontal: T.space.md,
    marginBottom: T.space.sm,
  },
  // 축소를 허용해야 긴 플레이스홀더·큰 글씨에서 검색 아이콘을 밀어내지 않는다.
  searchInput: { ...T.text.body, color: T.ink, flex: 1, flexShrink: 1, paddingVertical: 10 },

  listContent: { paddingBottom: T.space.md },
  center: { paddingVertical: 48, alignItems: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space.md,
    paddingVertical: 10,
  },
  icon: { width: 36, height: 36, borderRadius: 9 },
  iconPlaceholder: { backgroundColor: T.paperAlt },
  label: { ...T.text.body, color: T.ink, flex: 1, flexShrink: 1 },
  empty: { ...T.text.body, color: T.inkMuted, textAlign: 'center', marginTop: 32 },

  cta: {
    backgroundColor: T.accent,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaDisabled: { opacity: 0.45 },
  ctaText: { ...T.text.subtitle, color: T.white },
});
