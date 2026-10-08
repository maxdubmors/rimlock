// Writes corpus/fixtures/shadow-*.html: the shadow-DOM shapes the engine
// comparison did not cover. Ground truth is inline (`data-gt`), as in the other
// fixtures; the content script strips it before any engine runs.
import { writeFileSync } from "node:fs";

const page = (title, main, script) => `<!doctype html><meta charset="utf-8"><style>body{font:16px sans-serif;margin:40px}label,input,button{display:block;margin:6px 0}input{width:260px;padding:6px}</style><title>${title}</title><header style="display:flex;gap:12px;border-bottom:1px solid #ddd;padding:8px 0"><a href="/">Acme</a><nav><a href="/products">Products</a> <a href="/pricing">Pricing</a> <a href="/docs">Docs</a> <a href="/blog">Blog</a> <a href="/about">About</a></nav></header><main>${main}
</main><footer style="margin-top:40px;border-top:1px solid #ddd;color:#666;font-size:13px"><p>© 2026 Acme Inc.</p><ul><li><a href="/terms">Terms</a></li><li><a href="/privacy">Privacy</a></li><li><a href="/cookies">Cookies</a></li><li><a href="/status">Status</a></li><li><a href="/help">Help</a></li><li><a href="/contact">Contact</a></li></ul></footer><script>
${script}
</script>
`;

const STYLE = "<style>input{display:block;margin:6px 0;width:260px}</style>";
// A component whose root holds the whole form.
const whole = (tag, mode, html) => `customElements.define("${tag}", class extends HTMLElement { connectedCallback() {
  const r = this.attachShadow({ mode: "${mode}" });
  r.innerHTML = ${JSON.stringify(STYLE + html)};
}});`;
// A field component: one label and one input in its own root (Reddit's faceplate-text-input, Lit/Shoelace inputs).
const field = (mode) => `customElements.define("x-field", class extends HTMLElement { connectedCallback() {
  const r = this.attachShadow({ mode: "${mode}" });
  const a = (n, d = "") => this.getAttribute(n) ?? d;
  r.innerHTML = '<label>' + a("label") + '<input type="' + a("type", "text") + '" name="' + a("name") + '"' + (this.hasAttribute("autocomplete") ? ' autocomplete="' + a("autocomplete") + '"' : "") + ' data-gt="' + a("gt", "none") + '"></label>';
}});`;
// The form-level component: a heading, field components and the button in one root.
const app = (mode, inner) => `customElements.define("x-app", class extends HTMLElement { connectedCallback() {
  const r = this.attachShadow({ mode: "${mode}" });
  r.innerHTML = ${JSON.stringify(inner)};
}});`;

const LOGIN = '<form action="/session"><label>Username<input name="user" data-gt="username"></label><label>Password<input type="password" name="pass" data-gt="current-password"></label><button>Sign in</button></form>';
const FIELDS_LOGIN = '<x-field label="Email" name="email" gt="username"></x-field><x-field label="Password" type="password" name="password" gt="current-password"></x-field>';

