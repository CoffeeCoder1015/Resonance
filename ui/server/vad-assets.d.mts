export const VAD_ASSET_NAMES: string[];
export const VAD_SOURCE_ASSETS: Record<string, string>;

export function createVadAssetMap(directory: string): Record<string, string>;

export function createVadAssetMiddleware(options?: {
  assets?: Record<string, string>;
}): (
  request: import('node:http').IncomingMessage,
  response: import('node:http').ServerResponse,
  next: () => void
) => Promise<void>;

export function copyVadAssets(outputDirectory: string): Promise<void>;
