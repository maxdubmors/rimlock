// Broken: a `default` hides the kinds this switch forgot, CoreUnavailable among them.
import type { CoreResult } from '../../../../../src/background/core-client';

export function describe(result: CoreResult<string>): string {
  if (result.ok) return result.value;
  switch (result.error.kind) {
    case 'WrongKey':
      return 'wrong key';
    default:
      return 'failed';
  }
}