const fixtures = {
  // One root holds the whole form.
  "shadow-closed": page("Login", "<x-login></x-login>", whole("x-login", "closed", LOGIN)),
  "shadow-signup": page("Create account", "<x-signup></x-signup>", whole("x-signup", "open",
    '<h1>Create your account</h1><form action="/join"><label>Email<input type="email" name="email" data-gt="signup-username"></label><label>Password<input type="password" name="password" autocomplete="new-password" data-gt="new-password"></label><label>Confirm password<input type="password" name="password2" data-gt="new-password"></label><button>Create account</button></form>')),
  "shadow-otp": page("Two-factor authentication", "<x-otp></x-otp>", whole("x-otp", "open",
    '<h1>Two-factor authentication</h1><form action="/2fa"><label>Authentication code<input name="otp" inputmode="numeric" maxlength="6" data-gt="otp"></label><button>Verify</button></form>')),
  "shadow-formless": page("Login", "<x-login></x-login>", whole("x-login", "open",
    '<div class="card"><h2>Welcome back</h2><div><label>Username<input name="username" data-gt="username"></label></div><div><label>Password<input type="password" name="password" data-gt="current-password"></label></div><button type="button">Log in</button></div>')),
  // Field components nested in a form-level component (the existing nested-shadow fixture, with closed roots).
  "shadow-closed-nested": page("Portal login", "<x-app></x-app>", field("open") + "\n" + app("closed", `<h2>Sign in</h2>${FIELDS_LOGIN}<button>Sign in</button>`)),
  "shadow-closed-in-closed": page("Portal login", "<x-app></x-app>", field("closed") + "\n" + app("closed", `<h2>Sign in</h2>${FIELDS_LOGIN}<button>Sign in</button>`)),
  "shadow-nested-form": page("Portal login", "<x-app></x-app>", field("open") + "\n" + app("open", `<h2>Sign in</h2><form action="/session">${FIELDS_LOGIN}<button>Sign in</button></form>`)),
  // The form is in the light DOM, its fields are not: the form boundary and the root boundary disagree.
  "shadow-split-form": page("Log in", `<h1>Log in</h1><form action="/session">${FIELDS_LOGIN.replace('label="Email"', 'label="Email or username"')}<button type="submit">Log in</button></form>`, field("open")),
  "shadow-split-closed": page("Log in", `<h1>Log in</h1><form action="/session">${FIELDS_LOGIN}<button type="submit">Log in</button></form>`, field("closed")),
  "shadow-split-mixed": page("Log in", `<h1>Log in</h1><form action="/session"><label>Username<input name="login" data-gt="username"></label><x-field label="Password" type="password" name="password" gt="current-password"></x-field><button type="submit">Log in</button></form>`, field("open")),
  "shadow-split-signup": page("Sign up", `<h1>Create your account</h1><form action="/register"><x-field label="Email" type="email" name="email" gt="signup-username"></x-field><x-field label="Password" type="password" name="password" autocomplete="new-password" gt="new-password"></x-field><button type="submit">Create account</button></form>`, field("open")),
  // Control: the shadow-signup form, in the light DOM. Separates model behaviour from shadow effects.
  "shadow-control-signup-light": page("Create account", '<h1>Create your account</h1><form action="/join"><label>Email<input type="email" name="email" data-gt="signup-username"></label><label>Password<input type="password" name="password" autocomplete="new-password" data-gt="new-password"></label><label>Confirm password<input type="password" name="password2" data-gt="new-password"></label><button>Create account</button></form>', ""),
  // Control: light-DOM inputs slotted into a shadow layout. Proton sees these already.
  "shadow-slotted": page("Login", `<x-card><form action="/session"><label>Username<input name="user" data-gt="username"></label><label>Password<input type="password" name="pass" data-gt="current-password"></label><button>Sign in</button></form></x-card>`,
    whole("x-card", "open", '<div style="border:1px solid #ccc;padding:16px"><h2>Sign in</h2><slot></slot></div>')),
  // Negative: a search box and a newsletter field inside components.
  "shadow-negatives": page("Acme blog", "<h1>Blog</h1><x-search></x-search><p>Lorem ipsum dolor sit amet.</p><x-news></x-news>",
    whole("x-search", "open", '<form action="/search" role="search"><input type="search" name="q" placeholder="Search" data-gt="none"><button>Search</button></form>') + "\n" +
    whole("x-news", "closed", '<form action="/subscribe"><label>Get the newsletter<input type="email" name="email" placeholder="you@example.com" data-gt="none"></label><button>Subscribe</button></form>')),
};

for (const [name, html] of Object.entries(fixtures)) writeFileSync(`corpus/fixtures/${name}.html`, html);
writeFileSync("corpus/fixtures-shadow.txt", ["open-shadow", "nested-shadow", ...Object.keys(fixtures)].map((n) => `${n}.html`).join("\n") + "\n");
console.log(Object.keys(fixtures).length, "fixtures");
