import React, { useEffect, useRef, useState } from 'react';
import {
  Image,
  ImageBackground,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { TextInput } from '@/design-system/typography';
import { Btn, C, Chips, Toggle, Txt } from '@/design-system/patterns';
import { ApiError, uuid } from '@/services/api/client';
import {
  blockUser,
  submitReport,
  type ReportReason,
  type ReportTargetType,
} from '@/services/api/safety';
import { markUserBlocked } from '@/services/blockedUsers';

const REASONS: Array<{ value: ReportReason; label: string }> = [
  { value: 'HARASSMENT', label: '욕설·괴롭힘' },
  { value: 'HATE', label: '혐오·차별' },
  { value: 'SPAM_FRAUD', label: '스팸·사기' },
  { value: 'SEXUAL', label: '성적 콘텐츠' },
  { value: 'CHILD_SAFETY', label: '아동 안전' },
  { value: 'THREAT', label: '위해 협박' },
  { value: 'PRIVACY_IMPERSONATION', label: '개인정보·사칭' },
  { value: 'OTHER', label: '기타' },
];

const SAFETY_ART = {
  background: require('@/assets/interiors/mail-cute-v1.png'),
  envelope: require('@/assets/interiors/ui/letter-envelope-v1.png'),
  cat: require('@/assets/redesign/cat-black-sitting.png'),
  postbird: require('@/assets/characters/pelican/npc/on-mailbox.png'),
};

type Props = {
  visible: boolean;
  targetUserId: string;
  targetName: string;
  reportTargetType: ReportTargetType;
  reportTargetId: string;
  onClose: () => void;
  onChanged?: () => void;
  onMessage: (message: string) => void;
  extraAction?: { title: string; onPress: () => void };
};

export function UserSafetySheet(props: Props) {
  const [mode, setMode] = useState<'menu' | 'report' | 'block'>('menu');
  const [reason, setReason] = useState<ReportReason>('HARASSMENT');
  const [description, setDescription] = useState('');
  const [replyEmail, setReplyEmail] = useState('');
  const [alsoBlock, setAlsoBlock] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const requestId = useRef(uuid());

  useEffect(() => {
    if (!props.visible) return;
    setMode('menu');
    setReason('HARASSMENT');
    setDescription('');
    setReplyEmail('');
    setAlsoBlock(false);
    setBusy(false);
    setError('');
    requestId.current = uuid();
  }, [props.visible, props.reportTargetId]);

  const fail = (thrown: unknown) => {
    setError(
      thrown instanceof ApiError && thrown.message
        ? thrown.message
        : '처리하지 못했어요. 연결을 확인하고 다시 시도해 주세요.',
    );
  };

  const block = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await blockUser(props.targetUserId);
      markUserBlocked(props.targetUserId);
      props.onChanged?.();
      props.onClose();
      props.onMessage(`${props.targetName}님을 차단했어요.`);
    } catch (thrown) {
      fail(thrown);
    } finally {
      setBusy(false);
    }
  };

  const report = async () => {
    if (busy) return;
    if (reason === 'OTHER' && !description.trim()) {
      setError('기타 사유를 설명해 주세요.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const receipt = await submitReport(
        {
          targetType: props.reportTargetType,
          targetId: props.reportTargetId,
          reason,
          description: description.trim() || null,
          replyEmail: replyEmail.trim() || null,
          blockUser: alsoBlock,
        },
        requestId.current,
      );
      if (receipt.blocked) markUserBlocked(props.targetUserId);
      props.onChanged?.();
      props.onClose();
      props.onMessage(`신고가 접수됐어요. 사건 번호 ${receipt.caseId}`);
    } catch (thrown) {
      fail(thrown);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal transparent visible={props.visible} animationType="fade" onRequestClose={props.onClose}>
      <ImageBackground source={SAFETY_ART.background} resizeMode="cover" style={{ flex: 1 }}>
        <View style={[StyleSheet.absoluteFill, { backgroundColor: '#3C29275C' }]} />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1, justifyContent: 'flex-end' }}
        >
          <Pressable style={{ flex: 1 }} accessibilityLabel="닫기" onPress={props.onClose}>
            <Image
              source={SAFETY_ART.envelope}
              resizeMode="contain"
              accessible={false}
              style={{
                position: 'absolute',
                left: 18,
                top: 42,
                width: 94,
                height: 94,
                transform: [{ rotate: '-9deg' }],
              }}
            />
            <Image
              source={SAFETY_ART.postbird}
              resizeMode="contain"
              accessible={false}
              style={{ position: 'absolute', right: -12, top: 8, width: 154, height: 154 }}
            />
            <Image
              source={SAFETY_ART.cat}
              resizeMode="contain"
              accessible={false}
              style={{ position: 'absolute', left: '33%', bottom: -18, width: 112, height: 112 }}
            />
          </Pressable>
          <View
            accessibilityViewIsModal
            style={{
              maxHeight: '80%',
              marginHorizontal: 12,
              marginBottom: 12,
              padding: 20,
              paddingBottom: 24,
              gap: 14,
              borderRadius: 26,
              borderWidth: 2,
              borderColor: C.brown,
              backgroundColor: C.paper,
              boxShadow: '0 10px 30px #2D1A1766',
            }}
          >
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <Txt kind="title">
                {mode === 'menu' ? props.targetName : mode === 'report' ? '신고하기' : '차단하기'}
              </Txt>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="닫기"
                onPress={props.onClose}
                hitSlop={10}
              >
                <Txt style={{ fontSize: 22, fontWeight: '800' }}>×</Txt>
              </Pressable>
            </View>

            {mode === 'menu' ? (
              <View style={{ gap: 10 }}>
                <Btn title="신고하기" onPress={() => setMode('report')} />
                <Btn kind="sec" title="차단하기" onPress={() => setMode('block')} />
                {props.extraAction ? (
                  <Btn
                    kind="sec"
                    title={props.extraAction.title}
                    onPress={() => {
                      props.onClose();
                      props.extraAction?.onPress();
                    }}
                  />
                ) : null}
              </View>
            ) : mode === 'block' ? (
              <View style={{ gap: 14 }}>
                <Txt>
                  서로 친구 요청과 편지를 보낼 수 없고, 친구 목록과 받은 편지에서 {props.targetName}
                  님이 숨겨져요.
                </Txt>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <Btn
                    kind="sec"
                    title="취소"
                    style={{ flex: 1 }}
                    onPress={() => setMode('menu')}
                  />
                  <Btn
                    title={busy ? '처리 중…' : '차단'}
                    disabled={busy}
                    style={{ flex: 1 }}
                    onPress={block}
                  />
                </View>
              </View>
            ) : (
              <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 14 }}>
                <Txt kind="meta">서버가 화면의 원문을 다시 확인해 운영팀에 전달해요.</Txt>
                <Chips
                  items={REASONS.map((item) => item.label)}
                  value={REASONS.find((item) => item.value === reason)?.label}
                  onChange={(label: string) =>
                    setReason(REASONS.find((item) => item.label === label)!.value)
                  }
                  wrap
                />
                <TextInput
                  accessibilityLabel="신고 설명"
                  value={description}
                  onChangeText={setDescription}
                  multiline
                  maxLength={1000}
                  placeholder={
                    reason === 'OTHER' ? '기타 사유를 적어 주세요 (필수)' : '설명 (선택)'
                  }
                  placeholderTextColor={C.muted}
                  style={{
                    minHeight: 88,
                    padding: 12,
                    borderWidth: 1.5,
                    borderColor: C.brown,
                    borderRadius: 14,
                    color: C.ink,
                  }}
                />
                <View style={{ gap: 6 }}>
                  <Txt>처리 결과를 회신받을 이메일 (선택)</Txt>
                  <Txt kind="meta">
                    신고 처리 결과를 안내받고 싶을 때 입력해 주세요. 신고 접수에는 필요하지
                    않아요.
                  </Txt>
                  <TextInput
                    accessibilityLabel="처리 결과를 회신받을 이메일"
                    value={replyEmail}
                    onChangeText={setReplyEmail}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    maxLength={254}
                    placeholder="email@example.com"
                    placeholderTextColor={C.muted}
                    style={{
                      minHeight: 48,
                      padding: 12,
                      borderWidth: 1.5,
                      borderColor: C.brown,
                      borderRadius: 14,
                      color: C.ink,
                    }}
                  />
                </View>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Txt>이 사용자도 차단</Txt>
                    <Txt kind="meta">기본값은 꺼져 있어요.</Txt>
                  </View>
                  <Toggle
                    label="이 사용자도 차단"
                    value={alsoBlock}
                    onChange={setAlsoBlock}
                    disabled={busy}
                  />
                </View>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <Btn
                    kind="sec"
                    title="뒤로"
                    style={{ flex: 1 }}
                    onPress={() => setMode('menu')}
                  />
                  <Btn
                    title={busy ? '접수 확인 중…' : '신고 접수'}
                    disabled={busy}
                    style={{ flex: 1 }}
                    onPress={report}
                  />
                </View>
              </ScrollView>
            )}
            {error ? <Txt style={{ color: C.danger }}>{error}</Txt> : null}
          </View>
        </KeyboardAvoidingView>
      </ImageBackground>
    </Modal>
  );
}
