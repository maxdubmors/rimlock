// Proton Pass classifier from @protontech/autofill (MPL-2.0), driven the way
// Proton's detector.service.ts drives it: prepass, shouldRunClassifier, then the
// bundled random-forest ruleset; forms and fields scored per type, best wins.
import { createRulesetRegistry, getTypeScore, prepass, shadowPiercingContains, shouldRunClassifier, clearDetectionCache } from "@protontech/autofill";
import { randomForestModelProvider } from "@protontech/autofill/models/random_forest";
import { FieldType, FormType, fieldTypes, formTypes } from "@protontech/autofill/types";

import type { Detection, Label } from "./types";

export const ruleset = createRulesetRegistry({ randomForest: randomForestModelProvider }).make("randomForest");
const TIE = 0.01;

export type Pred<T> = { el: HTMLElement; type: T; score: number };

export function predict<T extends string>(bound: any, base: string, types: readonly T[], best: (a: Pred<T>, b: Pred<T>) => Pred<T>) {
  bound.get(base);
  const out = new Map<HTMLElement, Pred<T>>();
  for (const type of types) {
    for (const fnode of bound.get(type)) {
      const cand = { el: fnode.element, type, score: getTypeScore(fnode, type) };
      const prev = out.get(fnode.element);
      out.set(fnode.element, prev ? best(cand, prev) : cand);
    }
  }
  return [...out.values()];
}

export const higher = <T>(a: Pred<T>, b: Pred<T>) => (a.score > b.score ? a : b);
// Proton's selectBestForm: prefer login on any tie, password-change over register on a close tie.
export const bestForm = (a: Pred<FormType>, b: Pred<FormType>) => {
  const c = [a, b];
  const pw = c.find((x) => x.type === FormType.PASSWORD_CHANGE);
  const login = c.find((x) => x.type === FormType.LOGIN);
  const reg = c.find((x) => x.type === FormType.REGISTER);
  if (pw && reg) return Math.abs(a.score - b.score) <= TIE ? pw : reg;
  return login ?? higher(a, b);
};

// Mirrors FORM_TRACKER_CONFIG in Proton's content/constants.runtime.ts: the
// dropdown action a (form type, field type) pair gets. Alias suggestions
// (email in register/noop forms) have no rimlock equivalent except on signup.
// Dangling fields (no predicted form) are tracked by Proton as a NOOP form.
export function toLabel(field: FieldType, form: FormType): Label | null {
  if (field === FieldType.OTP) return "otp";
  const isUser = field === FieldType.USERNAME || field === FieldType.EMAIL;
  switch (form) {
    case FormType.LOGIN:
      if (isUser) return "username";
      return field === FieldType.PASSWORD_CURRENT ? "current-password" : null;
    case FormType.REGISTER:
      if (isUser) return "signup-username";
      return field === FieldType.PASSWORD_NEW ? "new-password" : null;
    case FormType.RECOVERY:
      return field === FieldType.EMAIL ? "username" : null;
    case FormType.PASSWORD_CHANGE:
    case FormType.NOOP:
      if (field === FieldType.PASSWORD_CURRENT) return "current-password";
      return field === FieldType.PASSWORD_NEW ? "new-password" : null;
  }
  return null;
}

export async function detect(): Promise<Detection> {
  const t0 = performance.now();
  prepass();
  const run = shouldRunClassifier();
  const fields: Detection["fields"] = [];
  if (run) {
    const bound = ruleset.against(document);
    const forms = predict(bound, "form", formTypes, bestForm);
    const preds = predict(bound, "field", fieldTypes, higher);
    for (const p of preds) {
      const form = forms.find((f) => shadowPiercingContains(f.el, p.el))?.type ?? FormType.NOOP;
      const label = toLabel(p.type, form);
      if (!label) continue;
      fields.push({ id: (globalThis as any).__rl_id(p.el), label });
    }
  }
  clearDetectionCache();
  return { engine: "proton", ms: performance.now() - t0, fields };
}

// Raw scores per form and field, for adjudicating misses by hand.
export function debug() {
  prepass();
  const run = shouldRunClassifier();
  const bound = ruleset.against(document);
  bound.get("form");
  bound.get("field");
  const describe = (el: HTMLElement) => `${el.tagName.toLowerCase()}${el.getAttribute("name") ? `[name=${el.getAttribute("name")}]` : ""}${el.getAttribute("action") ? `[action=${el.getAttribute("action")}]` : ""}`;
  const out: any = { run, forms: {}, fields: {} };
  for (const t of formTypes) for (const f of bound.get(t)) (out.forms[describe(f.element)] ??= {})[t] = +getTypeScore(f, t).toFixed(3);
  for (const t of fieldTypes) for (const f of bound.get(t)) (out.fields[describe(f.element)] ??= {})[t] = +getTypeScore(f, t).toFixed(3);
  out.attrs = [...document.querySelectorAll("*")].flatMap((e) => [...e.attributes].filter((a) => a.name.startsWith("data-protonpass")).map((a) => `${describe(e as HTMLElement)} ${a.name}`));
  clearDetectionCache();
  return out;
}
