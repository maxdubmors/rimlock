// Injected into every frame before the engines run. Walks the DOM including open
// shadow roots, gives every <input> a stable id held in a page-side Map (never an
// attribute: both engines read attributes and data-*), records a field summary for
// labelling, and moves fixture ground truth out of `data-gt` so neither engine sees it.
(frameKey) => {
  const SKIP = new Set(["hidden", "submit", "button", "reset", "image", "checkbox", "radio", "file", "range", "color"]);
  const els = new Map();
  const ids = new WeakMap();
  const fields = [];
  const labelText = (el) => {
    const parts = [];
    if (el.labels) for (const l of el.labels) parts.push(l.innerText);
    const by = el.getAttribute("aria-labelledby");
    if (by) for (const id of by.split(/\s+/)) parts.push(el.getRootNode().getElementById?.(id)?.innerText ?? "");
    if (!parts.join("").trim()) {
      // Nearest preceding text, the way a human would read an unlabeled field.
      let n = el;
      for (let i = 0; i < 3 && n && !parts.join("").trim(); i++) {
        n = n.parentElement;
        if (n) parts.push(n.innerText?.slice(0, 80) ?? "");
      }
    }
    return parts.join(" ").replace(/\s+/g, " ").trim().slice(0, 80);
  };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
    const vw = Math.max(document.documentElement.scrollWidth, innerWidth);
    const vh = Math.max(document.documentElement.scrollHeight, innerHeight);
    return r.right > 0 && r.bottom > 0 && r.left < vw && r.top < vh;
  };
  const walk = (root, shadow) => {
    for (const el of root.querySelectorAll("*")) {
      if (el.shadowRoot) walk(el.shadowRoot, true);
      if (el.tagName !== "INPUT") continue;
      const type = (el.getAttribute("type") || "text").toLowerCase();
      if (SKIP.has(type)) continue;
      const id = `${frameKey}:${fields.length}`;
      els.set(id, el);
      ids.set(el, id);
      const gt = el.getAttribute("data-gt");
      el.removeAttribute("data-gt");
      fields.push({
        id,
        type,
        name: el.getAttribute("name"),
        htmlId: el.id || null,
        autocomplete: el.getAttribute("autocomplete"),
        placeholder: el.getAttribute("placeholder"),
        aria: el.getAttribute("aria-label"),
        label: labelText(el),
        maxlength: el.getAttribute("maxlength"),
        form: el.form ? el.form.getAttribute("action") || "(form)" : null,
        shadow,
        visible: visible(el),
        gt,
      });
    }
  };
  walk(document, false);
  window.__rl_els = els;
  window.__rl_id = (el) => ids.get(el) ?? null;
  return { url: location.href, title: document.title, fields };
};
