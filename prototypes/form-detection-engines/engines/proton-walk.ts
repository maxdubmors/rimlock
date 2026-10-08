// Proton's classifier, unmodified, fed one root at a time: the document and
// every shadow root under it (closed ones too, when the caller can open them).
// This is the rimlock-owned shadow-root walk ADR-0009 calls for. Everything here
// uses the package's public exports; nothing in node_modules is patched.
import {
  clearDetectionCache, flagCluster, getOverridableFields, getOverridableForms, isProcessableField, isProcessed, isVisibleForm,
  prepass, removeClassifierFlags, removeHiddenFlag, selectFormCandidates, selectInputCandidates, shadowPiercingContains,
} from "@protontech/autofill";
import { FieldType, FormType, fieldTypes, formTypes } from "@protontech/autofill/types";

import { bestForm, higher, predict, ruleset, toLabel, type Pred } from "./proton";
import type { Detection } from "./types";

export type Root = Document | ShadowRoot;
export type ShadowOf = (el: Element) => ShadowRoot | null;

// Elements whose shadow root, if any, is the browser's own (user-agent) one.
const UA_HOSTS = new Set(["INPUT", "TEXTAREA", "SELECT", "VIDEO", "AUDIO", "IMG", "DETAILS", "METER", "PROGRESS"]);

// Document order: a host's shadow root is listed before the host's light children.
export function collectRoots(doc: Document, shadowOf: ShadowOf): Root[] {
  const roots: Root[] = [doc];
  const walk = (root: Root) => {
    for (const el of root.querySelectorAll("*")) {
      if (UA_HOSTS.has(el.tagName)) continue;
      const sr = shadowOf(el);
      if (sr) {
        roots.push(sr);
        walk(sr);
      }
    }
  };
  walk(doc);
  return roots;
}

// shouldRunClassifier() with the root as a parameter: the package's version
// only looks at `document`. Same logic, same side effects on the flags.
function shouldRun(roots: Root[]) {
  let run = false;
  const forms = getOverridableForms().concat(roots.flatMap((r) => selectFormCandidates(r as any)));
  for (const form of forms) {
    if (isProcessed(form)) {
      const unprocessed = selectInputCandidates(form).some(isProcessableField);
      if (unprocessed) removeClassifierFlags(form, { preserveIgnored: false });
      run ||= unprocessed;
    } else if (isVisibleForm(form)) {
      removeHiddenFlag(form);
      run = true;
    }
  }
  if (run) return true;
  return getOverridableFields().concat(roots.flatMap((r) => selectInputCandidates(r as any))).some(isProcessableField);
}

// How many composed ancestors up two lone fields may meet and still count as one
// form. Reddit's faceplate inputs meet at their <fieldset>, 6 elements up.
const NEAR = 8;

type Timing = { roots: number; walkMs: number; classifyMs: number };

// Composed-tree parent: crosses from a shadow root to its host.
const composedParent = (n: Node): Node | null => (n instanceof ShadowRoot ? n.host : n.parentNode);
const composedAncestors = (el: Element) => {
  const out: Node[] = [];
  for (let n = composedParent(el); n && n.nodeType !== Node.DOCUMENT_NODE; n = composedParent(n)) if (n.nodeType === Node.ELEMENT_NODE) out.push(n);
  return out;
};

