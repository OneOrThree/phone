import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  registerAndroidAppPickerHost,
  type AndroidAppPickerMode,
} from '@/services/androidAppPicker';
import {
  androidAppPickerNative,
  type AndroidInstalledApp,
  type AppSelectionCounts,
} from '@/services/ScreenTimeModule';
import { T } from '@/constants/theme';

// 안드로이드 앱 선택 피커(GROMO-995) — iOS FamilyActivityPicker의 RN 대응 화면.
// App.tsx에 상시 마운트되는 전역 호스트로, ScreenTimeModule.presentAppPicker 계열이
// androidAppPicker 브릿지를 통해 이 모달을 띄우고 선택 결과(개수)로 resolve된다.
// 온보딩·설정 어디서 불려도 뜨도록 내비게이션이 아니라 최상위 Modal로 그린다.
//
// 두 모드(iOS 피커 구분과 1:1):
//  - measurement(측정 대상): 선택을 네이티브 pending에 저장 — 승격은 호출부의 promoteSelection.
//    프리로드가 null(한 번도 선택 안 함 = 전체 앱 측정 기본)이면 전체 선택으로 시작한다.
//    빈 선택 저장은 막는다(최소 1개) — 안드로이드는 빈 집합=전체 측정이라 '0개 측정'이 성립 안 함.
//  - allowed(집중 허용앱): 완료 즉시 저장. 0개 허용(모든 앱 잠금)도 유효한 선택이다.

interface PickerRequest {
  mode: AndroidAppPickerMode;
  resolve: (counts: AppSelectionCounts | null) => void;
}

const COPY = {
  measurement: {
    title: '측정할 앱 선택',
    subtitle: '고른 앱의 사용 시간만 측정해요. 최소 1개는 골라 주세요.',
  },
  allowed: {
    title: '집중 중 허용 앱',
    subtitle: '집중 중에도 쓸 수 있는 앱을 골라 주세요.',
  },
} as const;

const ROW_HEIGHT = 60; // 고정 행 높이 — getItemLayout으로 100개+ 목록 스크롤 최적화

// 목록 행 — memo로 선택 토글 시 바뀐 행만 리렌더한다(목록이 100개+일 수 있음).
const AppRow = memo(function AppRow({
  app,
  checked,
  onToggle,
}: {
  app: AndroidInstalledApp;
  checked: boolean;
  onToggle: (packageName: string) => void;
}) {
  return (
    <TouchableOpacity style={s.row} activeOpacity={0.7} onPress={() => onToggle(app.packageName)}>
      {app.iconUri ? (
        <Image source={{ uri: app.iconUri }} style={s.rowIcon} />
      ) : (
        // 아이콘 생성 실패 폴백 — 앱 이름 첫 글자
        <View style={[s.rowIcon, s.rowIconFallback]}>
          <Text style={s.rowIconFallbackText}>{app.label.slice(0, 1)}</Text>
        </View>
      )}
      <Text style={s.rowLabel} numberOfLines={1}>
        {app.label}
      </Text>
      <Ionicons
        name={checked ? 'checkmark-circle' : 'ellipse-outline'}
        size={24}
        color={checked ? T.accent : T.borderDark}
      />
    </TouchableOpacity>
  );
});

