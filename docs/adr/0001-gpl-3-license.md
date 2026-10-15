# License rimlock under GPL-3.0-only

rimlock is open source and will ship on the Chrome Web Store and AMO. We chose GPL-3.0 over MIT/Apache-2.0 so we can reuse code from the GPL-licensed prior art (Bitwarden clients' autofill heuristics, KeePassXC-Browser). Years of form-detection edge cases are worth more than permissive licensing for downstream reuse. This is hard to reverse once GPL code has been incorporated.

The SPDX identifier is `GPL-3.0-only`, not `GPL-3.0-or-later`. Both sources we expect to borrow from are GPL v3 without the "or later" option, and a work that contains such code can only be distributed under v3, so declaring "or later" would promise a choice we cannot give. It also keeps the licence of future versions with us rather than with whatever the FSF publishes next.

Not every source is GPL. KeeWeb is MIT, and Bitwarden's `bitwarden_license/` directory is under the proprietary Bitwarden License; MIT code can be reused with its notice in `NOTICE`, and nothing is taken from `bitwarden_license/`.
