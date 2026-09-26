export const catchAssetPath = (caught: number) =>
  `props/fishing/catch/${
    caught >= 10
      ? 'pile-large'
      : caught >= 6
        ? 'pile-medium'
        : caught >= 3
          ? 'pile-small'
          : 'single'
  }.png`;
