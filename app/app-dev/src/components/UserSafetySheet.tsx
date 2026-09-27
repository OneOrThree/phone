import React, { useEffect, useState } from 'react';
import {
  Image,
  ImageBackground,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { TextInput } from '@/design-system/typography';
import { Btn, C, Chips, Toggle, Txt } from '@/design-system/patterns';
import { componentTokens, semanticTokens } from '@/design-system/tokens';
import { ApiError } from '@/services/api/client';
import {
  blockUser,
  reportEmailUrl,
  REPORT_EMAIL_RECIPIENT,
  type ReportReason,
  type ReportTargetType,
} from '@/services/api/safety';
import { markUserBlocked } from '@/services/blockedUsers';
import { useAppLayout } from '@/utils/layout';

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
  reportEvidence?: string;
  onClose: () => void;
  onChanged?: () => void;
  onMessage: (message: string) => void;
  extraAction?: { title: string; onPress: () => void };
};

export function UserSafetySheet(props: Props) {
  const layout = useAppLayout();
  const centered = layout.tablet || layout.compact;
  const [mode, setMode] = useState<'menu' | 'report' | 'block'>('menu');
  const [reason, setReason] = useState<ReportReason>('HARASSMENT');
  const [description, setDescription] = useState('');
  const [replyEmail, setReplyEmail] = useState('');
  const [alsoBlock, setAlsoBlock] = useState(false);
  const [reportBlockCompleted, setReportBlockCompleted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!props.visible) return;
    setMode('menu');
    setReason('HARASSMENT');
    setDescription('');
    setReplyEmail('');
    setAlsoBlock(false);
    setReportBlockCompleted(false);
    setBusy(false);
    setError('');
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

  const composeReportEmail = async () => {
    if (busy) return;
    if (reason === 'OTHER' && !description.trim()) {
      setError('기타 사유를 설명해 주세요.');
      return;
    }
    // react-native-web의 Linking.openURL(mailto:)는 window.open(_blank)을 사용한다.
    // 네트워크 await 뒤에는 Safari 등의 사용자 활성화가 만료될 수 있으므로 클릭 stack에서
    // 빈 창을 먼저 확보하고, 차단 결과가 정해진 뒤 그 창을 실제 mailto로 이동한다.
    let webComposeWindow: Window | null = null;
    if (Platform.OS === 'web') {
      try {
        webComposeWindow = typeof window === 'undefined' ? null : window.open('', '_blank');
      } catch {
        webComposeWindow = null;
      }
      if (!webComposeWindow) {
        setError('메일 작성 창을 열지 못했어요. 브라우저에서 팝업을 허용한 뒤 다시 시도해 주세요.');
        return;
      }
    }
    setBusy(true);
    setError('');
    let blocked = reportBlockCompleted;
    let blockFailed = false;
    try {
      if (alsoBlock && !reportBlockCompleted) {
        try {
          await blockUser(props.targetUserId);
        } catch {
          // 신고 작성은 차단과 독립적이다. 차단 실패를 본문·완료 안내에 남기고 계속 진행한다.
          blockFailed = true;
        }
        if (!blockFailed) {
          blocked = true;
          markUserBlocked(props.targetUserId);
          setReportBlockCompleted(true);
          props.onChanged?.();
        }
      }
      const input = {
        targetType: props.reportTargetType,
        targetId: props.reportTargetId,
        reason,
        description: description.trim() || null,
        replyEmail: replyEmail.trim() || null,
        blockStatus: blocked
          ? ('COMPLETED' as const)
          : blockFailed
            ? ('FAILED' as const)
            : ('NOT_REQUESTED' as const),
        evidenceText: props.reportEvidence?.trim() || null,
      };
      const emailUrl = reportEmailUrl(input, props.targetName);
      if (webComposeWindow) webComposeWindow.location.href = emailUrl;
      else await Linking.openURL(emailUrl);
      props.onClose();
      props.onMessage(
        blockFailed
          ? '차단은 완료하지 못했어요. 신고 메일 내용을 확인한 뒤 보내 주세요.'
          : blocked
            ? '차단했어요. 메일 내용을 확인한 뒤 보내 주세요.'
            : '메일 내용을 확인한 뒤 보내 주세요.',
      );
    } catch (thrown) {
      webComposeWindow?.close();
      if (blocked) {
        setError('차단은 완료했지만 메일 앱을 열지 못했어요. 다시 시도해 주세요.');
      } else if (blockFailed) {
        setError('차단하지 못했고 메일 앱도 열지 못했어요. 다시 시도해 주세요.');
      } else {
        fail(thrown);
      }
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    if (!busy) props.onClose();
  };

  return (
    <Modal transparent visible={props.visible} animationType="fade" onRequestClose={close}>
      <ImageBackground source={SAFETY_ART.background} resizeMode="cover" style={{ flex: 1 }}>
        <View style={[StyleSheet.absoluteFill, { backgroundColor: `${C.ink}66` }]} />
        <KeyboardAvoidingView
          testID="user-safety-layout"
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{
            flex: 1,
            justifyContent: centered ? 'center' : 'flex-end',
            alignItems: centered ? 'center' : 'stretch',
          }}
        >
          <Pressable
            testID="user-safety-background"
            style={StyleSheet.absoluteFill}
            accessibilityLabel="닫기"
            accessibilityState={{ disabled: busy }}
            disabled={busy}
            onPress={close}
          >
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
            testID="user-safety-panel"
            accessibilityViewIsModal
            style={{
              width: centered ? layout.modalWidth : undefined,
              maxHeight: '80%',
              marginHorizontal: centered ? 0 : semanticTokens.spacing.control,
              marginBottom: centered ? 0 : layout.insets.bottom + semanticTokens.spacing.control,
              padding: componentTokens.modal.padding,
              paddingBottom: componentTokens.modal.paddingBottom,
              gap: componentTokens.modal.gap,
              borderRadius: centered
                ? componentTokens.modal.radius
                : componentTokens.modal.sheetRadius,
              borderBottomLeftRadius: centered ? componentTokens.modal.radius : 0,
              borderBottomRightRadius: centered ? componentTokens.modal.radius : 0,
              borderWidth: componentTokens.modal.borderWidth,
              borderColor: C.brown,
              backgroundColor: C.paper,
              boxShadow: componentTokens.modal.shadow,
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
                accessibilityState={{ disabled: busy }}
                disabled={busy}
                onPress={close}
                style={{
                  width: semanticTokens.size.tapMin,
                  height: semanticTokens.size.tapMin,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Txt style={{ fontSize: 22, fontWeight: '800' }}>×</Txt>
              </Pressable>
            </View>

            <ScrollView
              testID="user-safety-content"
              keyboardShouldPersistTaps="handled"
              style={{ flexShrink: 1, minHeight: 0 }}
              contentContainerStyle={{ gap: componentTokens.modal.gap }}
            >
              {mode === 'menu' ? (
                <View style={{ gap: semanticTokens.spacing.control }}>
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
                <View style={{ gap: componentTokens.modal.gap }}>
                  <Txt>
                    {props.targetName}님의 친구 요청과 편지는 앱 목록에서 숨겨져요. 친구 요청 알림은
                    기기에 표시될 수 있어요. 차단 중 받은 내용은 해제하면 다시 보일 수 있어요.
                  </Txt>
                  <View style={{ flexDirection: 'row', gap: semanticTokens.spacing.control }}>
                    <Btn
                      kind="sec"
                      title="취소"
                      disabled={busy}
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
                <View style={{ gap: componentTokens.modal.gap }}>
                  <Txt kind="meta">
                    운영팀 Gmail({REPORT_EMAIL_RECIPIENT})로 보낼 메일 작성 화면을 열어요. 전송 전
                    내용을 확인해 주세요.
                  </Txt>
                  <Chips
                    items={REASONS.map((item) => item.label)}
                    value={REASONS.find((item) => item.value === reason)?.label}
                    onChange={(label: string) =>
                      setReason(REASONS.find((item) => item.label === label)!.value)
                    }
                    disabled={busy}
                    large
                    wrap
                  />
                  <TextInput
                    accessibilityLabel="신고 설명"
                    value={description}
                    onChangeText={setDescription}
                    editable={!busy}
                    multiline
                    maxLength={1000}
                    placeholder={
                      reason === 'OTHER' ? '기타 사유를 적어 주세요 (필수)' : '설명 (선택)'
                    }
                    placeholderTextColor={C.muted}
                    style={{
                      minHeight: 88,
                      padding: semanticTokens.spacing.control,
                      borderWidth: componentTokens.input.borderWidth,
                      borderColor: componentTokens.input.border,
                      borderRadius: componentTokens.input.radius,
                      color: C.ink,
                    }}
                  />
                  <View style={{ gap: 6 }}>
                    <Txt>처리 결과를 회신받을 이메일 (선택)</Txt>
                    <Txt kind="meta">
                      운영팀의 답장을 받을 주소예요. 입력하지 않아도 신고 메일을 작성할 수 있어요.
                    </Txt>
                    <TextInput
                      accessibilityLabel="처리 결과를 회신받을 이메일"
                      value={replyEmail}
                      onChangeText={setReplyEmail}
                      editable={!busy}
                      keyboardType="email-address"
                      autoCapitalize="none"
                      maxLength={254}
                      placeholder="email@example.com"
                      placeholderTextColor={C.muted}
                      style={{
                        minHeight: componentTokens.input.minHeight,
                        padding: semanticTokens.spacing.control,
                        borderWidth: componentTokens.input.borderWidth,
                        borderColor: componentTokens.input.border,
                        borderRadius: componentTokens.input.radius,
                        color: C.ink,
                      }}
                    />
                  </View>
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: semanticTokens.spacing.control,
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <Txt>이 사용자도 차단</Txt>
                      <Txt kind="meta">
                        {reportBlockCompleted ? '차단을 완료했어요.' : '기본값은 꺼져 있어요.'}
                      </Txt>
                    </View>
                    <Toggle
                      label="이 사용자도 차단"
                      value={alsoBlock || reportBlockCompleted}
                      onChange={setAlsoBlock}
                      disabled={busy || reportBlockCompleted}
                      activeColor={semanticTokens.color.primary}
                    />
                  </View>
                  <View style={{ flexDirection: 'row', gap: semanticTokens.spacing.control }}>
                    <Btn
                      kind="sec"
                      title="뒤로"
                      disabled={busy}
                      style={{ flex: 1 }}
                      onPress={() => setMode('menu')}
                    />
                    <Btn
                      title={busy ? '메일 여는 중…' : '이메일 작성'}
                      disabled={busy}
                      style={{ flex: 1 }}
                      onPress={composeReportEmail}
                    />
                  </View>
                </View>
              )}
            </ScrollView>
            {error ? <Txt style={{ color: C.danger }}>{error}</Txt> : null}
          </View>
        </KeyboardAvoidingView>
      </ImageBackground>
    </Modal>
  );
}
