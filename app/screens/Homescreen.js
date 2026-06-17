import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Platform,
  ActivityIndicator,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { useEquipment } from '../contexts/EquipmentContext';
import { useFocus } from '../contexts/FocusContext';
import { useUser } from '../contexts/UserContext';
import { useCoins } from '../contexts/CoinContext';
import { Character2D } from '../components/character/Character2D';
import { T } from '../components/theme';
import ScreenTimeModule from '../utils/ScreenTimeModule';
import ScreenTimeReportView from '../components/ScreenTimeReportView';
import { todayStr, localDateStr } from '../utils/localDate';
import { apiFetch } from '../utils/api';

function formatFocusTime(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  if (h > 0) return `${h}시간 ${m}분`;
  if (m > 0) return `${m}분`;
  return '0분';
}

function NotebookLines() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {Array.from({ length: 14 }).map((_, i) => (
        <View key={i} style={[s.ruleLine, { top: 28 + i * 28 }]} />
      ))}
    </View>
  );
}

function formatGoalTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h === 0) return `${m}분`;
  if (m === 0) return `${h}시간`;
  return `${h}시간 ${m}분`;
}

function StatBox({ label, value, valueComponent }) {
  return (
    <View style={s.statBox}>
      <Text style={s.statLabel}>{label}</Text>
      {valueComponent ?? <Text style={s.statValue}>{value}</Text>}
    </View>
  );
}

// ── Furniture 2D components ──────────────────────────────────────────────────

function Desk2D() {
  return (
    <View style={f.deskWrap}>
      <View style={f.deskMonitor}>
        <View style={f.deskScreen} />
        <View style={f.deskStand} />
      </View>
      <View style={f.deskTop} />
      <View style={f.deskLegs}>
        <View style={f.deskLeg} />
        <View style={f.deskLeg} />
      </View>
    </View>
  );
}

function Bed2D() {
  return (
    <View style={f.bedWrap}>
      {/* Headboard */}
      <View style={f.headboard} />
      {/* Mattress + pillow */}
      <View style={f.mattress}>
        <View style={f.pillow} />
        <View style={f.blanket} />
      </View>
      {/* Legs */}
      <View style={f.bedLegs}>
        <View style={f.bedLeg} />
        <View style={f.bedLeg} />
      </View>
    </View>
  );
}

function Window2D() {
  return (
    <View style={f.window}>
      {/* Frame dividers */}
      <View style={f.windowV} />
      <View style={f.windowH} />
      {/* Content panes */}
      <View style={[f.pane, f.paneTL]}>
        <Text style={f.paneText}>☁</Text>
      </View>
      <View style={[f.pane, f.paneTR]}>
        <Text style={f.paneText}>✦</Text>
      </View>
      <View style={[f.pane, f.paneBL]}>
        <Text style={f.paneText}>☀</Text>
      </View>
      <View style={[f.pane, f.paneBR]}>
        <Text style={f.paneText}>·</Text>
      </View>
    </View>
  );
}

function Frame2D() {
  return (
    <View style={f.frame}>
      <View style={f.frameInner}>
        {/* Simple mountain scene */}
        <View style={f.mountain1} />
        <View style={f.mountain2} />
        <View style={f.frameSun} />
      </View>
    </View>
  );
}

function Carpet2D() {
  return (
    <View style={f.carpet}>
      <View style={f.carpetInner} />
      <View style={f.carpetDot} />
    </View>
  );
}

// ── Room scene ───────────────────────────────────────────────────────────────

