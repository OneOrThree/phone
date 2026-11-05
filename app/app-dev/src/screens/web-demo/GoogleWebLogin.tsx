import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Btn, Txt } from '@/design-system/patterns';
import { semanticTokens as s } from '@/design-system/tokens';
import googleClientIds from '@/config/googleClientIds.json';
import { sendGoogleWebCredential } from '@/services/webGoogleLogin';
import { useGowunFont } from '@/screens/island/sceneKit';

type GoogleIdentity = {
  initialize(options: {
    client_id: string;
    nonce: string;
    callback: (result: { credential: string }) => void;
  }): void;
  renderButton(
    element: HTMLElement,
    options: { type: string; theme: string; size: string; text: string; shape: string },
  ): void;
};

export default function GoogleWebLogin() {
  useGowunFont();
  const target = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const nonce = new URLSearchParams(window.location.hash.slice(1)).get('nonce');
    if (!window.opener || !nonce) {
      setError('원래 화면의 Google 로그인 버튼에서 시작해 주세요.');
      return;
    }
    setError('');
    let active = true;
    const script = document.createElement('script');
    const render = () => {
      if (!active || !target.current) return;
      const google = (window as Window & { google?: { accounts: { id: GoogleIdentity } } }).google;
      if (!google) {
        setError('Google 로그인을 불러오지 못했어요. 다시 시도해 주세요.');
        return;
      }
      google.accounts.id.initialize({
        client_id: googleClientIds.prod.web,
        nonce,
        callback: ({ credential }) => {
          if (active) sendGoogleWebCredential(credential);
        },
      });
      target.current.replaceChildren();
      google.accounts.id.renderButton(target.current, {
        type: 'standard',
        theme: 'outline',
        size: 'large',
        text: 'continue_with',
        shape: 'pill',
      });
    };
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = render;
    script.onerror = () => {
      if (active) setError('Google 로그인을 불러오지 못했어요. 다시 시도해 주세요.');
    };
    document.head.appendChild(script);
    return () => {
      active = false;
      script.remove();
    };
  }, [retry]);
  return (
    <View style={styles.page}>
      <Txt kind="h">집중할고양 · cattus</Txt>
      <Txt>앱에서 쓰던 Google 계정으로 이어서 이용해요.</Txt>
      <div ref={target} />
      {error && (
        <>
          <Txt>{error}</Txt>
          <Btn title="다시 시도" onPress={() => setRetry(retry + 1)} />
        </>
      )}
      <Btn
        title="취소"
        kind="secondary"
        onPress={() => {
          sendGoogleWebCredential();
          window.close();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: s.spacing.component,
    padding: s.spacing.page,
    backgroundColor: s.color.canvas,
  },
});
