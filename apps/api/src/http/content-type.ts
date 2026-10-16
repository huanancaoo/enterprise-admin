import { MIMEType } from 'node:util';

export function contentTypeEssence(
  value: string | undefined,
): string | undefined {
  if (value === undefined) return undefined;
  try {
    return new MIMEType(value).essence;
  } catch {
    return undefined;
  }
}
