import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  AppState,
  Linking,
  Platform,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import ScreenTimeModule, {
  type AuthorizationStatus,
  androidNativeModuleAvailable,
  nativeSupportsPendingApplyDate,
} from '@/services/ScreenTimeModule';
import { updateScreenTimePermission } from '@/services/userApi';
import { logScreenTimeSettingsChanged } from '@/services/analyticsEvents';
import { registerUsageBucketMonitoring } from '@/services/screentimeSync';
import { todayStr, tomorrowStr, yesterdayStr } from '@/utils/localDate';
import { useUser } from '@/store/UserContext';
import { useToast } from '@/store/ToastContext';
import SettingsScaffold from '@/screens/settings/components/SettingsScaffold';
import { SettingsSection, SettingsRow } from '@/screens/settings/components/SettingsList';
import type { V2RootStackParamList } from '@/navigation/types';
import { STORAGE_KEYS } from '@/types/storage';
import { T } from '@/constants/theme';

// SET · 스크린타임 권한 관리 화면(SettingsScreenTimePermission).
// 권한 상태 배지 + 수집 항목 안내 + 기기내 처리 안내 + '측정 대상 앱 설정'(기존 MenuScreen 이식).
// 상태 카드가 권한 상태별 단일 진입점(GROMO-978): 요청 필요→권한 요청(허용 시 바로 앱 피커),
// 허용됨→앱 피커, 거부됨→iOS는 설정 이동, 안드로이드는 Usage Access 재요청(GROMO-994).

// 저장된 마지막 동기화 날짜 → 상대 라벨(오늘/어제/날짜).
// 축은 로컬 — 대조 대상(screentimeLastSyncedDate)을 screentimeSync가 로컬 todayStr로 쓴다
// (스크린타임 측정·마감 축, docs/date-axis.md 분류 ②).
function syncLabel(raw: string): string {
  const date = raw.slice(0, 10); // 타임스탬프로 저장돼도 날짜부만 사용
  if (date === todayStr()) return '오늘';
  if (date === yesterdayStr()) return '어제';
  return date;
}

// 권한 상태별 배지 메타(라벨·글자색·배경). null = 조회 중.
function badgeMeta(status: AuthorizationStatus | null): {
  label: string;
  color: string;
  bg: string;
} {
  if (status === 'approved') return { label: '허용됨', color: T.successInk, bg: T.successBg };
  if (status === 'denied') return { label: '거부됨', color: T.dangerInk, bg: T.dangerBg };
  if (status === 'notDetermined') return { label: '요청 필요', color: T.inkSub, bg: T.sandLight };
  return { label: '확인 중', color: T.inkMuted, bg: T.sandLight };
}

