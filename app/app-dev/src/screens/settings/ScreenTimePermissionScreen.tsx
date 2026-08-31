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
import { supportsAppSelection } from '@/services/screenTimeCapabilities';
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
import { t } from '@/i18n';

// SET · 스크린타임 권한 관리 화면(SettingsScreenTimePermission).
// 권한 상태 배지 + 수집 항목 안내 + 기기내 처리 안내 + '측정 대상 앱 설정'(기존 MenuScreen 이식).
// 상태 카드가 권한 상태별 단일 진입점(GROMO-978): 요청 필요→권한 요청(허용 시 바로 앱 피커),
// 허용됨→앱 피커, 거부됨→iOS는 설정 이동, 안드로이드는 Usage Access 재요청(GROMO-994).

// 저장된 마지막 동기화 날짜 → 상대 라벨(오늘/어제/날짜).
// 축은 로컬 — 대조 대상(screentimeLastSyncedDate)을 screentimeSync가 로컬 todayStr로 쓴다
// (스크린타임 측정·마감 축, docs/date-axis.md 분류 ②).
function syncLabel(raw: string): string {
  const date = raw.slice(0, 10); // 타임스탬프로 저장돼도 날짜부만 사용
  if (date === todayStr()) return t('common.today');
  if (date === yesterdayStr()) return t('settings.screenTimePermission.yesterday');
  return date;
}

