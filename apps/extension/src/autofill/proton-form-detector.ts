// FormDetector over Proton's classifier (@protontech/autofill, MPL-2.0), unmodified, fed one root
// at a time: the document and every shadow root under it, closed ones included (autofill.md
// § Form detection, ADR-0009). Ported as it was verified in "Verify Proton classification across
// shadow roots" (the prototype's `protonGroup`), on the package's exported internals only.

import {
  clearDetectionCache,
  createRulesetRegistry,
  FieldType,
  fieldTypes,
  flagCluster,
  FormType,
  formTypes,
  getOverridableFields,
  getOverridableForms,
  getTypeScore,
  isProcessableField,
  isProcessed,
  isVisibleForm,
  prepass,
  removeClassifierFlags,
  removeHiddenFlag,
  selectFormCandidates,
  selectInputCandidates,
  shadowPiercingContains,
} from '@protontech/autofill';
import { randomForestModelProvider } from '@protontech/autofill/models/random_forest';

import type { FieldLabel, FormDetector, LabelledField } from './form-detector';
import { collectRoots, type Root, type ShadowRootOf } from './shadow-roots';

// The bundled random-forest model: no remote rules, no model download (ADR-0002).
const ruleset = createRulesetRegistry({ randomForest: randomForestModelProvider }).make(
  'randomForest',
);

type BoundRuleset = ReturnType<typeof ruleset.against>;
type Prediction<T> = { element: HTMLElement; type: T; score: number };
type FieldPrediction = Prediction<FieldType>;

/**
 * Proton's functions query whatever node they are given, but are typed for a `Document` or an
 * element: a shadow root passes for one.
 */
const asDocument = (root: Root) => root as Document;

/** Proton's best score among `types` for each element of `base`. */
function predict<T extends string>(
  bound: BoundRuleset,
  base: string,
  types: readonly T[],
  best: (a: Prediction<T>, b: Prediction<T>) => Prediction<T>,
): Prediction<T>[] {
  // Runs the rules up to `base` (every form, or every field) before any type is read.
  bound.get(base);
  const out = new Map<HTMLElement, Prediction<T>>();
  for (const type of types) {
    for (const fnode of bound.get(type)) {
      const candidate = { element: fnode.element, type, score: getTypeScore(fnode, type) };
      const previous = out.get(fnode.element);
      out.set(fnode.element, previous ? best(candidate, previous) : candidate);
    }
  }
  return [...out.values()];
}

const higher = <T>(a: Prediction<T>, b: Prediction<T>) => (a.score > b.score ? a : b);

const tie = 0.01;

/** Proton's `selectBestForm`: login on any tie, password change over sign-up on a close one. */
function bestForm(a: Prediction<FormType>, b: Prediction<FormType>): Prediction<FormType> {
  const both = [a, b];
  const passwordChange = both.find((form) => form.type === FormType.PASSWORD_CHANGE);
  const login = both.find((form) => form.type === FormType.LOGIN);
  const register = both.find((form) => form.type === FormType.REGISTER);
  if (passwordChange && register)
    return Math.abs(a.score - b.score) <= tie ? passwordChange : register;
  return login ?? higher(a, b);
}

/**
 * The label a (field type, form type) pair gets: Proton's `FORM_TRACKER_CONFIG`, the dropdown
 * action it gives that pair. A field with no form is in a `noop` form, as Proton tracks it.
 */
function toLabel(field: FieldType, form: FormType): FieldLabel | null {
  if (field === FieldType.OTP) return 'otp';
  const isIdentifier = field === FieldType.USERNAME || field === FieldType.EMAIL;
  switch (form) {
    case FormType.LOGIN:
      if (isIdentifier) return 'username';
      return field === FieldType.PASSWORD_CURRENT ? 'current-password' : null;
    case FormType.REGISTER:
      if (isIdentifier) return 'signup-username';
      return field === FieldType.PASSWORD_NEW ? 'new-password' : null;
    case FormType.RECOVERY:
      return field === FieldType.EMAIL ? 'username' : null;
    case FormType.PASSWORD_CHANGE:
    case FormType.NOOP:
      if (field === FieldType.PASSWORD_CURRENT) return 'current-password';
      return field === FieldType.PASSWORD_NEW ? 'new-password' : null;
  }
}

/**
 * Proton's `shouldRunClassifier()` over a list of roots: the package's own reads only `document`.
 * Same logic, same side effects on the flags.
 */
function shouldRun(roots: Root[]): boolean {
  let run = false;
  const forms = getOverridableForms().concat(
    roots.flatMap((root) => selectFormCandidates(asDocument(root))),
  );
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
  return getOverridableFields()
    .concat(roots.flatMap((root) => selectInputCandidates(asDocument(root))))
    .some(isProcessableField);
}

