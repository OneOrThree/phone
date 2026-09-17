import { Text } from '@/design-system/typography';
import React, { useState } from 'react';
import { View, Modal, Pressable, KeyboardAvoidingView, Platform } from 'react-native';
import { Button, Field, H, T, C, S } from '@/design-system/primitives';

export function InviteEntry({
  onSubmit,
  reduce,
}: {
  onSubmit: (code: string) => string | null;
  reduce: boolean;
}) {
  const [open, setOpen] = useState(false),
    [code, setCode] = useState(''),
    [error, setError] = useState('');
  const close = () => {
    setOpen(false);
    setCode('');
    setError('');
  };
  return (
    <>
      <Button fill secondary title="이미 초대받은 섬이 있어요!" onPress={() => setOpen(true)} />
      {open && (
        <Modal transparent visible animationType={reduce ? 'none' : 'fade'} onRequestClose={close}>
          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <Pressable
              onPress={close}
              style={{
                flex: 1,
                backgroundColor: '#493B3955',
                justifyContent: 'center',
                padding: 24,
              }}
            >
              <Pressable onPress={() => {}} style={[S.card, { gap: 20, padding: 22 }]}>
                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <H>초대 코드 입력</H>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="닫기"
                    onPress={close}
                    style={{ padding: 10 }}
                  >
                    <Text style={{ fontSize: 22, color: C.ink }}>×</Text>
                  </Pressable>
                </View>
                <Field
                  label="초대 코드"
                  value={code}
                  onChange={(v) => {
                    setCode(v);
                    setError('');
                  }}
                  placeholder="받은 코드를 입력해 주세요"
                />
                {!!error && <T style={{ color: '#B44854' }}>{error}</T>}
                <Button
                  fill
                  title="초대 확인"
                  disabled={!code.trim()}
                  onPress={() => {
                    const message = onSubmit(code);
                    if (message) setError(message);
                    else close();
                  }}
                />
              </Pressable>
            </Pressable>
          </KeyboardAvoidingView>
        </Modal>
      )}
    </>
  );
}