export default function ScreenTimePermissionScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<V2RootStackParamList>>();
  // 측정 대상 변경 시 버킷 모니터 재등록에 모니터 소유 기록용 계정이 필요하다(GROMO-633).
  const { userId } = useUser();
  const { show } = useToast();

  const [status, setStatus] = useState<AuthorizationStatus | null>(null);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);
  const statusBeforeSettingsRef = useRef<AuthorizationStatus | null>(null);
  // A안(GROMO-942) — 측정 대상 변경이 '내일 적용'으로 예약돼 있으면 측정 대상 행에 배지로 표시.
  // 예약 적용일이 아직 미래(내일)일 때만 노출 — 자정에 승격되면 ScreenTimeSyncer가 마커를 지운다.
  const [pendingApply, setPendingApply] = useState(false);

  // 재진입마다 권한 상태·마지막 동기화 최신값 반영(iOS 설정에서 바꾸고 돌아올 수 있으므로).
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      ScreenTimeModule.getAuthorizationStatus()
        .then((st) => {
          if (cancelled) return;
          setStatus(st);
          if (statusBeforeSettingsRef.current !== null && statusBeforeSettingsRef.current !== st) {
            logScreenTimeSettingsChanged({
              setting: 'permission',
              setting_value: st === 'approved' ? 'granted' : 'denied',
            });
          }
          statusBeforeSettingsRef.current = null;
        })
        .catch(() => !cancelled && setStatus(null));
      AsyncStorage.getItem(STORAGE_KEYS.screentimeLastSyncedDate)
        .then((raw) => !cancelled && setLastSynced(raw ? syncLabel(raw) : null))
        .catch(() => !cancelled && setLastSynced(null));
      AsyncStorage.getItem(STORAGE_KEYS.selectionApplyDate)
        // selectionApplyDate는 아래 tomorrowStr()로 예약한 로컬 날짜 — 대조도 같은 로컬 축이다.
        .then((d) => !cancelled && setPendingApply(!!d && d > todayStr()))
        .catch(() => !cancelled && setPendingApply(false));
      return () => {
        cancelled = true;
      };
    }, []),
  );

  // iOS 설정(거부됨 카드 탭)을 다녀와도 이 화면은 포커스가 유지돼 위 useFocusEffect가 재실행되지
  // 않는다 — 앱이 다시 활성화될 때 권한 상태를 재조회해 배지·탭 동작이 낡은 '거부됨'으로 남지
  // 않게 한다(온보딩 ScreenTimeDeniedStep과 동일 수명주기, 코드리뷰 반영).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      ScreenTimeModule.getAuthorizationStatus()
        .then((st) => {
          setStatus((previous) => {
            if (statusBeforeSettingsRef.current !== null && statusBeforeSettingsRef.current !== st) {
              logScreenTimeSettingsChanged({
                setting: 'permission',
                setting_value: st === 'approved' ? 'granted' : 'denied',
              });
            }
            statusBeforeSettingsRef.current = null;
            return st ?? previous;
          });
        })
        .catch(() => {});
    });
    return () => sub.remove();
  }, []);

  // notDetermined 상태 카드 탭 — 시스템 권한창 → 서버 반영 → 상태 재조회.
  // 허용되면 완료 알럿 없이 바로 앱 피커로 이어 측정 대상 설정까지 한 흐름으로 끝낸다(GROMO-978).
  async function requestPermission() {
    if (requesting) return;
    setRequesting(true);
    try {
      const granted = await ScreenTimeModule.requestAuthorization();
      try {
        await updateScreenTimePermission({ granted });
      } catch {
        // 서버 반영 실패는 조용히 무시 — 기기 권한 상태가 진실.
      }
      const st = await ScreenTimeModule.getAuthorizationStatus();
      setStatus(st);
      logScreenTimeSettingsChanged({
        setting: 'permission',
        setting_value: granted ? 'granted' : 'denied',
      });
      if (granted) {
        await editScreenTimeTargets();
      } else {
        Alert.alert('권한이 꺼져 있어요', 'iOS 설정 > 스크린 타임에서 다시 켤 수 있어요.');
      }
    } catch (e) {
      Alert.alert('권한 처리 실패', e instanceof Error ? e.message : String(e));
    } finally {
      setRequesting(false);
    }
  }

  // 거부됨 상태 카드 탭(안드로이드) — 앱 상세 설정(Linking.openSettings)에선 Usage Access를
  // 켤 수 없다. 홈·온보딩과 같이 requestAuthorization이 사용 정보 접근 목록 딥링크 + 복귀
  // 재확인까지 담당하고, 그 결과로 배지 상태를 갱신한다(코드리뷰 반영).
  async function reopenAndroidUsageAccess() {
    if (requesting) return;
    setRequesting(true);
    try {
      const granted = await ScreenTimeModule.requestAuthorization();
      try {
        await updateScreenTimePermission({ granted });
      } catch {
        // 서버 반영 실패는 조용히 무시 — 기기 권한 상태가 진실.
      }
      const st = await ScreenTimeModule.getAuthorizationStatus();
      setStatus(st);
      logScreenTimeSettingsChanged({
        setting: 'permission',
        setting_value: granted ? 'granted' : 'denied',
      });
    } catch (e) {
      Alert.alert('권한 처리 실패', e instanceof Error ? e.message : String(e));
    } finally {
      setRequesting(false);
    }
  }

  // 스크린타임 측정 대상(앱/카테고리) 재선택 — A안(GROMO-942) '다음날 적용'.
  // 이미 측정 중인 상태에서 비어있지 않은 새 대상으로 바꾸면 즉시 반영하지 않고 내일로 예약한다
  // (당일 혼합 합산·자투리 유실 방지). 실제 승격·재등록은 자정에 익스텐션이 처리하고, 앱은
  // ScreenTimeSyncer가 백업으로 처리한다. 최초 설정(미측정) 또는 대상 비우기는 즉시 적용.
  async function editScreenTimeTargets() {
    try {
      const st = await ScreenTimeModule.getAuthorizationStatus();
      if (st !== 'approved') {
        Alert.alert(
          '스크린타임 권한 필요',
          '측정 대상을 고르려면 먼저 스크린타임 권한을 허용해야 해요.',
        );
        return;
      }
      // 직전 await(권한 요청 경로에선 서버 반영까지 최대 15초) 동안 뒤로가기·강제 로그아웃으로
      // 화면을 떠났을 수 있다 — 피커가 엉뚱한 화면 위에 뜨지 않게 포커스를 확인한다(코드리뷰 반영).
      if (!navigation.isFocused()) return;
      const counts = await ScreenTimeModule.presentAppPicker();
      if (!counts) return; // 피커 취소 — picker가 pending에 저장, 여기서 취소면 저장 없음
      const total = counts.applications + counts.categories + counts.webDomains;
      // 이미 측정 중인지 — 버킷 등록 마커로 판단. 미측정(최초 설정)이나 대상 비우기는 즉시,
      // 기존 대상 → 비어있지 않은 새 대상 변경만 다음날 적용으로 예약한다.
      const alreadyMeasuring = !!(await AsyncStorage.getItem(
        STORAGE_KEYS.screentimeBucketMonitorRegistered,
      ));

      // 구 바이너리(OTA로 새 JS만 받음)는 자정 승격 로직이 없어 '다음날 적용'을 예약하면 영영
      // 반영되지 않는다 — 이 경우 예약 대신 즉시 적용으로 폴백한다(코드리뷰 반영).
      if (alreadyMeasuring && total > 0 && nativeSupportsPendingApplyDate()) {
        // A안 예약 — picker가 저장한 pending은 그대로 두고 적용 예정일(내일)만 기록한다.
        // 오늘은 기존 대상으로 계속 측정되고, 자정에 새 대상으로 전환된다.
        const applyDate = tomorrowStr();
        await AsyncStorage.setItem(STORAGE_KEYS.selectionApplyDate, applyDate);
        await ScreenTimeModule.setPendingSelectionApplyDate(applyDate);
        setPendingApply(true); // 측정 대상 행 배지 즉시 반영
        // 선택지 없는 결과 통보 → 토스트(정책 D8/D19 — docs/prd/motion-v2/policy.md, 상위 정본
        // 병합 전까지 여기가 정본). 토스트엔 제목 줄이 없으므로 "즉시 반영이 아니라 **예약**"
        // 이라는 이 통보의 요점을 본문 첫 마디로 끌어온다 — 빠뜨리면 "지금 바뀌었다"로 읽힌다
        // (옛 Alert 제목이 '측정 대상 변경 예약됨'으로 하던 몫이다).
        // ⚠️ 아래 '설정 완료'와 **같은 계약**으로 구 바이너리에서는 Alert를 유지한다 —
        //    nativeSupportsPendingApplyDate()(GROMO-942 빌드)가 true여도 `dismissed`(GROMO-1381
        //    빌드)까지 있다는 보장은 없다. 그쪽 presentAppPicker는 모달 dismiss 완료를 기다리지
        //    않고 promise를 풀어서, 토스트가 아직 떠 있는 피커 아래에서 등장 연출과 2200ms
        //    타이머를 시작한다. 그쪽은 제목이 '예약'을 이미 말하고 2줄 제약도 없으므로 본문은
        //    오늘/내일 대비를 그대로 둔다.
        if (counts.dismissed) {
          show({
            message: `변경을 예약했어요 — 내일부터 앱·카테고리 ${total}개로 측정해요`,
            tone: 'success',
          });
        } else {
          Alert.alert(
            '측정 대상 변경 예약됨',
            `오늘은 기존 대상, 내일부터 앱·카테고리 ${total}개로 측정해요`,
          );
        }
        return;
      }

      // 최초 설정·대상 비우기·구 바이너리 폴백 — 즉시 승격·재등록. 걸려 있던 예약이 있으면 정리한다.
      await ScreenTimeModule.promoteSelection();
      await AsyncStorage.removeItem(STORAGE_KEYS.selectionApplyDate).catch(() => {});
      await ScreenTimeModule.setPendingSelectionApplyDate('').catch(() => false);
      setPendingApply(false); // 즉시 적용이므로 예약 배지 제거
      // 측정 대상이 바뀌면 버킷 모니터 재등록 필수 — threshold 이벤트가 등록 시점 selection 토큰으로
      // 고정되어 있어 재등록 없이는 새 대상이 측정되지 않는다(GROMO-633). 목표 판정은 버킷
      // 사용시간으로 일원화돼 별도 모니터 재등록이 없다(GROMO-942).
      const monitoring = await registerUsageBucketMonitoring(userId);
      if (!monitoring && total === 0) {
        // 빈 선택 — 네이티브가 기존 모니터를 중지하고 등록을 거부한다(threshold는 토큰 없이
        // 발화 불가). 등록 기록을 지워 다음 선택 때 다시 등록되게 하고, 사실대로 안내한다.
        // 측정 시작일·낡은 sync state도 함께 정리 — 안 지우면 이후 미측정 날의 0분이 '측정된
        // 달성'으로 조작 업로드될 수 있다(코드리뷰 P1).
        AsyncStorage.multiRemove([
          STORAGE_KEYS.screentimeBucketMonitorRegistered,
          STORAGE_KEYS.screentimeMeasurementStartDate,
          STORAGE_KEYS.screentimeSyncState,
        ]).catch(() => {});
        Alert.alert(
          '측정 대상 변경됨',
          '측정 대상을 비웠어요 — 사용량 측정과 서버 동기화가 중단돼요. 홈 리포트는 전체 앱 기준으로 표시돼요.',
        );
        return;
      }
      // 성공 통보(선택지 없음) → 토스트. 바로 위 '측정 대상을 비웠어요'는 성공이지만
      // "측정이 중단된다"는 경고성 장문이라 2200ms 배너에 담기지 않아 Alert로 남긴다(정책 D8).
      // ⚠️ 구 바이너리에서는 Alert를 유지한다 — 그쪽 presentAppPicker는 모달 dismiss 완료를
      //    기다리지 않고 promise를 풀어서, 토스트가 아직 떠 있는 피커 아래에서 등장 연출과
      //    2200ms 타이머를 시작한다. 이 JS는 hot-updater로 구 바이너리에도 내려가므로
      //    네이티브 수정만으로는 못 막는다(codex 리뷰). 허용 앱 관리자와 같은 계약이다.
      const pickedMessage = `앱·카테고리 ${total}개를 측정해요`;
      if (counts.dismissed) {
        show({ message: pickedMessage });
      } else {
        Alert.alert('설정 완료', pickedMessage);
      }
    } catch (e) {
      Alert.alert('설정 실패', e instanceof Error ? e.message : String(e));
    }
  }

  const badge = badgeMeta(status);

  // 상태 카드 탭 — 권한 상태별 단일 진입점(GROMO-978). 하단 '권한 요청' 버튼은 제거.
  // 요청 필요→권한 요청(허용 시 바로 앱 피커), 허용됨→앱 피커, 거부됨·확인 중→iOS는 설정
  // 이동, 안드로이드는 Usage Access 재요청(코드리뷰 반영). 구 안드로이드 바이너리(OTA로 새
  // JS만·모듈 없음)는 요청이 설정을 못 열므로 기존 앱 상세 설정 이동을 유지한다.
  function onStatusCardPress() {
    if (status === 'notDetermined') {
      requestPermission();
    } else if (status === 'approved') {
      editScreenTimeTargets();
    } else if (Platform.OS === 'android' && androidNativeModuleAvailable()) {
      reopenAndroidUsageAccess();
    } else {
      statusBeforeSettingsRef.current = status;
      Linking.openSettings();
    }
  }

  // 상태 카드 부제 — 탭했을 때 무슨 일이 일어나는지 상태별로 안내.
  const statusSub =
    status === 'notDetermined'
      ? requesting
        ? '권한 요청 중…'
        : '탭해서 스크린타임 접근을 허용해 주세요'
      : status === 'denied'
        ? Platform.OS === 'android' && androidNativeModuleAvailable()
          ? '탭해서 사용 정보 접근을 다시 허용해 주세요'
          : 'iOS 설정에서 다시 켤 수 있어요'
        : lastSynced
          ? `마지막 동기화 · ${lastSynced}`
          : null;

  return (
    // stretch — 스페이서로 안내문(수집 항목·기기내 처리)을 화면 하단에 붙이되,
    // 작은 기기·큰 글씨로 콘텐츠가 넘치면 스크롤로 전환된다(코덱스 리뷰, PR 301)
    <SettingsScaffold title="스크린타임 관리" onBack={() => navigation.goBack()} stretch>
      {/* 상태 카드 — 권한 배지 + 상태별 안내. 탭 동작은 onStatusCardPress 참고 */}
      <TouchableOpacity style={s.statusCard} activeOpacity={0.8} onPress={onStatusCardPress}>
        <View style={s.iconBox}>
          <Ionicons name="phone-portrait-outline" size={20} color={T.accentDeep} />
        </View>
        <View style={s.flex1}>
          <Text style={s.statusTitle}>스크린타임 접근</Text>
          {statusSub ? <Text style={s.statusSub}>{statusSub}</Text> : null}
        </View>
        <View style={[s.badge, { backgroundColor: badge.bg }]}>
          <Text style={[s.badgeText, { color: badge.color }]}>{badge.label}</Text>
        </View>
        <Ionicons name="chevron-forward" size={17} color={T.inkFaint} />
      </TouchableOpacity>

      {/* 관리 — 측정 대상 앱 설정 (실제 조작 기능이라 접근 카드 바로 아래) */}
      <SettingsSection title="관리">
        <SettingsRow
          icon="apps-outline"
          iconColor={T.accent}
          iconBg={T.accentBg}
          label="측정 대상 앱 설정"
          sub={
            pendingApply ? '변경한 대상은 내일 0시부터 적용돼요' : '사용시간을 잴 앱·카테고리 선택'
          }
          value={pendingApply ? '내일 적용 예정' : undefined}
          valueColor={T.accentDeep}
          onPress={editScreenTimeTargets}
        />
      </SettingsSection>

      {/* 남는 공간 밀어내기 — 아래 안내문들을 화면 하단에 정렬 */}
      <View style={s.flex1} />

      {/* 수집 항목 — 안내문. 설정 행 스타일이면 버튼처럼 보여 노트 카드로 표기(GROMO-848) */}
      <View style={s.noteCard}>
        <View style={s.noteHead}>
          <Ionicons name="time-outline" size={16} color={T.accentDeep} />
          <Text style={s.noteStrong}>수집 항목</Text>
        </View>
        <Text style={s.noteBody}>
          앱별 사용 시간(어떤 앱을 얼마나 썼는지)과{'\n'}카테고리별 분류(SNS · 게임 등 묶음 집계)를
          수집해요.
        </Text>
      </View>

      {/* 기기내 처리 안내 + 권한 종료 시 영향 */}
      <View style={s.noteCard}>
        <View style={s.noteHead}>
          <Ionicons name="lock-closed-outline" size={16} color={T.successInk} />
          <Text style={s.noteStrong}>기기에서만 처리 · 서버 미전송</Text>
        </View>
        <Text style={s.noteBody}>
          권한을 끄면 사용시간 통계가 멈춰요. iOS 설정 앱에서도 바꿀 수 있어요.
        </Text>
      </View>
    </SettingsScaffold>
  );
}

const s = StyleSheet.create({
  flex1: { flex: 1 },

  // 상태 카드
  statusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space.md,
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.paperAlt,
    borderRadius: 16,
    paddingVertical: T.space.lg,
    paddingHorizontal: T.space.lg,
  },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: 13,
    backgroundColor: T.accentBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusTitle: { ...T.text.label, color: T.ink },
  statusSub: { ...T.text.caption, color: T.inkMuted, marginTop: 3 },
  badge: { paddingHorizontal: T.space.md, paddingVertical: T.space.xs, borderRadius: 999 },
  badgeText: { ...T.text.caption },

  // 안내 카드
  noteCard: {
    backgroundColor: T.noteBg,
    borderWidth: 1,
    borderColor: T.noteBorder,
    borderRadius: 14,
    paddingVertical: T.space.md,
    paddingHorizontal: T.space.lg,
    marginTop: T.space.lg,
  },
  noteHead: { flexDirection: 'row', alignItems: 'center', gap: T.space.sm },
  noteStrong: { ...T.text.label, color: T.ink },
  noteBody: { ...T.text.caption, color: T.inkSub, lineHeight: 19, marginTop: T.space.sm },
});
