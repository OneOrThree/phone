export const catchAssetPath = (caught: number) =>
  `props/fishing/catch/${
    caught >= 240
      ? 'pile-large'
      : caught >= 120
        ? 'pile-medium'
        : caught >= 60
          ? 'pile-small'
          : 'single'
  }.png`;
