import * as ImagePicker from 'expo-image-picker';

import type { UploadFile } from '../api/client';

export type PickResult = { file: UploadFile } | { tooLarge: true } | null;

/** Gallery image for an upload; null when cancelled, `tooLarge` above maxBytes. */
export async function pickImage(maxBytes: number): Promise<PickResult> {
  const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.9 });
  const asset = res.canceled ? null : res.assets[0];
  if (!asset) return null;
  if (asset.fileSize != null && asset.fileSize > maxBytes) return { tooLarge: true };
  return { file: { uri: asset.uri, name: asset.fileName ?? asset.uri.split('/').pop() ?? 'image.jpg', type: asset.mimeType ?? 'image/jpeg' } };
}

/** Gallery video (MP4/MOV) for an upload; the server checks the real type. */
export async function pickVideo(maxBytes: number): Promise<PickResult> {
  const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'] });
  const asset = res.canceled ? null : res.assets[0];
  if (!asset) return null;
  if (asset.fileSize != null && asset.fileSize > maxBytes) return { tooLarge: true };
  return { file: { uri: asset.uri, name: asset.fileName ?? asset.uri.split('/').pop() ?? 'video.mp4', type: asset.mimeType ?? 'video/mp4' } };
}