// 권한 상태별 배지 메타(라벨·글자색·배경). null = 조회 중.
function badgeMeta(status: AuthorizationStatus | null): {
  label: string;
  color: string;
  bg: string;
} {
  if (status === 'approved')
    return {
      label: t('settings.screenTimePermission.badgeApproved'),
      color: T.successInk,
      bg: T.successBg,
    };
  if (status === 'denied')
    return {
      label: t('settings.screenTimePermission.badgeDenied'),
      color: T.dangerInk,
      bg: T.dangerBg,
    };
  if (status === 'notDetermined')
    return {
      label: t('settings.screenTimePermission.badgeNotDetermined'),
      color: T.inkSub,
      bg: T.sandLight,
    };
  return {
    label: t('settings.screenTimePermission.badgeChecking'),
    color: T.inkMuted,
    bg: T.sandLight,
  };
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
  // 이 화면이 **마지막으로 관찰한** 권한 상태. 변화 감지의 기준선이다 — 최초 관찰은 기록만 하고,
  // 이후 값이 달라졌을 때만 로그·서버 동기화가 돈다(마운트마다 헛 왕복이 생기지 않게).
  const lastObservedStatusRef = useRef<AuthorizationStatus | null>(null);
  // A안(GROMO-942) — 측정 대상 변경이 '내일 적용'으로 예약돼 있으면 측정 대상 행에 배지로 표시.
  // 예약 적용일이 아직 미래(내일)일 때만 노출 — 자정에 승격되면 ScreenTimeSyncer가 마커를 지운다.
  const [pendingApply, setPendingApply] = useState(false);

  // 권한 상태 변화 반영 — 감지 지점이 둘이라(포커스 재진입 · 앱 활성화) 한 곳에 모은다.
  //
  // 서버 동기화가 여기 있는 이유(코드리뷰 반영): 지금까지 서버 반영은 **허용 경로에만** 있었다
  // (온보딩·권한 요청). 회수는 아무 데서도 보내지 않아, 권한을 끄고 돌아와도 서버의
  // is_screen_time_permission_granted 는 true 로 남는다. 그 값을 GroupBetJoinService 의
  // requireScreenTimePermission 이 신뢰하므로, **사용량을 보고할 수 없는 사용자가 SCREEN_TIME
  // 내기에 참가비를 내고 들어갈 수 있다.** 돈이 걸린 자리라 감지 즉시 맞춘다.
  //
  // ⚠️ 이 화면이 떠 있는 동안의 변화만 잡는다. 화면 밖에서 회수하고 이 화면에 오지 않으면
  //    여전히 어긋난 채로 남는다 — 그건 이 화면 혼자 못 메우는 구멍이라 별도 티켓으로 남긴다.
  const reflectStatusChange = useCallback((st: AuthorizationStatus | null) => {
    const sentToSettings = statusBeforeSettingsRef.current;
    statusBeforeSettingsRef.current = null;
    if (sentToSettings !== null && sentToSettings !== st) {
      logScreenTimeSettingsChanged({
        setting: 'permission',
        setting_value: st === 'approved' ? 'granted' : 'denied',
      });
    }

    const before = lastObservedStatusRef.current;
    if (st === null || before === st) return;
    lastObservedStatusRef.current = st;
    if (before === null) return; // 최초 관찰 — 기준선만 세운다

    // 서버 반영 실패는 조용히 무시하되 기준선을 되돌린다 — 다음 감지에서 다시 시도된다.
    // (기기 권한 상태가 진실이라는 기존 규칙은 그대로 — HomeScreen 과 같은 처리다.)
    updateScreenTimePermission({ granted: st === 'approved' }).catch(() => {
      lastObservedStatusRef.current = before;
    });
  }, []);

  // 재진입마다 권한 상태·마지막 동기화 최신값 반영(iOS 설정에서 바꾸고 돌아올 수 있으므로).
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      ScreenTimeModule.getAuthorizationStatus()
        .then((st) => {
          if (cancelled) return;
          setStatus(st);
          reflectStatusChange(st);
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
    }, [reflectStatusChange]),
  );

  // iOS 설정(거부됨 카드 탭)을 다녀와도 이 화면은 포커스가 유지돼 위 useFocusEffect가 재실행되지
  // 않는다 — 앱이 다시 활성화될 때 권한 상태를 재조회해 배지·탭 동작이 낡은 '거부됨'으로 남지
  // 않게 한다(온보딩 ScreenTimeDeniedStep과 동일 수명주기, 코드리뷰 반영).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      ScreenTimeModule.getAuthorizationStatus()
        .then((st) => {
          setStatus((previous) => st ?? previous);
          reflectStatusChange(st);
        })
        .catch(() => {});
    });
    return () => sub.remove();
  }, [reflectStatusChange]);

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
        Alert.alert(
          t('settings.screenTimePermission.permOffTitle'),
          t('settings.screenTimePermission.permOffBody'),
        );
      }
    } catch (e) {
      Alert.alert(
        t('settings.screenTimePermission.permErrorTitle'),
        e instanceof Error ? e.message : String(e),
      );
    } finally {
      setRequesting(false);
    }
  }

  // 사용 정보 접근 목록으로 보낸다 — 못 열면 앱 상세 설정으로 폴백(코드리뷰 반영).
  //
  // 폴백이 필요한 경우: iOS · 구 안드로이드 바이너리(OTA로 새 JS만 받아 네이티브에 이 함수가
  // 없다) · 설정 화면을 못 여는 기기. 폴백이 완전한 답은 아니지만(앱 상세엔 토글이 없다)
  // 아무 일도 안 일어나는 것보다는 낫다 — 이 PR이 없애려는 건 '눌러도 무반응'이다.
  function openUsageAccessOrAppSettings() {
    ScreenTimeModule.openUsageAccessSettings()
      .then((opened) => {
        if (!opened) Linking.openSettings();
      })
      .catch(() => Linking.openSettings());
  }

  // 거부됨 상태 카드 탭(안드로이드) — 앱 상세 설정(Linking.openSettings)에선 Usage Access를
  // 켤 수 없다. 홈·온보딩과 같이 requestAuthorization이 사용 정보 접근 목록 딥링크 + 복귀
  // 재확인까지 담당하고, 그 결과로 배지 상태를 갱신한다(코드리뷰 반영).
  async function reopenAndroidUsageAccess() {
    if (requesting) return;
    setRequesting(true);
    const statusBeforeRequest = status;
    try {
      const granted = await ScreenTimeModule.requestAuthorization();
      try {
        await updateScreenTimePermission({ granted });
      } catch {
        // 서버 반영 실패는 조용히 무시 — 기기 권한 상태가 진실.
      }
      const st = await ScreenTimeModule.getAuthorizationStatus();
      setStatus(st);
      if (statusBeforeRequest !== null && statusBeforeRequest !== st) {
        logScreenTimeSettingsChanged({
          setting: 'permission',
          setting_value: st === 'approved' ? 'granted' : 'denied',
        });
      }
    } catch (e) {
      Alert.alert(
        t('settings.screenTimePermission.permErrorTitle'),
        e instanceof Error ? e.message : String(e),
      );
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

      // ⚠️ 포커스 확인을 **플랫폼 분기보다 앞에** 둔다(코드리뷰 반영). 권한 요청 경로는 설정
      //    복귀와 서버 반영(최대 15초)을 기다리는데, 그동안 뒤로가기·강제 로그아웃으로 이 화면을
      //    떠날 수 있다. 예전엔 안드로이드가 이 검사를 건너뛰고 이동해서, **이미 떠난 화면이
      //    다른 화면 위에 피커를 갑자기 push** 할 수 있었다.
      if (!navigation.isFocused()) return;

      // 안드로이드는 시스템 피커가 없어 RN 화면으로 간다(GROMO-995). 아래 iOS 경로의 '다음날
      // 적용' 예약도 여기선 불필요하다 — 조회 시점에 원시 이벤트를 필터링해 재계산하므로
      // 대상을 바꾸면 오늘분도 새 기준으로 일관되게 다시 계산된다(네이티브 주석과 같은 근거).
      if (Platform.OS === 'android') {
        if (st !== 'approved') {
          Alert.alert(
            t('settings.screenTimePermission.permNeededTitle'),
            t('settings.screenTimePermission.permNeededAndroidBody'),
          );
          return;
        }
        // ⚠️ 관리 행을 숨기는 게이트만으로는 부족하다(코드리뷰 반영). 구 바이너리에서 권한이
        //    notDetermined 면 상태 카드가 requestPermission() 을 거쳐 여기로 오는데, 그 경로엔
        //    술어 검사가 없어서 **빈 목록에 저장도 no-op 인 화면**에 도달한다.
        if (!supportsAppSelection()) {
          Alert.alert(
            t('settings.screenTimePermission.unsupportedTitle'),
            t('settings.screenTimePermission.unsupportedBody'),
          );
          return;
        }
        navigation.navigate('SettingsAppPicker', { mode: 'measured' });
        return;
      }
      if (st !== 'approved') {
        Alert.alert(
          t('settings.screenTimePermission.permNeededTitle'),
          t('settings.screenTimePermission.permNeededIosBody'),
        );
        return;
      }
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
            message: t('settings.screenTimePermission.scheduledToast', { count: total }),
            tone: 'success',
          });
        } else {
          Alert.alert(
            t('settings.screenTimePermission.scheduledTitle'),
            t('settings.screenTimePermission.scheduledBody', { count: total }),
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
          t('settings.screenTimePermission.clearedTitle'),
          t('settings.screenTimePermission.clearedBody'),
        );
        return;
      }
      // 성공 통보(선택지 없음) → 토스트. 바로 위 '측정 대상을 비웠어요'는 성공이지만
      // "측정이 중단된다"는 경고성 장문이라 2200ms 배너에 담기지 않아 Alert로 남긴다(정책 D8).
      // ⚠️ 구 바이너리에서는 Alert를 유지한다 — 그쪽 presentAppPicker는 모달 dismiss 완료를
      //    기다리지 않고 promise를 풀어서, 토스트가 아직 떠 있는 피커 아래에서 등장 연출과
      //    2200ms 타이머를 시작한다. 이 JS는 hot-updater로 구 바이너리에도 내려가므로
      //    네이티브 수정만으로는 못 막는다(codex 리뷰). 허용 앱 관리자와 같은 계약이다.
      const pickedMessage = t('settings.screenTimePermission.pickedMessage', { count: total });
      if (counts.dismissed) {
        show({ message: pickedMessage });
      } else {
        Alert.alert(t('settings.screenTimePermission.saveDoneTitle'), pickedMessage);
      }
    } catch (e) {
      Alert.alert(
        t('settings.screenTimePermission.saveFailTitle'),
        e instanceof Error ? e.message : String(e),
      );
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
    } else if (status === 'approved' && supportsAppSelection()) {
      editScreenTimeTargets();
    } else if (status === 'approved') {
      // 피커가 없는 플랫폼 — 허용 상태에서 탭할 곳이 피커뿐이라 그대로 두면 무반응이다.
      // 권한을 끄고 싶을 때 갈 곳(사용 정보 접근)으로 보낸다(GROMO-1592).
      //
      // ⚠️ 여기서 Linking.openSettings()를 바로 부르면 안 된다(코드리뷰 반영). 그건 앱 상세
      //    설정을 여는데 거기엔 사용 정보 접근 토글이 없다 — 162행 주석이 짚은 바로 그 문제다.
      //    requestAuthorization도 못 쓴다: 이미 허용된 상태면 설정을 열지 않고 즉시 resolve한다.
      //    그래서 상태와 무관하게 목록을 여는 전용 함수를 쓰고, 실패할 때만 앱 상세로 폴백한다.
      statusBeforeSettingsRef.current = status;
      openUsageAccessOrAppSettings();
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
        ? t('settings.screenTimePermission.requesting')
        : t('settings.screenTimePermission.tapToAllow')
      : status === 'denied'
        ? Platform.OS === 'android' && androidNativeModuleAvailable()
          ? t('settings.screenTimePermission.tapToReallowAndroid')
          : t('settings.screenTimePermission.deniedIos')
        : lastSynced
          ? t('settings.screenTimePermission.lastSynced', { date: lastSynced })
          : null;

  return (
    // stretch — 스페이서로 안내문(수집 항목·기기내 처리)을 화면 하단에 붙이되,
    // 작은 기기·큰 글씨로 콘텐츠가 넘치면 스크롤로 전환된다(코덱스 리뷰, PR 301)
    <SettingsScaffold
      title={t('settings.screenTimePermission.title')}
      onBack={() => navigation.goBack()}
      stretch
    >
      {/* 상태 카드 — 권한 배지 + 상태별 안내. 탭 동작은 onStatusCardPress 참고 */}
      <TouchableOpacity style={s.statusCard} activeOpacity={0.8} onPress={onStatusCardPress}>
        <View style={s.iconBox}>
          <Ionicons name="phone-portrait-outline" size={20} color={T.accentDeep} />
        </View>
        <View style={s.flex1}>
          <Text style={s.statusTitle}>{t('settings.screenTimePermission.statusTitle')}</Text>
          {statusSub ? <Text style={s.statusSub}>{statusSub}</Text> : null}
        </View>
        <View style={[s.badge, { backgroundColor: badge.bg }]}>
          <Text style={[s.badgeText, { color: badge.color }]}>{badge.label}</Text>
        </View>
        <Ionicons name="chevron-forward" size={17} color={T.inkFaint} />
      </TouchableOpacity>

      {/* 관리 — 측정 대상 앱 설정 (실제 조작 기능이라 접근 카드 바로 아래).
          피커가 없는 플랫폼에서는 섹션째 감춘다 — 행을 남기면 탭해도 아무 일이 없어
          고장으로 보인다(GROMO-1592). 안드로이드는 전체 앱을 측정하므로 고를 대상도 없다. */}
      {supportsAppSelection() ? (
        <SettingsSection title={t('settings.screenTimePermission.manageSection')}>
          <SettingsRow
            icon="apps-outline"
            iconColor={T.accent}
            iconBg={T.accentBg}
            label={t('settings.screenTimePermission.targetsLabel')}
            sub={
              pendingApply
                ? t('settings.screenTimePermission.targetsPendingSub')
                : // 카테고리 묶음 선택은 iOS FamilyActivityPicker만 준다 — 안드로이드는 앱 단위다.
                  Platform.OS === 'android'
                  ? t('settings.screenTimePermission.targetsSubAndroid')
                  : t('settings.screenTimePermission.targetsSubIos')
            }
            value={
              pendingApply ? t('settings.screenTimePermission.targetsPendingValue') : undefined
            }
            valueColor={T.accentDeep}
            onPress={editScreenTimeTargets}
          />
        </SettingsSection>
      ) : null}

      {/* 남는 공간 밀어내기 — 아래 안내문들을 화면 하단에 정렬 */}
      <View style={s.flex1} />

      {/* 수집 항목 — 안내문. 설정 행 스타일이면 버튼처럼 보여 노트 카드로 표기(GROMO-848) */}
      <View style={s.noteCard}>
        <View style={s.noteHead}>
          <Ionicons name="time-outline" size={16} color={T.accentDeep} />
          <Text style={s.noteStrong}>{t('settings.screenTimePermission.collectTitle')}</Text>
        </View>
        <Text style={s.noteBody}>{t('settings.screenTimePermission.collectBody')}</Text>
      </View>

      {/* 기기내 처리 안내 + 권한 종료 시 영향 */}
      <View style={s.noteCard}>
        <View style={s.noteHead}>
          <Ionicons name="lock-closed-outline" size={16} color={T.successInk} />
          <Text style={s.noteStrong}>{t('settings.screenTimePermission.localOnlyTitle')}</Text>
        </View>
        {/* 권한을 끄러 가는 곳은 OS마다 다르다 — 안드로이드에 'iOS 설정 앱'이라고 안내하면
            찾아갈 수 없는 곳을 가리킨다(GROMO-1592).
            ⚠️ Platform.select가 아니라 Platform.OS 비교인 이유: select는 번들 시점에 플랫폼별
            구현이 박혀 테스트에서 OS를 바꿔도 분기가 따라오지 않는다(검증 불가). */}
        <Text style={s.noteBody}>
          {t('settings.screenTimePermission.permOffNote')}{' '}
          {Platform.OS === 'ios'
            ? t('settings.screenTimePermission.changeIos')
            : Platform.OS === 'android'
              ? t('settings.screenTimePermission.changeAndroid')
              : t('settings.screenTimePermission.changeOther')}
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
