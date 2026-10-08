# Shadow-root check: firefox, live

| | proton | protonWalk | protonGroup |
|---|---|---|---|
| Pages fully correct | 1/4 | 2/4 | 3/4 |
| Visible fields correct | 3/8 | 5/8 | 7/8 |
| Predictions on invisible fields | 0 | 0 | 0 |
| Median / max detection per page | 1.0 / 1.0 ms | 17.0 / 25.0 ms | 18.0 / 28.0 ms |
| … of which root walk, median / max | – | 1.0 / 4.0 ms | 2.0 / 3.0 ms |
| Roots with an input, median / max | – | 5 / 6 | 5 / 6 |
| Pages with an error | 0 | 0 | 0 |

## Per page (misses as `field truth→predicted`)

| Page | proton | protonWalk | protonGroup |
|---|---|---|---|
| archive-org-home | ✓ (0.0 ms) | ✓ (25.0 ms, 6 roots) | ✓ (28.0 ms, 6 roots) |
| archive-org-login | f0:3 username→none; f0:4 current-password→none (1.0 ms) | ✓ (17.0 ms, 5 roots) | ✓ (18.0 ms, 5 roots) |
| reddit-login | f0:0 username→none; f0:1 current-password→none (1.0 ms) | f0:0 username→none; f0:1 current-password→none (13.0 ms, 5 roots) | ✓ (18.0 ms, 5 roots) |
| reddit-register | f0:0 signup-username→none (0.0 ms) | f0:0 signup-username→none (10.0 ms, 5 roots) | f0:0 signup-username→none (14.0 ms, 5 roots) |
