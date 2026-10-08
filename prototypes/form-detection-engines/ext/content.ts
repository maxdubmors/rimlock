// Content script (isolated world) for the shadow-root check. The harness asks
// each frame for one variant per page load, because Proton leaves expando flags
// on the elements it has seen and a second run in the same load would skip them:
//   proton      the package as in the engine comparison: document only
//   protonWalk  the same package fed every root, closed ones included
//   protonGroup protonWalk plus rimlock's cluster flag and cross-root grouping
// Request and reply are CustomEvents on `document` carrying JSON strings, the
// one thing that crosses from the page's world into ours and back unchanged.
import { detect } from "../engines/proton";
import { detectWalk, traceWalk, type ShadowOf } from "../engines/proton-walk";

declare const chrome: any;

// Chrome exposes closed roots through chrome.dom, Firefox through an Xray-only
// property on the element. Both return the open root too. chrome.dom throws on
// anything that is not an HTMLElement (every <svg> on the page), so filter first.
const shadowOf: ShadowOf =
  typeof chrome !== "undefined" && chrome.dom?.openOrClosedShadowRoot
    ? (el) => (el instanceof HTMLElement ? chrome.dom.openOrClosedShadowRoot(el) ?? null : null)
    : (el) => (el instanceof HTMLElement ? (el as any).openOrClosedShadowRoot ?? null : null);

const SKIP = new Set(["hidden", "submit", "button", "reset", "image", "checkbox", "radio", "file", "range", "color"]);
const ids = new WeakMap<Element, string>();
const id = (el: Element) => ids.get(el) ?? null;
(globalThis as any).__rl_id = id;

// stamp.js, with closed roots: same ids, same order, as long as the page has
// no closed root before a field (the live labels were keyed on stamp.js ids).
function stamp(frameKey: string) {
  const fields: any[] = [];
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true } as any)) return false;
    const vw = Math.max(document.documentElement.scrollWidth, innerWidth);
    const vh = Math.max(document.documentElement.scrollHeight, innerHeight);
    return r.right > 0 && r.bottom > 0 && r.left < vw && r.top < vh;
  };
  const walk = (root: Document | ShadowRoot, shadow: false | "open" | "closed") => {
    for (const el of root.querySelectorAll("*")) {
      const sr = el.tagName === "INPUT" ? null : shadowOf(el);
      if (sr) walk(sr, shadow === "closed" || sr.mode === "closed" ? "closed" : "open");
      if (el.tagName !== "INPUT") continue;
      const input = el as HTMLInputElement;
      const type = (input.getAttribute("type") || "text").toLowerCase();
      if (SKIP.has(type)) continue;
      const fid = `${frameKey}:${fields.length}`;
      ids.set(el, fid);
      const gt = input.getAttribute("data-gt");
      input.removeAttribute("data-gt");
      fields.push({
        id: fid, type, name: input.getAttribute("name"), htmlId: input.id || null,
        autocomplete: input.getAttribute("autocomplete"), placeholder: input.getAttribute("placeholder"),
        aria: input.getAttribute("aria-label"), form: input.form ? input.form.getAttribute("action") || "(form)" : null,
        shadow, visible: visible(el), gt,
      });
    }
  };
  walk(document, false);
  return fields;
}

document.addEventListener("rl-run", async (e) => {
  const { variant, frameKey } = JSON.parse((e as CustomEvent).detail);
  const out: any = { url: location.href, world: "isolated" };
  try {
    out.fields = stamp(frameKey);
    if (variant === "trace") out.trace = traceWalk(shadowOf, id);
    else if (out.fields.length) out[variant] = variant === "proton" ? await detect() : await detectWalk(shadowOf, id, { group: variant === "protonGroup" });
  } catch (err: any) {
    out[variant] = { error: String(err?.stack ?? err).split("\n").slice(0, 3).join(" | ") };
  }
  document.dispatchEvent(new CustomEvent("rl-result", { detail: JSON.stringify(out) }));
});
