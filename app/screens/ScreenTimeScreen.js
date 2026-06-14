// ScreenTimeScreen.js
// 스크린 타임 화면
//
// 권한 없음 → 권한 요청 버튼 표시
// 권한 있음  → DeviceActivityReport 네이티브 뷰 표시

import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { T, inkBox } from '../components/theme';
import ScreenTimeModule from '../utils/ScreenTimeModule';
import ScreenTimeReportView from '../components/ScreenTimeReportView';

export default function ScreenTimeScreen() {
  // "notDetermined" | "approved" | "denied"
  const [authStatus, setAuthStatus] = useState('notDetermined');
  const [loading, setLoading] = useState(true);

  // 화면 진입 시 현재 권한 상태 확인
  useEffect(() => {
    ScreenTimeModule.getAuthorizationStatus().then((status) => {
      setAuthStatus(status);
      setLoading(false);
    });
  }, []);

  async function handleRequestAuth() {
    setLoading(true);
    const approved = await ScreenTimeModule.requestAuthorization();
    setAuthStatus(approved ? 'approved' : 'denied');
    setLoading(false);
  }

  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator color={T.ink} />
      </View>
    );
  }

  return (
    <View style={s.container}>
      <Text style={s.title}>스크린 타임</Text>

      {authStatus === 'approved' ? (
        // 권한 있음: 네이티브 DeviceActivityReport 뷰 렌더링
        <ScreenTimeReportView style={s.reportView} />
      ) : (
        // 권한 없음: 안내 문구 + 권한 요청 버튼
        <View style={s.center}>
          <Text style={s.desc}>
            {authStatus === 'denied'
              ? '스크린 타임 접근이 거부됐어요.\n설정 앱에서 직접 허용해주세요.'
              : '앱별 사용 시간을 확인하려면\n스크린 타임 접근 권한이 필요해요.'}
          </Text>
          {authStatus !== 'denied' && (
            <TouchableOpacity
              style={[s.btn, inkBox(T.mint)]}
              onPress={handleRequestAuth}
              activeOpacity={0.8}
            >
              <Text style={s.btnText}>권한 허용하기</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
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
    marginBottom: 20,
  },
  reportView: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
  },
  desc: {
    fontSize: 15,
    fontWeight: '600',
    color: T.inkMed,
    textAlign: 'center',
    lineHeight: 24,
  },
  btn: {
    paddingHorizontal: 24,
    paddingVertical: 14,
  },
  btnText: {
    fontSize: 15,
    fontWeight: '800',
    color: T.ink,
  },
});
