import React, { useState, useRef, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiFetch } from '../utils/api';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  TextInput,
  PanResponder,
  Alert,
  Platform,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { T, inkBox } from '../components/theme';
import { Character2D } from '../components/character/Character2D';
import { useFocus } from '../contexts/FocusContext';
import { useUser } from '../contexts/UserContext';
import ScreenTimeModule, { type AppSelectionCounts } from '../utils/ScreenTimeModule';
import { tomorrowStr } from '../utils/localDate';
import type { UserProfile } from '../types/api';

interface MyPageScreenProps {
  user: UserProfile | null;
  onLogout: () => void;
  onWithdraw: () => Promise<void>;
}

const GOAL_MAX = 86400; // 24h in seconds
const GOAL_STEP = 1800; // 30min step
const THUMB_SIZE = 24;
const TRACK_HEIGHT = 12;
const SLIDER_HEIGHT = 44;

function formatFocusTime(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) return `${hours}시간 ${minutes}분`;
  if (minutes > 0) return `${minutes}분`;
  return `${totalSeconds}초`;
}

function formatGoalTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h === 0) return `${m}분`;
  if (m === 0) return `${h}시간`;
  return `${h}시간 ${m}분`;
}

interface StatRowProps {
  label: string;
  value: string;
  accent: string;
}

function StatRow({ label, value, accent }: StatRowProps) {
  const dynamicStyle = { borderLeftColor: accent };
  return (
    <View style={[s.statRow, dynamicStyle]}>
      <Text style={s.statLabel}>{label}</Text>
      <Text style={s.statValue}>{value}</Text>
    </View>
  );
}

interface GoalSliderProps {
  value: number;
  onChange: (value: number) => void;
}

function GoalSlider({ value, onChange }: GoalSliderProps) {
  const [trackWidth, setTrackWidth] = useState(0);
  const trackRef = useRef<View>(null);
  const trackWidthRef = useRef(0);
  const pageXRef = useRef(0);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  function measureTrack() {
    trackRef.current?.measure((x, y, w, h, pageX) => {
      pageXRef.current = pageX;
      trackWidthRef.current = w;
      setTrackWidth(w);
    });
  }

  function snapValue(localX: number) {
    const w = trackWidthRef.current;
    if (w === 0) return value;
    const clamped = Math.max(0, Math.min(w, localX));
    const raw = (clamped / w) * GOAL_MAX;
    const stepped = Math.round(raw / GOAL_STEP) * GOAL_STEP;
    return Math.min(GOAL_MAX, Math.max(GOAL_STEP, stepped));
  }

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e, gs) => {
        onChangeRef.current(snapValue(gs.x0 - pageXRef.current));
      },
      onPanResponderMove: (e, gs) => {
        onChangeRef.current(snapValue(gs.moveX - pageXRef.current));
      },
    }),
  ).current;

  const fillPercent = (value / GOAL_MAX) * 100;
  const thumbLeft = trackWidth > 0 ? (value / GOAL_MAX) * trackWidth - THUMB_SIZE / 2 : 0;

  return (
    <View style={s.sliderWrapper}>
      <View
        ref={trackRef}
        style={s.sliderArea}
        onLayout={measureTrack}
        {...panResponder.panHandlers}
      >
        <View style={s.sliderTrack}>
          <View style={[s.sliderFill, { width: `${fillPercent}%` }]} />
        </View>
        {trackWidth > 0 && <View style={[s.sliderThumb, { left: thumbLeft }]} />}
      </View>
      <View style={s.sliderTicks}>
        {['0h', '6h', '12h', '18h', '24h'].map((label) => (
          <Text key={label} style={s.sliderTickText}>
            {label}
          </Text>
        ))}
      </View>
    </View>
  );
}

