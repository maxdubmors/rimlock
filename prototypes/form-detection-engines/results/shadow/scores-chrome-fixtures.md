# Shadow-root check: chrome, fixtures

| | proton | protonWalk | protonGroup |
|---|---|---|---|
| Pages fully correct | 2/16 | 6/16 | 14/16 |
| Visible fields correct | 6/33 | 22/33 | 31/33 |
| Predictions on invisible fields | 0 | 0 | 0 |
| Median / max detection per page | 0.6 / 26.5 ms | 22.5 / 30.4 ms | 21.3 / 28.0 ms |
| … of which root walk, median / max | – | 0.2 / 0.5 ms | 0.2 / 0.6 ms |
| Roots with an input, median / max | – | 3 / 3 | 3 / 3 |
| Pages with an error | 0 | 0 | 0 |

## Per page (misses as `field truth→predicted`)

| Page | proton | protonWalk | protonGroup |
|---|---|---|---|
| fixture-nested-shadow | f0:0 username→none; f0:1 current-password→none (0.4 ms) | f0:0 username→none (22.6 ms, 3 roots) | ✓ (21.3 ms, 3 roots) |
| fixture-open-shadow | f0:0 username→none; f0:1 current-password→none (0.4 ms) | ✓ (22.4 ms, 2 roots) | ✓ (24.4 ms, 2 roots) |
| fixture-shadow-closed | f0:0 username→none; f0:1 current-password→none (0.7 ms) | ✓ (20.0 ms, 2 roots) | ✓ (19.3 ms, 2 roots) |
| fixture-shadow-closed-in-closed | f0:0 username→none; f0:1 current-password→none (0.3 ms) | f0:0 username→none (22.5 ms, 3 roots) | ✓ (21.2 ms, 3 roots) |
| fixture-shadow-closed-nested | f0:0 username→none; f0:1 current-password→none (0.6 ms) | f0:0 username→none (28.9 ms, 3 roots) | ✓ (21.7 ms, 3 roots) |
| fixture-shadow-control-signup-light | f0:0 signup-username→none (17.6 ms) | f0:0 signup-username→none (16.8 ms, 1 roots) | f0:0 signup-username→none (18.8 ms, 1 roots) |
| fixture-shadow-formless | f0:0 username→none; f0:1 current-password→none (0.4 ms) | ✓ (30.4 ms, 2 roots) | ✓ (28.0 ms, 2 roots) |
| fixture-shadow-negatives | ✓ (0.5 ms) | ✓ (25.1 ms, 3 roots) | ✓ (18.9 ms, 3 roots) |
| fixture-shadow-nested-form | f0:0 username→none; f0:1 current-password→none (0.6 ms) | f0:0 username→none (20.9 ms, 3 roots) | ✓ (21.9 ms, 3 roots) |
| fixture-shadow-otp | f0:0 otp→none (0.6 ms) | ✓ (20.4 ms, 2 roots) | ✓ (20.8 ms, 2 roots) |
| fixture-shadow-signup | f0:0 signup-username→none; f0:1 new-password→none; f0:2 new-password→none (0.3 ms) | f0:0 signup-username→none (20.9 ms, 2 roots) | f0:0 signup-username→none (17.8 ms, 2 roots) |
| fixture-shadow-slotted | ✓ (26.5 ms) | ✓ (25.4 ms, 1 roots) | ✓ (19.8 ms, 1 roots) |
| fixture-shadow-split-closed | f0:0 username→none; f0:1 current-password→none (2.1 ms) | f0:0 username→none (28.8 ms, 3 roots) | ✓ (24.3 ms, 3 roots) |
| fixture-shadow-split-form | f0:0 username→none; f0:1 current-password→none (1.4 ms) | f0:0 username→none (29.3 ms, 3 roots) | ✓ (21.7 ms, 3 roots) |
| fixture-shadow-split-mixed | f0:0 username→none; f0:1 current-password→none (20.5 ms) | f0:0 username→none; f0:1 current-password→none (19.6 ms, 2 roots) | ✓ (22.1 ms, 2 roots) |
| fixture-shadow-split-signup | f0:0 signup-username→none; f0:1 new-password→none (2.2 ms) | f0:0 signup-username→none (19.7 ms, 3 roots) | ✓ (19.7 ms, 3 roots) |
