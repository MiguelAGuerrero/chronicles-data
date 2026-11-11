// RB2: an adapter's fetch fingerprint, a short hash of whatever decides what its fetch asks for.
import { createHash } from 'node:crypto';

export const fingerprint = (parts: unknown[]): string => createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 16);
