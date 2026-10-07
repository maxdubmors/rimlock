// Stand-in for apps/browser/src/autofill/services/autofill.service.ts (3,222 lines,
// rxjs + @bitwarden/common vault/auth/billing). The qualification service only
// needs this one static helper, copied verbatim.
export default class AutofillService {
  static autoCompleteTypeIncludesToken(
    autoCompleteType: string | null | undefined,
    token: string,
  ): boolean {
    if (autoCompleteType == null || typeof autoCompleteType !== "string") {
      return false;
    }

    const normalizedToken = token.trim().toLowerCase();
    if (!normalizedToken) {
      return false;
    }

    const parts = autoCompleteType.trim().toLowerCase().split(/\s+/);
    return parts.includes(normalizedToken);
  }
}
