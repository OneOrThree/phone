import React, { useLayoutEffect, useRef, useState } from 'react';
import { componentTokens, primitiveTokens } from '@/design-system/tokens';

/** 웹 Text에는 자동 글자 축소가 없어, 줄이지 않은 실제 글자 크기로 배율을 구한다. */
export function WebFacilitySignText({ label }: { label: string }) {
  const areaRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const area = areaRef.current;
    const text = textRef.current;
    if (!area || !text) return;
    const fit = () => {
      // transform 적용 전 크기를 사용해 리사이즈 시 축소/확대가 반복되지 않게 한다.
      if (text.offsetWidth && text.offsetHeight) {
        setScale(
          Math.min(1, area.clientWidth / text.offsetWidth, area.clientHeight / text.offsetHeight),
        );
      }
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(area);
    observer.observe(text);
    return () => observer.disconnect();
  }, [label]);

  return (
    <div
      ref={areaRef}
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <span
        ref={textRef}
        style={{
          flexShrink: 0,
          whiteSpace: 'nowrap',
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
          fontSize: componentTokens.tileFacility.signFontSize,
          fontWeight: primitiveTokens.fontWeight.extraBold,
          color: componentTokens.tileFacility.signTextColor,
          transform: `scale(${scale})`,
          transformOrigin: 'center',
        }}
      >
        {label}
      </span>
    </div>
  );
}