function Room({ equippedFurniture, costumeSlots }) {
  const ids = equippedFurniture.map((i) => i.id);
  const has = (id) => ids.includes(id);

  return (
    <View style={s.room}>
      {/* Background layers */}
      <View style={s.roomWall} />
      <View style={s.roomFloor} />

      {/* Wall decorations */}
      {has('window') && (
        <View style={s.windowPos}>
          <Window2D />
        </View>
      )}
      {has('frame') && (
        <View style={s.framePos}>
          <Frame2D />
        </View>
      )}

      {/* Floor items (rendered before character for z-order) */}
      {has('carpet') && (
        <View style={s.carpetPos}>
          <Carpet2D />
        </View>
      )}
      {has('bed') && (
        <View style={s.bedPos}>
          <Bed2D />
        </View>
      )}
      {has('desk') && (
        <View style={s.deskPos}>
          <Desk2D />
        </View>
      )}

      {/* Character on top */}
      <View style={s.charPos}>
        <Character2D size={128} costumeSlots={costumeSlots} />
      </View>

      {/* Ambient deco */}
      <Text style={[s.deco, s.decoStar1]}>★</Text>
      <Text style={[s.deco, s.decoStar2]}>✦</Text>
    </View>
  );
}

// ── Screen ───────────────────────────────────────────────────────────────────

function formatTime(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const sec = totalSeconds % 60;
  return [h, m, sec].map((v) => String(v).padStart(2, '0')).join(':');
}

