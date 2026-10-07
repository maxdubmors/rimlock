# Scores (fixtures)

| | bitwarden | proton |
|---|---|---|
| Pages fully correct | 12/21 (57%) | 14/21 (67%) |
| … fixture | 12/21 | 14/21 |
| Visible fields correct | 37/55 (67%) | 46/55 (84%) |
| username: P / R / F1 | 92% / 85% / 0.88 (n=13) | 85% / 85% / 0.85 (n=13) |
| current-password: P / R / F1 | 100% / 92% / 0.96 (n=13) | 100% / 77% / 0.87 (n=13) |
| new-password: P / R / F1 | 80% / 50% / 0.62 (n=8) | 100% / 100% / 1.00 (n=8) |
| signup-username: P / R / F1 | 50% / 33% / 0.40 (n=3) | 100% / 33% / 0.50 (n=3) |
| otp: P / R / F1 | – / 0% / 0.00 (n=7) | 100% / 100% / 1.00 (n=7) |
| Predictions on invisible fields | 2 | 1 |
| Median detection time per page | 5.5 ms | 19.0 ms |
| Max detection time per page | 8 ms | 31 ms |
| Pages where the engine threw | 0 | 0 |

## Per page (misses as `field truth→predicted`)

| Page | bitwarden | proton |
|---|---|---|
| fixture-classic-form | ✓ | ✓ |
| fixture-forgot-password | f0:0 none→username | f0:0 none→username |
| fixture-formless-spa | ✓ | ✓ |
| fixture-german-signup | f0:0 signup-username→none; f0:1 new-password→none; f0:2 new-password→none | f0:0 signup-username→none |
| fixture-honeypot | ✓ | f0:1 current-password→none |
| fixture-iframe-host | f1:0 username→none | ✓ |
| fixture-login-and-signup | f0:2 signup-username→none; f0:3 new-password→none; f0:4 new-password→none | f0:2 signup-username→none |
| fixture-modal-login | ✓ | f0:3 none→username |
| fixture-multistep-1 | ✓ | ✓ |
| fixture-multistep-1-noattrs | ✓ | ✓ |
| fixture-multistep-2 | ✓ | ✓ |
| fixture-negatives | ✓ | ✓ |
| fixture-nested-shadow | ✓ | f0:0 username→none; f0:1 current-password→none |
| fixture-no-attrs | ✓ | ✓ |
| fixture-open-shadow | ✓ | f0:0 username→none; f0:1 current-password→none |
| fixture-otp-single | f0:0 otp→none | ✓ |
| fixture-otp-split | f0:0 otp→none; f0:1 otp→none; f0:2 otp→none; f0:3 otp→none; f0:4 otp→none; f0:5 otp→none | ✓ |
| fixture-password-change | f0:0 current-password→new-password | ✓ |
| fixture-pin-login | f0:0 username→none | ✓ |
| fixture-russian | ✓ | ✓ |
| fixture-signup | f0:0 none→signup-username | ✓ |
