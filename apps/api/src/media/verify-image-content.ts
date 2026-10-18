import type { Sharp } from 'sharp';

export const imageTypes = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
} as const;

export async function verifyImageContent(
  decoder: Sharp,
  declaredType: string | undefined,
  invalid: () => Error,
) {
  const metadata = await decoder.metadata();
  if (!(metadata.format in imageTypes)) throw invalid();
  const contentType = imageTypes[metadata.format as keyof typeof imageTypes];
  if (contentType !== declaredType) throw invalid();
  // 只读头不足以接受图片；包括动画全部帧在内的像素必须实际解码。
  // decoder 的取消和销毁由建立它的上传流程管理。
  await decoder.raw().toBuffer();
  return contentType;
}