export default function HomeScreen({ navigation, route }) {
  const { equippedItem, equippedFurniture, equippedCostume } = useEquipment();
  const { todayFocusSeconds } = useFocus();
  const { nickname, goalSeconds, setGoalSeconds, phoneUsageSeconds } = useUser();
  const { addCoins } = useCoins();
  const costumeSlots = equippedCostume.map((c) => c.slot);
  const remainingSeconds = Math.max(0, goalSeconds - phoneUsageSeconds);
  const [focusResult, setFocusResult] = useState(null);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [showFailModal, setShowFailModal] = useState(false);
  const [showUsageModal, setShowUsageModal] = useState(false);
  const [screenTimeSeconds, setScreenTimeSeconds] = useState(0);
  const [authStatus, setAuthStatus] = useState(null); // null = 확인 중

  // 스크린 타임 접근 권한 상태 확인
  // 콜드 런치 직후 getAuthorizationStatus()가 notDetermined를 잘못 주는 quirk가 있어,
  // 이전 승인 이력(authGranted)을 캐시해 낙관적으로 표시하고 확정 답만 신뢰
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    (async () => {
      const cached = await AsyncStorage.getItem('gromo:screentime:authGranted');
      if (cached === '1') setAuthStatus('approved'); // 이전 승인 → 일단 승인으로 표시

      const live = await ScreenTimeModule.getAuthorizationStatus();
      if (live === 'approved') {
        setAuthStatus('approved');
        await AsyncStorage.setItem('gromo:screentime:authGranted', '1');
      } else if (live === 'denied') {
        // 사용자가 설정에서 실제로 권한을 끈 경우 → 캐시 무효화
        setAuthStatus('denied');
        await AsyncStorage.removeItem('gromo:screentime:authGranted');
      } else if (cached !== '1') {
        // notDetermined인데 승인 이력도 없으면 미설정 (이력 있으면 quirk로 보고 승인 유지)
        setAuthStatus('notDetermined');
      }
    })();
  }, []);

  // 앱 실행 시: 다음날 적용 예정인 목표/측정대상을 승격한 뒤 자정 모니터링 등록
  // (목표·측정대상 변경은 당일엔 반영 안 되고, 적용 예정일이 지난 다음 실행 때 여기서 승격됨)
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    (async () => {
      const today = todayStr();

      // 1) 측정 대상: 적용 예정일이 지났으면 대기 → 활성 승격
      const selApply = await AsyncStorage.getItem('gromo:selection:applyDate');
      if (selApply && today >= selApply) {
        await ScreenTimeModule.promoteSelection();
        // 표시용 개수도 내일(pending) → 오늘(active)로 이동
        const pendingCounts = await AsyncStorage.getItem('gromo:selection:pendingCounts');
        if (pendingCounts) {
          await AsyncStorage.setItem('gromo:selection:counts', pendingCounts);
          await AsyncStorage.removeItem('gromo:selection:pendingCounts');
        }
        await AsyncStorage.removeItem('gromo:selection:applyDate');
      }

      // 2) 목표 시간: 적용 예정일이 지났으면 대기 → 활성 승격
      let effectiveGoal = goalSeconds;
      const pendingRaw = await AsyncStorage.getItem('gromo:goal:pending');
      if (pendingRaw) {
        const { minutes, applyDate } = JSON.parse(pendingRaw);
        if (today >= applyDate) {
          effectiveGoal = minutes * 60;
          setGoalSeconds(effectiveGoal);
          // gromo:user에도 반영 → 다음 실행부터 이 값이 활성으로 로드됨
          const raw = await AsyncStorage.getItem('gromo:user');
          if (raw) {
            const data = JSON.parse(raw);
            data.dailyScreenTimeGoalMinutes = minutes;
            await AsyncStorage.setItem('gromo:user', JSON.stringify(data));
          }
          await AsyncStorage.removeItem('gromo:goal:pending');
        }
      }

      // 3) 활성 목표 + 활성 측정대상으로 자정 모니터링 등록
      await ScreenTimeModule.startGoalMonitoring(effectiveGoal);
    })();
    // 마운트(앱 실행) 시 1회만 실행
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 앱 진입 시 어제 목표 달성 여부 확인 → 미처리 결과면 성공/실패 모달 표시
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    (async () => {
      const result = await ScreenTimeModule.getYesterdayResult();
      if (!result) return;
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = localDateStr(yesterday);

      // 1) 서버에 어제 달성 결과 저장 (보상 가드와 별개 → 전송 실패 시 다음 진입에 재시도)
      const lastSyncedDate = await AsyncStorage.getItem('gromo:screentime:lastSyncedDate');
      if (lastSyncedDate !== yesterdayStr) {
        try {
          // reportedAt: 어제 정오(로컬) → 타임존 환산 시 날짜가 어제로 안전하게 떨어짐
          const reportedAt = new Date(yesterday);
          reportedAt.setHours(12, 0, 0, 0);
          await apiFetch('/api/v1/screen-time', {
            method: 'POST',
            body: JSON.stringify({
              screenTimeGoalAchieved: result === 'success',
              actualScreenTimeMinutes: null, // 실제 사용시간(분)은 현재 미지원 → 서버가 0으로 저장
              reportedAt: reportedAt.toISOString(),
              timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            }),
          });
          await AsyncStorage.setItem('gromo:screentime:lastSyncedDate', yesterdayStr);
        } catch (e) {
          console.log('스크린타임 결과 서버 저장 실패:', e);
        }
      }

      // 2) 보상 모달 (하루 1회)
      const lastRewardedDate = await AsyncStorage.getItem('gromo:screentime:lastRewardedDate');
      if (lastRewardedDate === yesterdayStr) return;
      await AsyncStorage.setItem('gromo:screentime:lastRewardedDate', yesterdayStr);
      if (result === 'success') {
        await addCoins(100);
        setShowSuccessModal(true);
      } else {
        setShowFailModal(true);
      }
    })();
  }, [addCoins]);

  async function handleRequestAuth() {
    const approved = await ScreenTimeModule.requestAuthorization();
    setAuthStatus(approved ? 'approved' : 'denied');
    if (approved) {
      await AsyncStorage.setItem('gromo:screentime:authGranted', '1');
    } else {
      await AsyncStorage.removeItem('gromo:screentime:authGranted');
    }
  }

  // 앱 홈에 진입할 때마다 실시간 스크린 타임 조회
  useEffect(() => {
    const fetchScreenTime = async () => {
      try {
        const seconds = await ScreenTimeModule.getTotalScreenTime();
        setScreenTimeSeconds(seconds);
      } catch (error) {
        console.log('스크린 타임 조회 실패:', error);
      }
    };
    fetchScreenTime();
    // 30초마다 갱신
    const interval = setInterval(fetchScreenTime, 30000);
    return () => clearInterval(interval);
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      if (route.params?.focusResult) {
        setFocusResult(route.params.focusResult);
        navigation.setParams({ focusResult: undefined });
      }
    }, [route.params?.focusResult, navigation]),
  );

  return (
    <View style={s.container}>
      <StatusBar style="dark" />
      <Modal visible={showSuccessModal} transparent animationType="fade">
        <View style={s.resultOverlay}>
          <View style={s.resultBox}>
            <Text style={s.resultTitle}>스크린 타임 목표 달성!</Text>
            <View style={s.resultRow}>
              <Text style={s.resultLabel}>획득 코인</Text>
              <Text style={s.resultValue}>+100</Text>
            </View>
            <TouchableOpacity
              style={s.resultBtn}
              onPress={() => setShowSuccessModal(false)}
              activeOpacity={0.7}
            >
              <Text style={s.resultBtnText}>확인</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={showFailModal} transparent animationType="fade">
        <View style={s.resultOverlay}>
          <View style={s.resultBox}>
            <Text style={s.resultTitle}>어제 스크린 타임 목표 달성에 실패했어요!</Text>
            <Text style={s.resultFailSub}>오늘은 조금 더 핸드폰을 적게 써봐요!</Text>
            <TouchableOpacity
              style={s.resultBtn}
              onPress={() => setShowFailModal(false)}
              activeOpacity={0.7}
            >
              <Text style={s.resultBtnText}>확인</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={!!focusResult} transparent animationType="fade">
        <View style={s.resultOverlay}>
          <View style={s.resultBox}>
            <Text style={s.resultTitle}>집중 완료!</Text>
            {(focusResult?.tagName || focusResult?.subject) && (
              <Text style={s.resultSession}>
                {focusResult.tagName}
                {focusResult.tagName && focusResult.subject ? '  ·  ' : ''}
                {focusResult.subject}
              </Text>
            )}
            <View style={s.resultRow}>
              <Text style={s.resultLabel}>이번 세션</Text>
              <Text style={s.resultValue}>{formatTime(focusResult?.sessionSeconds ?? 0)}</Text>
            </View>
            <View style={s.resultRow}>
              <Text style={s.resultLabel}>오늘 전체</Text>
              <Text style={s.resultValue}>{formatTime(focusResult?.totalSeconds ?? 0)}</Text>
            </View>
            <View style={s.resultRow}>
              <Text style={s.resultLabel}>획득 코인</Text>
              <Text style={s.resultValue}>💰 {focusResult?.coinsEarned ?? 0}</Text>
            </View>
            <TouchableOpacity
              style={s.resultBtn}
              onPress={() => setFocusResult(null)}
              activeOpacity={0.7}
            >
              <Text style={s.resultBtnText}>확인</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* 측정 중인 앱별 사용시간 오버레이 ("사용" 칸 탭 시)
          RN Modal은 별도 윈도우에 렌더돼 DeviceActivityReport scene이 활성화 안 됨
          → 같은 화면 계층에 absolute 오버레이로 띄워야 리포트가 정상 호스팅됨 */}
      {showUsageModal && (
        <View style={s.usageOverlay}>
          <View style={s.usageBox}>
            <Text style={s.resultTitle}>측정 중인 앱 사용시간</Text>
            {Platform.OS === 'ios' && authStatus === 'approved' ? (
              <View style={s.usageReportWrap}>
                {/* 뒤에 깔린 로딩 스피너 — 리포트가 다 뜨면 그 위를 덮음 */}
                <View style={s.usageLoading}>
                  <ActivityIndicator color={T.ink} />
                  <Text style={s.usageLoadingText}>불러오는 중...</Text>
                </View>
                <ScreenTimeReportView reportContext="Total Activity" style={s.usageReport} />
              </View>
            ) : (
              <Text style={s.usageEmpty}>스크린 타임 권한이 필요합니다</Text>
            )}
            <TouchableOpacity
              style={s.resultBtn}
              onPress={() => setShowUsageModal(false)}
              activeOpacity={0.7}
            >
              <Text style={s.resultBtnText}>닫기</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
      <NotebookLines />

      <View style={s.header}>
        <Text style={s.headerTitle}>오늘의 {nickname} ✦</Text>
        <Text style={s.headerSub}>오늘도 열심히 집중해요</Text>
      </View>

      <View style={s.statsRow}>
        <StatBox label="목표" value={formatGoalTime(goalSeconds)} />
        <StatBox
          label="사용"
          valueComponent={
            Platform.OS === 'ios' ? (
              authStatus === 'approved' ? (
                <View style={s.statValueReport}>
                  <ScreenTimeReportView reportContext="Compact Activity" style={s.statReportFill} />
                  {/* 리포트 뷰 위에 투명 터치 레이어 → 탭 시 앱별 사용시간 모달 */}
                  <TouchableOpacity
                    style={s.statReportFill}
                    onPress={() => setShowUsageModal(true)}
                    activeOpacity={0.6}
                  />
                </View>
              ) : authStatus === null ? (
                <Text style={s.statValue}>—</Text>
              ) : (
                <TouchableOpacity onPress={handleRequestAuth}>
                  <Text style={s.statValue}>권한 허용</Text>
                </TouchableOpacity>
              )
            ) : (
              <Text style={s.statValue}>{formatFocusTime(screenTimeSeconds)}</Text>
            )
          }
        />
        <StatBox
          label="남은"
          valueComponent={
            Platform.OS === 'ios' && authStatus === 'approved' ? (
              <ScreenTimeReportView
                reportContext="Remaining Activity"
                goalSeconds={goalSeconds}
                style={s.statValueReport}
              />
            ) : Platform.OS === 'ios' && authStatus === null ? (
              <Text style={s.statValue}>—</Text>
            ) : goalSeconds - screenTimeSeconds < 0 ? (
              <Text style={[s.statValue, s.statValueFail]}>달성 실패</Text>
            ) : (
              <Text style={s.statValue}>{formatFocusTime(goalSeconds - screenTimeSeconds)}</Text>
            )
          }
        />
      </View>

      <View style={s.roomWrap}>
        <Room equippedFurniture={equippedFurniture} costumeSlots={costumeSlots} />
      </View>

      <View style={s.bottomCard}>
        <View style={s.bottomRow}>
          <View>
            <Text style={s.focusLabel}>오늘 집중 ⏱</Text>
            <Text style={s.focusTime}>{formatFocusTime(todayFocusSeconds)}</Text>
            {equippedItem && <Text style={s.equippedHint}>✔ {equippedItem.name} 장착중</Text>}
          </View>
          <TouchableOpacity
            style={s.startBtn}
            onPress={() => navigation.navigate('FocusCategoryScreen')}
            activeOpacity={0.7}
          >
            <Text style={s.startBtnText}>집중 시작!</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

// ── Furniture styles ─────────────────────────────────────────────────────────
const f = StyleSheet.create({
  // Desk
  deskWrap: { alignItems: 'center' },
  deskMonitor: { alignItems: 'center', marginBottom: 2 },
  deskScreen: {
    width: 44,
    height: 30,
    borderRadius: 3,
    backgroundColor: '#E0E0E0',
    borderWidth: 2.5,
    borderColor: T.ink,
  },
  deskStand: { width: 5, height: 6, backgroundColor: T.inkMed },
  deskTop: {
    width: 78,
    height: 9,
    borderRadius: 3,
    backgroundColor: '#AAAAAA',
    borderWidth: 2,
    borderColor: T.ink,
  },
  deskLegs: { flexDirection: 'row', gap: 50, marginTop: 2 },
  deskLeg: {
    width: 6,
    height: 24,
    borderRadius: 3,
    backgroundColor: '#888888',
    borderWidth: 1.5,
    borderColor: T.ink,
  },

  // Bed
  bedWrap: { flexDirection: 'row', alignItems: 'flex-end' },
  headboard: {
    width: 14,
    height: 52,
    borderRadius: 7,
    backgroundColor: '#BBBBBB',
    borderWidth: 2.5,
    borderColor: T.ink,
  },
  mattress: {
    width: 70,
    height: 38,
    borderRadius: 6,
    backgroundColor: '#F0F0F0',
    borderWidth: 2,
    borderColor: T.ink,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    gap: 6,
  },
  pillow: {
    width: 22,
    height: 26,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: T.inkLight,
  },
  blanket: {
    flex: 1,
    height: 24,
    borderRadius: 5,
    backgroundColor: '#CCCCCC',
    borderWidth: 1.5,
    borderColor: T.ink,
  },
  bedLegs: {
    position: 'absolute',
    bottom: -12,
    left: 14,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
  },
  bedLeg: {
    width: 8,
    height: 12,
    borderRadius: 3,
    backgroundColor: '#AAAAAA',
    borderWidth: 1.5,
    borderColor: T.ink,
  },

  // Window
  window: {
    width: 62,
    height: 58,
    borderRadius: 4,
    backgroundColor: '#E8E8E8',
    borderWidth: 2.5,
    borderColor: T.ink,
    position: 'relative',
    overflow: 'hidden',
  },
  windowV: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: '50%',
    width: 2.5,
    backgroundColor: T.ink,
  },
  windowH: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '50%',
    height: 2.5,
    backgroundColor: T.ink,
  },
  pane: {
    position: 'absolute',
    width: 26,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  paneTL: { top: 0, left: 0 },
  paneTR: { top: 0, right: 0 },
  paneBL: { bottom: 0, left: 0 },
  paneBR: { bottom: 0, right: 0 },
  paneText: { fontSize: 11, color: T.inkMed },

  // Picture frame
  frame: {
    width: 54,
    height: 46,
    borderRadius: 4,
    borderWidth: 3,
    borderColor: T.inkMed,
    backgroundColor: '#888888',
    padding: 3,
  },
  frameInner: {
    flex: 1,
    borderRadius: 2,
    backgroundColor: '#F0F0F0',
    overflow: 'hidden',
    position: 'relative',
  },
  mountain1: {
    position: 'absolute',
    bottom: 0,
    left: -4,
    width: 0,
    height: 0,
    borderLeftWidth: 22,
    borderRightWidth: 22,
    borderBottomWidth: 28,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: '#AAAAAA',
  },
  mountain2: {
    position: 'absolute',
    bottom: 0,
    right: -4,
    width: 0,
    height: 0,
    borderLeftWidth: 18,
    borderRightWidth: 18,
    borderBottomWidth: 22,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: '#888888',
  },
  frameSun: {
    position: 'absolute',
    top: 4,
    right: 6,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: T.yellow,
    borderWidth: 1.5,
    borderColor: T.yellowDark,
  },

  // Carpet
  carpet: {
    width: 140,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#BBBBBB',
    borderWidth: 2.5,
    borderColor: T.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  carpetInner: {
    width: 120,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#D0D0D0',
    borderWidth: 1.5,
    borderColor: T.ink,
  },
  carpetDot: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: T.yellow,
    borderWidth: 1.5,
    borderColor: T.ink,
  },
});

// ── Screen styles ─────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.paper, paddingTop: 52, paddingHorizontal: 16 },

  ruleLine: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: T.paperLine },

  header: { marginBottom: 14, paddingLeft: 4 },
  headerTitle: { fontSize: 26, fontWeight: '900', color: T.ink, letterSpacing: -0.5 },
  headerSub: { fontSize: 13, color: T.inkMed, marginTop: 2 },

  statsRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  statBox: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: T.inkLight,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  statLabel: { fontSize: 10, fontWeight: '700', color: T.ink, opacity: 0.7 },
  statValue: { fontSize: 15, fontWeight: '900', color: T.ink, marginTop: 4 },
  statValueFail: { color: T.danger },
  statValueReport: { width: '100%', height: 20, marginTop: 4 },
  statReportFill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },

  roomWrap: {
    flex: 1,
    borderWidth: 2.5,
    borderColor: T.ink,
    borderRadius: 20,
    overflow: 'hidden',
    marginBottom: 14,
  },
  room: { flex: 1, position: 'relative' },
  roomWall: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: '38%',
    backgroundColor: '#F0F0F0',
  },
  roomFloor: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '40%',
    backgroundColor: '#E0E0E0',
    borderTopWidth: 2.5,
    borderTopColor: T.ink,
  },

  // Furniture positions
  windowPos: { position: 'absolute', top: '8%', left: '8%' },
  framePos: { position: 'absolute', top: '6%', right: '10%' },
  carpetPos: { position: 'absolute', bottom: '30%', alignSelf: 'center' },
  bedPos: { position: 'absolute', bottom: '36%', left: '4%' },
  deskPos: { position: 'absolute', right: '5%', bottom: '33%' },

  charPos: { position: 'absolute', bottom: '26%', alignSelf: 'center' },

  deco: { position: 'absolute', fontSize: 16, color: T.inkLight },
  decoStar1: { top: 10, left: 16 },
  decoStar2: { top: 18, right: 22 },

  bottomCard: {
    padding: 18,
    marginBottom: 8,
    borderWidth: 1.5,
    borderColor: T.inkLight,
    borderRadius: 12,
  },
  bottomRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  focusLabel: { fontSize: 13, fontWeight: '700', color: T.inkMed },
  focusTime: { fontSize: 28, fontWeight: '900', color: T.ink, marginTop: 2, letterSpacing: -1 },
  equippedHint: { fontSize: 11, fontWeight: '700', color: T.mintDark, marginTop: 4 },

  startBtn: {
    backgroundColor: T.ink,
    borderRadius: 8,
    paddingVertical: 14,
    paddingHorizontal: 20,
  },
  startBtnText: { fontSize: 15, fontWeight: '700', color: '#FFFFFF' },

  resultOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  resultBox: {
    width: '100%',
    backgroundColor: T.paper,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: T.inkLight,
    padding: 28,
    gap: 16,
  },
  resultTitle: { fontSize: 20, fontWeight: '900', color: T.ink, textAlign: 'center' },
  resultFailSub: {
    fontSize: 14,
    fontWeight: '600',
    color: T.inkMed,
    textAlign: 'center',
    marginTop: 8,
  },
  resultSession: {
    fontSize: 13,
    fontWeight: '600',
    color: T.inkMed,
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 4,
  },
  resultRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: T.paperLine,
  },
  resultLabel: { fontSize: 14, fontWeight: '600', color: T.inkMed },
  resultValue: { fontSize: 18, fontWeight: '800', color: T.ink },
  resultBtn: {
    marginTop: 4,
    backgroundColor: T.ink,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
  },
  resultBtnText: { fontSize: 15, fontWeight: '700', color: '#FFFFFF' },

  usageOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    zIndex: 1000,
    elevation: 1000,
  },
  usageBox: {
    width: '100%',
    height: '70%',
    backgroundColor: T.paper,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: T.inkLight,
    padding: 20,
    gap: 12,
  },
  usageReportWrap: { flex: 1, width: '100%' },
  usageReport: { flex: 1, width: '100%' },
  usageLoading: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  usageLoadingText: { fontSize: 13, fontWeight: '600', color: T.inkMed },
  usageEmpty: {
    flex: 1,
    textAlign: 'center',
    textAlignVertical: 'center',
    color: T.inkMed,
    fontWeight: '600',
  },
});