export function AndroidAppPickerHost() {
  const [request, setRequest] = useState<PickerRequest | null>(null);
  const [apps, setApps] = useState<AndroidInstalledApp[] | null>(null); // null = 로딩 중
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  // 등록 콜백·언마운트 정리가 최신 요청을 보도록 ref로 참조(리스너는 1회만 등록).
  const requestRef = useRef(request);
  requestRef.current = request;

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const unregister = registerAndroidAppPickerHost((mode) => {
      // 이미 떠 있는 피커가 있으면(호출부 연타 가드로 사실상 없음) 새 요청은 취소로 마감.
      if (requestRef.current) return Promise.resolve(null);
      return new Promise((resolve) => {
        setApps(null);
        setQuery('');
        setSelected(new Set());
        setSaving(false);
        setRequest({ mode, resolve });
      });
    });
    return () => {
      unregister();
      // 언마운트 시 열린 요청은 취소로 마감 — 호출부 promise가 영원히 대기하지 않게.
      requestRef.current?.resolve(null);
    };
  }, []);

  // 피커가 열리면 앱 목록 + 저장된 선택(모드별)을 불러와 채운다.
  useEffect(() => {
    if (!request) return;
    let cancelled = false;
    (async () => {
      try {
        const [list, saved] = await Promise.all([
          androidAppPickerNative.getInstalledApps(),
          request.mode === 'measurement'
            ? androidAppPickerNative.getSelectionPackages()
            : androidAppPickerNative.getAllowedPackages(),
        ]);
        if (cancelled) return;
        // 저장분 중 삭제된 앱은 걸러낸다 — 다음 완료 때 자연히 목록에서도 빠진다.
        const listed = new Set(list.map((a) => a.packageName));
        const initial =
          saved?.filter((p) => listed.has(p)) ??
          // 측정 모드 미설정(전체 앱 측정 기본)은 전체 선택으로 시작 — 그대로 완료하면 현재
          // 설치 앱 전체가 명시 선택이 된다(iOS의 '전체 선택 권장'과 같은 스냅샷 의미).
          (request.mode === 'measurement' ? [...listed] : []);
        setSelected(new Set(initial));
        setApps(list);
      } catch {
        if (!cancelled) setApps([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [request]);

  const filtered = useMemo(() => {
    if (!apps) return [];
    const q = query.trim().toLowerCase();
    if (!q) return apps;
    return apps.filter(
      (a) => a.label.toLowerCase().includes(q) || a.packageName.toLowerCase().includes(q),
    );
  }, [apps, query]);

  const toggle = useCallback((packageName: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(packageName)) {
        next.delete(packageName);
      } else {
        next.add(packageName);
      }
      return next;
    });
  }, []);

  // 전체 선택 여부 — 선택 집합은 항상 목록의 부분집합(프리로드에서 삭제된 앱을 걸렀고
  // 토글도 목록 행에서만 일어남)이라 개수 비교로 충분하다.
  const allSelected = apps != null && apps.length > 0 && selected.size === apps.length;

  function toggleAll() {
    if (!apps) return;
    setSelected(allSelected ? new Set() : new Set(apps.map((a) => a.packageName)));
  }

  function close(counts: AppSelectionCounts | null) {
    request?.resolve(counts);
    setRequest(null);
  }

  // 완료 — 모드별 저장 후 iOS와 같은 형태의 개수로 resolve(카테고리·웹도메인 없음 = 0 고정).
  async function confirm() {
    if (!request || saving) return;
    const packages = [...selected];
    setSaving(true);
    try {
      if (request.mode === 'measurement') {
        await androidAppPickerNative.setPendingSelection(packages);
      } else {
        await androidAppPickerNative.setAllowedSelection(packages);
      }
      close({ applications: packages.length, categories: 0, webDomains: 0 });
    } catch {
      close(null); // 저장 실패는 취소와 동일하게 마감 — 기존 선택이 그대로 유지된다.
    } finally {
      setSaving(false);
    }
  }

  if (Platform.OS !== 'android' || !request) return null;

  const copy = COPY[request.mode];
  const confirmDisabled = saving || (request.mode === 'measurement' && selected.size === 0);

  return (
    <Modal visible animationType="slide" onRequestClose={() => close(null)}>
      <SafeAreaView style={s.root} edges={['top', 'bottom']}>
        {/* 헤더 — 닫기(취소) + 제목 (SettingsScaffold 상단 바와 같은 골격) */}
        <View style={s.bar}>
          <TouchableOpacity
            onPress={() => close(null)}
            style={s.closeBtn}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Ionicons name="close" size={24} color={T.ink} />
          </TouchableOpacity>
          <Text style={s.title} numberOfLines={1}>
            {copy.title}
          </Text>
        </View>
        <Text style={s.subtitle}>{copy.subtitle}</Text>

        {/* 검색 */}
        <View style={s.searchBox}>
          <Ionicons name="search" size={18} color={T.inkMuted} />
          <TextInput
            style={s.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="앱 이름으로 검색"
            placeholderTextColor={T.inkMuted}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
          />
          {query.length > 0 ? (
            <TouchableOpacity
              onPress={() => setQuery('')}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="close-circle" size={18} color={T.inkMuted} />
            </TouchableOpacity>
          ) : null}
        </View>

        {/* 선택 요약 + 전체 선택/해제(측정 모드) */}
        <View style={s.toolbar}>
          <Text style={s.countText}>{selected.size}개 선택</Text>
          {request.mode === 'measurement' ? (
            <TouchableOpacity onPress={toggleAll} disabled={apps == null}>
              <Text style={s.toggleAllText}>{allSelected ? '전체 해제' : '전체 선택'}</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {/* 목록 */}
        {apps == null ? (
          <View style={s.loading}>
            <ActivityIndicator size="large" color={T.accent} />
          </View>
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={(a) => a.packageName}
            renderItem={({ item }) => (
              <AppRow app={item} checked={selected.has(item.packageName)} onToggle={toggle} />
            )}
            getItemLayout={(_, index) => ({
              length: ROW_HEIGHT,
              offset: ROW_HEIGHT * index,
              index,
            })}
            initialNumToRender={14}
            windowSize={7}
            removeClippedSubviews
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              <Text style={s.empty}>
                {apps.length === 0 ? '표시할 앱이 없어요' : '검색 결과가 없어요'}
              </Text>
            }
            style={s.list}
            contentContainerStyle={s.listContent}
          />
        )}

        {/* 완료 CTA — AllowedAppsScreen 하단 버튼과 같은 스타일 */}
        <View style={s.footer}>
          <TouchableOpacity
            style={[s.cta, confirmDisabled ? s.ctaDisabled : null]}
            activeOpacity={0.85}
            disabled={confirmDisabled}
            onPress={confirm}
          >
            <Text style={s.ctaText}>선택 완료</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.paperLight },

  // 헤더
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space.sm,
    paddingHorizontal: T.space.md,
    paddingTop: T.space.xs,
    paddingBottom: T.space.xs,
  },
  closeBtn: { padding: T.space.xs },
  title: { ...T.text.heading, color: T.ink },
  subtitle: {
    ...T.text.caption,
    color: T.inkSub,
    paddingHorizontal: T.space.xl,
    marginBottom: T.space.md,
  },

  // 검색 필드
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space.sm,
    backgroundColor: T.chipBg,
    borderRadius: 12,
    paddingHorizontal: T.space.md,
    height: 44,
    marginHorizontal: T.space.xl,
  },
  searchInput: { ...T.text.label, fontWeight: '500', color: T.ink, flex: 1, paddingVertical: 0 },

  // 선택 요약 툴바
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: T.space.xl,
    paddingVertical: T.space.md,
  },
  countText: { ...T.text.caption, color: T.inkMuted },
  toggleAllText: { ...T.text.caption, color: T.accentDeep },

  // 목록
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { flex: 1 },
  listContent: { paddingHorizontal: T.space.xl, paddingBottom: T.space.md },
  row: {
    height: ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space.md,
  },
  rowIcon: { width: 40, height: 40, borderRadius: 10 },
  rowIconFallback: {
    backgroundColor: T.sandLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowIconFallbackText: { ...T.text.label, color: T.accentDeep },
  rowLabel: { ...T.text.label, fontWeight: '500', color: T.ink, flex: 1 },
  empty: {
    ...T.text.caption,
    color: T.inkMuted,
    textAlign: 'center',
    paddingTop: T.space.xxl,
  },

  // 하단 완료 CTA(AllowedAppsScreen doneBtn과 동일 스타일)
  footer: { paddingHorizontal: T.space.xl, paddingTop: T.space.sm, paddingBottom: T.space.md },
  cta: {
    height: 56,
    borderRadius: 18,
    backgroundColor: T.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaDisabled: { opacity: 0.4 },
  ctaText: { ...T.text.subtitle, color: T.white },
});
