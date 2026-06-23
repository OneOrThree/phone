// ============================================================
// characterTypes.ts — 캐릭터 관련 타입 및 상수 정의
//
// 실제 렌더링 로직은 없고, 유효한 값의 목록과 타입만 담습니다.
// 새 variant나 코스튬 슬롯을 추가할 때 여기도 함께 업데이트하세요.
// ============================================================
import type { ComponentType } from 'react';
import type { Animated } from 'react-native';

// 사용 가능한 캐릭터 상태(variant) 목록
// characterVariants.ts의 VARIANTS 키와 반드시 일치해야 합니다.
export const VALID_VARIANTS = ['default', 'focus', 'reading', 'yoga', 'exercise', 'study'] as const;

// 착용 가능한 코스튬 슬롯 목록
// Character2D의 costumeSlots prop에 들어갈 수 있는 값들입니다.
// hat / hair / top / bottom / accessory
export const VALID_COSTUME_SLOTS = ['hat', 'hair', 'top', 'bottom', 'accessory'] as const;

// 사용 가능한 입 모양 목록
// FaceParts.tsx의 Mouth 컴포넌트에서 type prop으로 사용합니다.
export const MOUTH_TYPES = ['smile', 'bigSmile', 'flat', 'open', 'tongue'] as const;

// ── 파생 타입 ────────────────────────────────────────────────
export type Variant = (typeof VALID_VARIANTS)[number]; // 캐릭터 상태 타입
export type CostumeSlot = (typeof VALID_COSTUME_SLOTS)[number]; // 코스튬 슬롯 타입
export type MouthType = (typeof MOUTH_TYPES)[number]; // 입 모양 타입

// characterVariants.ts에서 각 variant의 설정 구조
// 눈/소품 컴포넌트는 props 없이 렌더링되므로 ComponentType로 충분합니다.
export interface VariantConfig {
  LeftEye: ComponentType; // 왼쪽 눈 컴포넌트
  RightEye: ComponentType; // 오른쪽 눈 컴포넌트
  Item: ComponentType | null; // 몸통 소품 컴포넌트 (없으면 null)
  mouthType: MouthType;
  glasses: boolean; // 안경 표시 여부
  sweat: boolean; // 땀방울 표시 여부
  widePaws: boolean; // 발 간격 넓히기 여부
}

// Character2D 컴포넌트의 props 구조
export interface Character2DProps {
  size?: number; // 캐릭터 크기 (px, 기본 120)
  variant?: Variant; // 캐릭터 상태 (기본 'default')
  costumeSlots?: CostumeSlot[]; // 착용 중인 코스튬 목록 (기본 [])
  leftArmAngle?: Animated.Value | null; // 왼팔 각도
  rightArmAngle?: Animated.Value | null; // 오른팔 각도
}
