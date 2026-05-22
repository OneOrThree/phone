// ============================================================
// characterTypes.js — 캐릭터 관련 타입 및 상수 정의
//
// 실제 렌더링 로직은 없고, 유효한 값의 목록과 JSDoc 타입만 담습니다.
// 새 variant나 코스튬 슬롯을 추가할 때 여기도 함께 업데이트하세요.
// ============================================================

// 사용 가능한 캐릭터 상태(variant) 목록
// characterVariants.js의 VARIANTS 키와 반드시 일치해야 합니다.
export const VALID_VARIANTS = ['default', 'focus', 'reading', 'yoga', 'exercise', 'study'];

// 착용 가능한 코스튬 슬롯 목록
// Character2D의 costumeSlots prop에 들어갈 수 있는 값들입니다.
// hat       : 모자 (베레모)
// hair      : 머리 (포니테일)
// top       : 상의 (후드티)
// bottom    : 하의 (청바지)
// accessory : 장신구 (별 귀걸이)
export const VALID_COSTUME_SLOTS = ['hat', 'hair', 'top', 'bottom', 'accessory'];

// 사용 가능한 입 모양 목록
// FaceParts.js의 Mouth 컴포넌트에서 type prop으로 사용합니다.
export const MOUTH_TYPES = ['smile', 'bigSmile', 'flat', 'open', 'tongue'];

// ── JSDoc 타입 정의 ──────────────────────────────────────────
// IDE 자동완성과 타입 힌트를 위한 정의입니다. (런타임에는 영향 없음)

/**
 * @typedef {'default'|'focus'|'reading'|'yoga'|'exercise'|'study'} Variant
 * 캐릭터 상태 타입
 *
 * @typedef {'hat'|'hair'|'top'|'bottom'|'accessory'} CostumeSlot
 * 코스튬 슬롯 타입
 *
 * @typedef {'smile'|'bigSmile'|'flat'|'open'|'tongue'} MouthType
 * 입 모양 타입
 *
 * @typedef {Object} VariantConfig
 * characterVariants.js에서 각 variant의 설정 구조
 * @property {Function} LeftEye   - 왼쪽 눈 컴포넌트
 * @property {Function} RightEye  - 오른쪽 눈 컴포넌트
 * @property {Function|null} Item - 몸통 소품 컴포넌트 (없으면 null)
 * @property {MouthType} mouthType
 * @property {boolean} glasses    - 안경 표시 여부
 * @property {boolean} sweat      - 땀방울 표시 여부
 * @property {boolean} widePaws   - 발 간격 넓히기 여부
 *
 * @typedef {Object} Character2DProps
 * Character2D 컴포넌트의 props 구조
 * @property {number} [size=120]                               - 캐릭터 크기 (px)
 * @property {Variant} [variant='default']                     - 캐릭터 상태
 * @property {CostumeSlot[]} [costumeSlots=[]]                 - 착용 중인 코스튬 목록
 * @property {import('react-native').Animated.Value|null} [leftArmAngle]  - 왼팔 각도
 * @property {import('react-native').Animated.Value|null} [rightArmAngle] - 오른팔 각도
 */