// With `group`, rimlock adds two things on top of the unmodified classifier:
// 1. A field alone in its root with no form candidate gets a cluster flag on its
//    outermost element (Proton's public flagCluster), so the classifier has a
//    form to hang it on and types it at all.
// 2. Fields that are alone in their form (in their own root) are grouped with
//    the other lone fields they share a composed ancestor with, and the group's
//    purpose comes from the field types in it: a new password makes it a
//    sign-up, a current password a login. Proton types the fields; rimlock
//    decides what the form is for (ADR-0009: "Proton classifies; it does not decide").
export async function detectWalk(shadowOf: ShadowOf, id: (el: Element) => string | null, opts: { group?: boolean } = {}): Promise<Detection & Timing> {
  const t0 = performance.now();
  const roots = collectRoots(document, shadowOf);
  const t1 = performance.now();
  // A root with no input cannot contribute a field; skipping it is the main saving.
  const live = roots.filter((r) => r === document || r.querySelector("input"));
  for (const r of live) {
    prepass(r as any);
    if (!opts.group || r === document) continue;
    const forms = selectFormCandidates(r as any);
    for (const input of selectInputCandidates(r as any)) {
      if (forms.some((f) => f.contains(input))) continue;
      let top: Element = input;
      while (top.parentElement) top = top.parentElement;
      if (top !== input) flagCluster(top as HTMLElement);
    }
  }
  const fields: Detection["fields"] = [];
  const raw: string[] = [];
  if (shouldRun(live)) {
    const perRoot = live.map((r) => {
      const bound = ruleset.against(r as any);
      return { root: r, forms: predict(bound, "form", formTypes, bestForm), preds: predict(bound, "field", fieldTypes, higher) };
    });
    const allForms = perRoot.flatMap((x) => x.forms);
    const allPreds = perRoot.flatMap((x) => x.preds);
    // The form the classifier itself used: the innermost one around the field in its own root.
    const ownForm = (p: Pred<FieldType>) => {
      const own = perRoot.find((x) => x.preds.includes(p))!.forms.filter((f) => f.el.contains(p.el));
      return own.find((f) => !own.some((g) => g !== f && f.el.contains(g.el))) ?? null;
    };
    const formOf = new Map(allPreds.map((p) => [p, ownForm(p) ?? allForms.find((f) => shadowPiercingContains(f.el, p.el)) ?? null]));
    const purpose = new Map<Pred<FieldType>, FormType>();
    if (opts.group) {
      const lone = allPreds.filter((p) => !allPreds.some((q) => q !== p && formOf.get(q) && formOf.get(q) === formOf.get(p)));
      const groups: Pred<FieldType>[][] = [];
      // Near ancestors only: a search box and a login form elsewhere on the page must not merge.
      const near = (el: Element) => composedAncestors(el).filter((n) => n !== document.body && n !== document.documentElement).slice(0, NEAR);
      for (const p of lone) {
        const up = new Set(near(p.el));
        const g = groups.find((g) => g.some((q) => near(q.el).some((n) => up.has(n))));
        g ? g.push(p) : groups.push([p]);
      }
      for (const g of groups) {
        if (g.length < 2) continue;
        const types = new Set(g.map((p) => p.type));
        const type = types.has(FieldType.PASSWORD_NEW) ? FormType.REGISTER : types.has(FieldType.PASSWORD_CURRENT) ? FormType.LOGIN : null;
        if (type) for (const p of g) purpose.set(p, type);
      }
    }
    for (const p of allPreds) {
      const form = formOf.get(p);
      const formType = purpose.get(p) ?? form?.type ?? FormType.NOOP;
      const label = toLabel(p.type, formType);
      raw.push(`${id(p.el)} ${p.type}:${p.score.toFixed(2)} in ${form ? `${form.el.tagName.toLowerCase()} ${form.type}:${form.score.toFixed(2)}` : "-"}${purpose.has(p) ? ` group:${formType}` : ""} → ${label}`);
      if (label) fields.push({ id: id(p.el), label });
    }
  }
  clearDetectionCache();
  const t2 = performance.now();
  return { engine: "proton", ms: t2 - t0, walkMs: t1 - t0, classifyMs: t2 - t1, roots: live.length, fields, raw } as any;
}

export type { Pred };

// Why a field got no prediction: flags and form fnodes per root, after a walk.
import { fathom, isClassifiable, isIgnored, isVisibleField } from "@protontech/autofill";
export function traceWalk(shadowOf: ShadowOf, id: (el: Element) => string | null) {
  const roots = collectRoots(document, shadowOf).filter((r) => r === document || r.querySelector("input"));
  const name = (el: Element) => el.tagName.toLowerCase() + (el.getAttribute("name") ? `[${el.getAttribute("name")}]` : "");
  for (const r of roots) prepass(r as any);
  const out: string[] = [`shouldRun=${shouldRun(roots)}`];
  roots.forEach((r, i) => {
    const pre = [...r.querySelectorAll("input")].map((el) => `${id(el) ?? name(el)} classifiable=${isClassifiable(el)} ignored=${isIgnored(el)} visible=${isVisibleField(el)}`);
    const bound = ruleset.against(r as any);
    const forms = predict(bound, "form", formTypes, bestForm).map((f) => `${name(f.el)} ${f.type}:${f.score.toFixed(2)}`);
    const fieldFnodes = bound.get(fathom.type("field")).map((f: any) => id(f.element) ?? name(f.element));
    const cands = bound.get(fathom.type("field-candidate")).map((f: any) => id(f.element) ?? name(f.element));
    out.push(`root${i} ${r === document ? "document" : `${(r as ShadowRoot).mode} <${name((r as ShadowRoot).host)}>`}: inputs[${pre.join("; ")}] candidates[${cands}] fields[${fieldFnodes}] forms[${forms.join("; ")}]`);
  });
  clearDetectionCache();
  return out;
}
