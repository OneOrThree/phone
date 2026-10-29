export const POLICY = {
  channelAge: 6 * 3600_000,
  previousAge: 7 * 86400_000,
  unusedAge: 30 * 86400_000,
  collectAge: 86400_000,
  totalBytes: 256 * 1024 ** 2,
  imageBytes: 248 * 1024 ** 2,
  targetBytes: 192 * 1024 ** 2,
  freeBytes: 512 * 1024 ** 2,
  fileBytes: 16 * 1024 ** 2,
  manifestBytes: 1024 ** 2,
  channelBytes: 16 * 1024,
};
export const retryDelay = (failures: number) =>
  [60_000, 300_000, 1800_000][Math.min(2, failures - 1)];
