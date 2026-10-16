// Allowed: every kind of failure handled.
import type { CoreResult } from '../../../../../src/background/core-client';

export function describe(result: CoreResult<string>): string {
  if (result.ok) return result.value;
  switch (result.error.kind) {
    case 'WrongKey':
    case 'CachedKeyStale':
      return 'locked';
    case 'UnsupportedFile':
    case 'Corrupt':
    case 'ChallengeResponseRequired':
    case 'RemoteKeyChanged':
    case 'NotFound':
    case 'EntryChanged':
    case 'InvalidChange':
    case 'VerifyFailed':
    case 'Internal':
    case 'CoreUnavailable':
      return 'failed';
  }
}
