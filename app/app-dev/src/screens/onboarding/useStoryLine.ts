import { useContext, useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import { MotionContext } from '@/design-system/primitives';
import { componentTokens } from '@/design-system/tokens';

export function useStoryLine(key: string, line: string) {
  const reduce = useContext(MotionContext);
  const [reader, setReader] = useState(false);
  const [progress, setProgress] = useState({ key: '', line: '', count: 0 });
  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isScreenReaderEnabled().then((value) => {
      if (live) setReader(value);
    });
    const sub = AccessibilityInfo.addEventListener('screenReaderChanged', setReader);
    return () => {
      live = false;
      sub.remove();
    };
  }, []);
  const chars = useMemo(() => Array.from(line), [line]);
  const count =
    reduce || reader
      ? chars.length
      : progress.key === key && progress.line === line
        ? progress.count
        : 0;
  const complete = count >= chars.length;
  useEffect(() => {
    if (complete) return;
    const timeout = setTimeout(
      () => setProgress({ key, line, count: count + 1 }),
      /[.,?…]/.test(chars[count - 1] ?? '')
        ? componentTokens.onboarding.punctuationDelay
        : componentTokens.onboarding.typeDelay,
    );
    return () => clearTimeout(timeout);
  }, [key, line, count, complete, chars]);
  return {
    text: chars.slice(0, count).join(''),
    complete,
    finish: () => setProgress({ key, line, count: chars.length }),
  };
}