export default function MyPageScreen({ onLogout, onWithdraw }: MyPageScreenProps) {
  const { todayFocusSeconds } = useFocus();
  const { nickname, setNickname, goalSeconds } = useUser();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(nickname);

  const [goalEditing, setGoalEditing] = useState(false);
  const [draftGoal, setDraftGoal] = useState(goalSeconds);
  const [pendingGoalSeconds, setPendingGoalSeconds] = useState<number | null>(null);

  // 측정 대상(앱/카테고리) 상태
  const [selectionCounts, setSelectionCounts] = useState<AppSelectionCounts | null>(null); // 오늘(활성) 선택 개수
  const [pendingSelectionCounts, setPendingSelectionCounts] = useState<AppSelectionCounts | null>(
    null,
  ); // 내일(대기) 선택 개수

  // 저장된 pending 목표 로드 (앱 재실행 후에도 "내일부터 적용" 표시 유지)
  useEffect(() => {
    AsyncStorage.getItem('gromo:goal:pending').then((raw) => {
      if (!raw) return;
      const { minutes } = JSON.parse(raw);
      if (minutes > 0) setPendingGoalSeconds(minutes * 60);
    });
  }, []);

  // 측정 대상 표시 정보 로드 (오늘 활성 + 내일 대기 선택 개수)
  useEffect(() => {
    AsyncStorage.multiGet(['gromo:selection:counts', 'gromo:selection:pendingCounts']).then(
      ([[, countsRaw], [, pendingRaw]]) => {
        if (countsRaw) setSelectionCounts(JSON.parse(countsRaw));
        if (pendingRaw) setPendingSelectionCounts(JSON.parse(pendingRaw));
      },
    );
  }, []);

  function openEdit() {
    setDraft(nickname);
    setEditing(true);
  }
  async function saveNickname() {
    if (!draft.trim()) return;
    setNickname(draft.trim());
    setEditing(false);
    await apiFetch('/api/v1/user', {
      method: 'PATCH',
      body: JSON.stringify({ nickname: draft.trim() }),
    }).catch(() => {});
  }

  function openGoalEdit() {
    // pending이 있으면 pending 기준으로, 없으면 오늘 목표 기준으로 슬라이더 시작
    setDraftGoal(pendingGoalSeconds ?? goalSeconds);
    setGoalEditing(true);
  }
  function saveGoal() {
    const newGoal = draftGoal; // 클로저 캡처 안정성을 위해 즉시 로컬로 고정
    setGoalEditing(false);
    setPendingGoalSeconds(newGoal);
    Alert.alert('목표 저장 완료', '변경된 목표는 내일부터 적용됩니다!');

    // 대기(pending)로 저장 — 당일엔 반영 안 되고, 다음 실행 시 Homescreen에서 승격
    // (활성 목표 gromo:user.dailyScreenTimeGoalMinutes는 승격 시점에 갱신됨)
    const minutes = Math.round(newGoal / 60);
    AsyncStorage.setItem(
      'gromo:goal:pending',
      JSON.stringify({ minutes, applyDate: tomorrowStr() }),
    );

    // 서버에는 사용자가 정한 목표값을 즉시 기록
    apiFetch('/api/v1/user', {
      method: 'PATCH',
      body: JSON.stringify({ dailyScreenTimeGoalMinutes: minutes }),
    }).catch(() => {});
  }

  // 측정 대상(앱/카테고리) 선택 picker 표시
  async function openPicker() {
    try {
      // picker는 스크린타임 권한이 있어야 정상 동작 → 없으면 먼저 요청
      const status = await ScreenTimeModule.getAuthorizationStatus();
      if (status !== 'approved') {
        const approved = await ScreenTimeModule.requestAuthorization();
        if (!approved) {
          Alert.alert('권한 필요', '측정 대상을 설정하려면 스크린 타임 권한이 필요합니다.');
          return;
        }
      }

      const result = await ScreenTimeModule.presentAppPicker();
      if (!result) return; // 취소

      const configured = await AsyncStorage.getItem('gromo:selection:configured');
      if (!configured) {
        // 첫 설정 → 즉시 활성화 (오늘부터 측정) → 오늘(active) 개수에 저장
        await ScreenTimeModule.promoteSelection();
        await AsyncStorage.setItem('gromo:selection:configured', '1');
        await AsyncStorage.setItem('gromo:selection:counts', JSON.stringify(result));
        await ScreenTimeModule.startGoalMonitoring(goalSeconds);
        setSelectionCounts(result);
        setPendingSelectionCounts(null);
        Alert.alert('측정 대상 설정 완료', '선택한 앱 기준으로 오늘부터 측정합니다.');
      } else {
        // 변경 → 내일부터 적용 → 내일(pending) 개수에만 저장 (오늘 것은 유지)
        await AsyncStorage.multiSet([
          ['gromo:selection:applyDate', tomorrowStr()],
          ['gromo:selection:pendingCounts', JSON.stringify(result)],
        ]);
        setPendingSelectionCounts(result);
        Alert.alert('측정 대상 변경됨', '변경된 측정 대상은 내일부터 적용됩니다!');
      }
    } catch (e) {
      Alert.alert('오류', String(e));
    }
  }

  // 측정 대상 표시 문구 (예: "카테고리 13개", "미설정")
  function selectionLabel(counts: AppSelectionCounts | null) {
    if (!counts) return '미설정';
    const { applications = 0, categories = 0, webDomains = 0 } = counts;
    const parts = [];
    if (categories > 0) parts.push(`카테고리 ${categories}개`);
    if (applications > 0) parts.push(`앱 ${applications}개`);
    if (webDomains > 0) parts.push(`웹 ${webDomains}개`);
    return parts.length > 0 ? parts.join(' · ') : '미설정';
  }

  return (
    <View style={s.container}>
      <StatusBar style="dark" />

      <Text style={s.title}>마이페이지 🐾</Text>

      {/* 닉네임 수정 모달 */}
      <Modal visible={editing} transparent animationType="fade">
        <View style={s.modalOverlay}>
          <View style={[s.modalCard, inkBox(T.paper)]}>
            <Text style={s.modalTitle}>닉네임 수정</Text>
            <TextInput
              style={s.input}
              value={draft}
              onChangeText={setDraft}
              maxLength={12}
              autoFocus
            />
            <View style={s.modalBtns}>
              <TouchableOpacity
                style={[s.modalBtn, inkBox(T.paperDark)]}
                onPress={() => setEditing(false)}
              >
                <Text style={s.modalBtnText}>취소</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.modalBtn, inkBox(T.yellow)]} onPress={saveNickname}>
                <Text style={s.modalBtnText}>저장</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* 목표 시간 수정 모달 */}
      <Modal visible={goalEditing} transparent animationType="fade">
        <View style={s.modalOverlay}>
          <View style={[s.goalModalCard, inkBox(T.paper)]}>
            <Text style={s.modalTitle}>핸드폰 사용 목표</Text>
            <Text style={s.goalDraftTime}>{formatGoalTime(draftGoal)}</Text>
            <GoalSlider value={draftGoal} onChange={setDraftGoal} />
            <View style={[s.modalBtns, s.modalBtnsTop]}>
              <TouchableOpacity
                style={[s.modalBtn, inkBox(T.paperDark)]}
                onPress={() => setGoalEditing(false)}
              >
                <Text style={s.modalBtnText}>취소</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.modalBtn, inkBox(T.yellow)]} onPress={saveGoal}>
                <Text style={s.modalBtnText}>저장</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Profile card */}
      <View style={[s.profileCard, inkBox(T.yellow)]}>
        <View style={s.profileRow}>
          <View style={s.avatarWrap}>
            <Character2D size={72} />
          </View>
          <View style={s.profileInfo}>
            <View style={s.nicknameRow}>
              <Text style={s.nickname}>{nickname}</Text>
              <TouchableOpacity onPress={openEdit} style={s.editBtn}>
                <Text style={s.editBtnText}>수정</Text>
              </TouchableOpacity>
            </View>
            <Text style={s.joinDate}>함께한 지 1일째</Text>
          </View>
        </View>
      </View>

      {/* Stats card */}
      <View style={[s.statsCard, inkBox(T.paperDark)]}>
        <Text style={s.statsTitle}>나의 기록 ✦</Text>
        <StatRow
          label="오늘 집중 시간"
          value={formatFocusTime(todayFocusSeconds)}
          accent={T.coral}
        />
        <StatRow label="연속 집중일" value="1일" accent={T.mint} />
        <StatRow label="이번 주 목표 달성" value="0 / 7일" accent={T.sky} />

        {/* 목표 시간 */}
        <View style={s.goalSection}>
          <View style={s.goalRow}>
            <View style={s.goalLeft}>
              <View style={s.goalTodayRow}>
                <Text style={s.goalLabel}>오늘 스크린 타임 목표</Text>
                <Text style={s.goalTime}>{formatGoalTime(goalSeconds)}</Text>
              </View>
              {pendingGoalSeconds !== null && (
                <Text style={s.pendingGoalText}>
                  내일부터 적용되는 목표: {formatGoalTime(pendingGoalSeconds)}
                </Text>
              )}
            </View>
            <TouchableOpacity
              onPress={openGoalEdit}
              style={[s.goalEditBtn, inkBox(T.paperDark)]}
              activeOpacity={0.8}
            >
              <Text style={s.goalEditBtnText}>수정하기</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* 측정 대상 (iOS 전용) */}
        {Platform.OS === 'ios' && (
          <View style={s.goalSection}>
            <View style={s.goalRow}>
              <View style={s.goalLeft}>
                <View style={s.goalTodayRow}>
                  <Text style={s.goalLabel}>오늘 측정 대상</Text>
                  <Text style={s.goalTime}>{selectionLabel(selectionCounts)}</Text>
                </View>
                {pendingSelectionCounts && (
                  <Text style={s.pendingGoalText}>
                    내일부터 측정: {selectionLabel(pendingSelectionCounts)}
                  </Text>
                )}
              </View>
              <TouchableOpacity
                onPress={openPicker}
                style={[s.goalEditBtn, inkBox(T.paperDark)]}
                activeOpacity={0.8}
              >
                <Text style={s.goalEditBtnText}>수정하기</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>

      <TouchableOpacity
        style={[s.logoutBtn, inkBox(T.paperDark)]}
        onPress={onLogout}
        activeOpacity={0.8}
      >
        <Text style={s.logoutText}>로그아웃</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={s.withdrawBtn}
        onPress={() =>
          Alert.alert('회원 탈퇴', '탈퇴하면 모든 데이터가 삭제되며 복구할 수 없어요.', [
            { text: '취소', style: 'cancel' },
            {
              text: '탈퇴하기',
              style: 'destructive',
              onPress: async () => {
                try {
                  await onWithdraw();
                } catch (e) {
                  const msg = (e as { message?: string })?.message ?? '';
                  if (msg.includes('400') || msg.includes('방장')) {
                    Alert.alert(
                      '탈퇴 불가',
                      '방장인 그룹이 있어요. 방장을 위임한 후 탈퇴해 주세요.',
                    );
                  } else {
                    Alert.alert('오류', '탈퇴 처리 중 문제가 발생했어요. 다시 시도해 주세요.');
                  }
                }
              },
            },
          ])
        }
        activeOpacity={0.8}
      >
        <Text style={s.withdrawText}>회원 탈퇴</Text>
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
  title: {
    fontSize: 26,
    fontWeight: '900',
    color: T.ink,
    marginBottom: 18,
  },

  profileCard: {
    padding: 18,
    marginBottom: 14,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  avatarWrap: {
    width: 80,
    height: 90,
    alignItems: 'center',
    justifyContent: 'flex-end',
    overflow: 'visible',
  },
  profileInfo: {
    flex: 1,
  },
  nicknameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  nickname: {
    fontSize: 20,
    fontWeight: '900',
    color: T.ink,
  },
  editBtn: {
    borderWidth: 2,
    borderColor: T.ink,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  editBtnText: {
    fontSize: 11,
    fontWeight: '800',
    color: T.inkMed,
  },
  joinDate: {
    fontSize: 13,
    color: T.inkMed,
    marginTop: 4,
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCard: {
    width: 280,
    padding: 24,
    backgroundColor: T.paper,
  },
  goalModalCard: {
    width: 320,
    padding: 24,
    backgroundColor: T.paper,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: T.ink,
    marginBottom: 16,
  },
  goalDraftTime: {
    fontSize: 36,
    fontWeight: '900',
    color: T.ink,
    textAlign: 'center',
    marginBottom: 24,
  },
  input: {
    borderWidth: 2.5,
    borderColor: T.ink,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    fontWeight: '700',
    color: T.ink,
    marginBottom: 20,
  },
  modalBtns: {
    flexDirection: 'row',
    gap: 10,
  },
  modalBtnsTop: { marginTop: 24 },
  modalBtn: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
  },
  modalBtnText: {
    fontSize: 14,
    fontWeight: '800',
    color: T.ink,
  },

  statsCard: {
    padding: 18,
    marginBottom: 14,
  },
  statsTitle: {
    fontSize: 16,
    fontWeight: '900',
    color: T.ink,
    marginBottom: 14,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 8,
    backgroundColor: T.paper,
    borderRadius: 8,
    borderLeftWidth: 4,
  },
  statLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: T.inkMed,
  },
  statValue: {
    fontSize: 15,
    fontWeight: '900',
    color: T.ink,
  },

  goalSection: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1.5,
    borderTopColor: T.paperLine,
  },
  goalRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 10,
  },
  goalLeft: {
    flex: 1,
    gap: 6,
    justifyContent: 'center',
  },
  goalTodayRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  goalEditBtn: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  goalEditBtnText: {
    fontSize: 13,
    fontWeight: '800',
    color: T.ink,
  },
  pendingGoalText: {
    fontSize: 13,
    fontWeight: '700',
    color: T.inkLight,
  },
  goalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  goalLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: T.inkMed,
  },
  goalRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  goalTime: {
    fontSize: 15,
    fontWeight: '900',
    color: T.ink,
  },
  barBg: {
    height: 16,
    borderRadius: 8,
    backgroundColor: T.paperLine,
    borderWidth: 2,
    borderColor: T.ink,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    backgroundColor: T.coral,
    borderRadius: 6,
  },
  barLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  barLabelText: {
    fontSize: 11,
    fontWeight: '700',
    color: T.inkLight,
  },

  sliderWrapper: {
    width: '100%',
  },
  sliderArea: {
    height: SLIDER_HEIGHT,
    justifyContent: 'center',
    position: 'relative',
  },
  sliderTrack: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: TRACK_HEIGHT,
    top: (SLIDER_HEIGHT - TRACK_HEIGHT) / 2,
    borderRadius: TRACK_HEIGHT / 2,
    backgroundColor: T.paperLine,
    borderWidth: 2,
    borderColor: T.ink,
    overflow: 'hidden',
  },
  sliderFill: {
    height: '100%',
    backgroundColor: T.coral,
  },
  sliderThumb: {
    position: 'absolute',
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    backgroundColor: T.yellow,
    borderWidth: 3,
    borderColor: T.ink,
    top: (SLIDER_HEIGHT - THUMB_SIZE) / 2,
  },
  sliderTicks: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  sliderTickText: {
    fontSize: 11,
    fontWeight: '700',
    color: T.inkLight,
  },

  deco: {
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '700',
    color: T.inkLight,
    letterSpacing: 1,
    marginBottom: 14,
  },
  tipCard: {
    padding: 16,
  },
  tipTitle: {
    fontSize: 15,
    fontWeight: '900',
    color: T.ink,
    marginBottom: 8,
  },
  tipText: {
    fontSize: 13,
    fontWeight: '600',
    color: T.inkMed,
    lineHeight: 20,
  },
  btnPressed: {
    transform: [{ translateX: 2 }, { translateY: 2 }],
    borderBottomWidth: 2.5,
    borderRightWidth: 2.5,
  },
  logoutBtn: {
    marginTop: 8,
    paddingVertical: 14,
    alignItems: 'center',
  },
  logoutText: {
    fontSize: 14,
    fontWeight: '800',
    color: T.inkMed,
  },
  withdrawBtn: {
    marginTop: 4,
    paddingVertical: 12,
    alignItems: 'center',
  },
  withdrawText: {
    fontSize: 13,
    fontWeight: '700',
    color: T.coral,
  },
});