/**
 * How many composed ancestors up two lone fields may meet and still count as one form. Reddit's
 * field components meet at their `<fieldset>`, 6 elements up.
 */
const near = 8;

/** The composed-tree parent: from a shadow root it crosses to the host. */
const composedParent = (node: Node): Node | null =>
  node instanceof ShadowRoot ? node.host : node.parentNode;

function composedAncestors(element: Element): Node[] {
  const out: Node[] = [];
  for (
    let node = composedParent(element);
    node && node.nodeType !== Node.DOCUMENT_NODE;
    node = composedParent(node)
  )
    if (node.nodeType === Node.ELEMENT_NODE) out.push(node);
  return out;
}

/**
 * Proton types the fields; rimlock decides what a form split across roots is for ("Proton
 * classifies; rimlock decides"). Two steps on top of the unmodified classifier:
 *
 * 1. A field alone in its root with no form candidate gets Proton's cluster flag on its outermost
 *    element there, so the classifier has a form to hang it on and types it at all.
 * 2. Fields alone in their form are grouped with the other lone fields they share a near composed
 *    ancestor with. A new password in the group makes it a sign-up, a current password a login.
 */
export function createProtonFormDetector(
  document: Document,
  shadowRootOf: ShadowRootOf,
): FormDetector {
  return {
    detect() {
      // A root with no input cannot contribute a field; skipping it is the main saving.
      const roots = collectRoots(document, shadowRootOf).filter(
        (root) => root === document || root.querySelector('input'),
      );
      for (const root of roots) {
        prepass(asDocument(root));
        if (root === document) continue;
        const forms = selectFormCandidates(asDocument(root));
        for (const input of selectInputCandidates(asDocument(root))) {
          if (forms.some((form) => form.contains(input))) continue;
          let top: HTMLElement = input;
          while (top.parentElement) top = top.parentElement;
          if (top !== input) flagCluster(top);
        }
      }
      const fields: LabelledField[] = [];
      if (shouldRun(roots)) {
        const perRoot = roots.map((root) => {
          const bound = ruleset.against(asDocument(root));
          return {
            forms: predict(bound, 'form', formTypes, bestForm),
            fields: predict(bound, 'field', fieldTypes, higher),
          };
        });
        const allForms = perRoot.flatMap((root) => root.forms);
        const allFields = perRoot.flatMap((root) => root.fields);
        // The form the classifier itself used: the innermost one around the field in its own root.
        const ownForm = (field: FieldPrediction, rootIndex: number) => {
          const own = (perRoot[rootIndex]?.forms ?? []).filter((form) =>
            form.element.contains(field.element),
          );
          return (
            own.find(
              (form) =>
                !own.some((other) => other !== form && form.element.contains(other.element)),
            ) ?? null
          );
        };
        const formOf = new Map<FieldPrediction, Prediction<FormType> | null>();
        perRoot.forEach((root, rootIndex) => {
          for (const field of root.fields)
            formOf.set(
              field,
              ownForm(field, rootIndex) ??
                allForms.find((form) => shadowPiercingContains(form.element, field.element)) ??
                null,
            );
        });

        const purpose = new Map<FieldPrediction, FormType>();
        const lone = allFields.filter(
          (field) =>
            !allFields.some(
              (other) =>
                other !== field && formOf.get(other) && formOf.get(other) === formOf.get(field),
            ),
        );
        // Near ancestors only: a search box and a login form elsewhere on the page must not merge.
        const nearAncestors = (element: Element) =>
          composedAncestors(element)
            .filter((node) => node !== document.body && node !== document.documentElement)
            .slice(0, near);
        const groups: FieldPrediction[][] = [];
        for (const field of lone) {
          const up = new Set(nearAncestors(field.element));
          const group = groups.find((candidates) =>
            candidates.some((other) => nearAncestors(other.element).some((node) => up.has(node))),
          );
          if (group) group.push(field);
          else groups.push([field]);
        }
        for (const group of groups) {
          if (group.length < 2) continue;
          const types = new Set(group.map((field) => field.type));
          const type = types.has(FieldType.PASSWORD_NEW)
            ? FormType.REGISTER
            : types.has(FieldType.PASSWORD_CURRENT)
              ? FormType.LOGIN
              : null;
          if (type) for (const field of group) purpose.set(field, type);
        }

        for (const field of allFields) {
          const formType = purpose.get(field) ?? formOf.get(field)?.type ?? FormType.NOOP;
          const label = toLabel(field.type, formType);
          if (label) fields.push({ field: field.element, label });
        }
      }
      clearDetectionCache();
      return fields;
    },
  };
}
