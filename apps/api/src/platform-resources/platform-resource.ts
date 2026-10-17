import type { StoredRead } from '../files/storage/storage';
import type { Identity } from '../identity/identity.service';

export type PlatformResourceActor = Pick<Identity, 'userId' | 'sessionId'>;
export type PlatformResourcePurpose =
  'announcement' | 'task-input' | 'task-output';

export interface PlatformResource {
  id: string;
  purpose: PlatformResourcePurpose;
  uploadedBy: string;
  name: string;
  mimeType: string;
  bytes: number;
  sha256: string;
  createdAt: string;
}

export interface PlatformResourceInput {
  name: string;
  mimeType: string;
  bytes: number;
  source: AsyncIterable<Uint8Array>;
}

export interface OpenPlatformResource {
  resource: PlatformResource;
  read: StoredRead;
}
