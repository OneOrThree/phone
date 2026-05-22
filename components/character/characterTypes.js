export const VALID_VARIANTS = ['default', 'focus', 'reading', 'yoga', 'exercise', 'study'];
export const VALID_COSTUME_SLOTS = ['hat', 'hair', 'top', 'bottom', 'accessory'];
export const MOUTH_TYPES = ['smile', 'bigSmile', 'flat', 'open', 'tongue'];

/**
 * @typedef {'default'|'focus'|'reading'|'yoga'|'exercise'|'study'} Variant
 * @typedef {'hat'|'hair'|'top'|'bottom'|'accessory'} CostumeSlot
 * @typedef {'smile'|'bigSmile'|'flat'|'open'|'tongue'} MouthType
 *
 * @typedef {Object} VariantConfig
 * @property {Function} LeftEye
 * @property {Function} RightEye
 * @property {Function|null} Item
 * @property {MouthType} mouthType
 * @property {boolean} glasses
 * @property {boolean} sweat
 * @property {boolean} widePaws
 *
 * @typedef {Object} Character2DProps
 * @property {number} [size=120]
 * @property {Variant} [variant='default']
 * @property {CostumeSlot[]} [costumeSlots=[]]
 * @property {import('react-native').Animated.Value|null} [leftArmAngle]
 * @property {import('react-native').Animated.Value|null} [rightArmAngle]
 */
