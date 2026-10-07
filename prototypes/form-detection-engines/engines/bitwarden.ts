// Bitwarden heuristics, lifted from bitwarden/clients (see fetch-bitwarden.sh).
// Runs CollectAutofillContentService, then replays the inline menu's
// field-qualification decision (AutofillOverlayContentService.isIgnoredField and
// the setQualified*FillType helpers) without the overlay, rxjs or messaging.
import "./bitwarden-shim";
import { CollectAutofillContentService } from "bw/services/collect-autofill-content.service";
import DomElementVisibilityService from "bw/services/dom-element-visibility.service";
import { DomQueryService } from "bw/services/dom-query.service";
import { InlineMenuFieldQualificationService } from "bw/services/inline-menu-field-qualification.service";
import { AutoFillConstants } from "bw/services/autofill-constants";
import type AutofillField from "bw/models/autofill-field";
import type AutofillPageDetails from "bw/models/autofill-page-details";

import type { Detection, Label } from "./types";

const ignoredFieldTypes = new Set<string>(AutoFillConstants.ExcludedInlineMenuTypes);

function classify(
  q: InlineMenuFieldQualificationService,
  field: AutofillField,
  page: AutofillPageDetails,
): Label | null {
  if (field.type != null && ignoredFieldTypes.has(field.type)) return null;
  const isPassword = field.type === "password";
  if (q.isFieldForLoginForm(field, page)) {
    if (q.isTotpField(field) && !isPassword) return "otp";
    if (q.isUpdateCurrentPasswordField(field)) return "current-password";
    return isPassword ? "current-password" : "username";
  }
  if (q.isFieldForAccountCreationForm(field, page)) {
    if (q.isNewPasswordField(field)) return "new-password";
    if (q.isUpdateCurrentPasswordField(field)) return "current-password";
    if (q.isTotpField(field)) return "otp";
    if (q.isUsernameField(field)) return "signup-username";
  }
  // The inline menu ignores standalone TOTP fields outside login/creation forms,
  // but Bitwarden's fill path still fills them: report them so OTP is comparable.
  if (q.isTotpField(field)) return "otp";
  return null;
}

export async function detect(): Promise<Detection> {
  const t0 = performance.now();
  const collect = new CollectAutofillContentService(
    new DomElementVisibilityService(),
    new DomQueryService(),
  );
  const q = new InlineMenuFieldQualificationService();
  const page = await collect.getPageDetails(); // also lets the premium-status reply land
  const fields: Detection["fields"] = [];
  for (const field of page.fields) {
    const label = classify(q, field, page);
    if (!label) continue;
    const el = collect.getAutofillFieldElementByOpid(field.opid) as HTMLElement | null;
    fields.push({ id: (globalThis as any).__rl_id(el), label });
  }
  return { engine: "bitwarden", ms: performance.now() - t0, fields };
}

// Per-field qualification trace, for adjudicating misses by hand.
export async function debug() {
  const collect = new CollectAutofillContentService(new DomElementVisibilityService(), new DomQueryService());
  const q = new InlineMenuFieldQualificationService();
  const page = await collect.getPageDetails();
  return page.fields.map((f) => ({
    opid: f.opid, type: f.type, viewable: f.viewable, htmlName: f.htmlName,
    user: q.isUsernameField(f), cur: q.isCurrentPasswordField(f), neu: q.isNewPasswordField(f),
    login: q.isFieldForLoginForm(f, page), create: q.isFieldForAccountCreationForm(f, page),
    totp: q.isTotpField(f), disq: (q as any).fieldHasDisqualifyingAttributeValue(f), labels: [f["label-tag"], f["label-left"], f["label-top"], f.placeholder, f["label-aria"]],
  }));
}
