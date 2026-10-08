# Shadow-root check: firefox, fixtures

| | proton | protonWalk | protonGroup |
|---|---|---|---|
| Pages fully correct | 2/16 | 6/16 | 14/16 |
| Visible fields correct | 6/33 | 22/33 | 31/33 |
| Predictions on invisible fields | 0 | 0 | 0 |
| Median / max detection per page | 0.0 / 13.0 ms | 14.0 / 18.0 ms | 15.0 / 21.0 ms |
| … of which root walk, median / max | – | 0.0 / 1.0 ms | 0.0 / 1.0 ms |
| Roots with an input, median / max | – | 3 / 3 | 3 / 3 |
| Pages with an error | 0 | 0 | 0 |

## Per page (misses as `field truth→predicted`)

| Page | proton | protonWalk | protonGroup |
|---|---|---|---|
| fixture-nested-shadow | f0:0 username→none; f0:1 current-password→none (0.0 ms) | f0:0 username→none (16.0 ms, 3 roots) | ✓ (16.0 ms, 3 roots) |
| fixture-open-shadow | f0:0 username→none; f0:1 current-password→none (0.0 ms) | ✓ (14.0 ms, 2 roots) | ✓ (12.0 ms, 2 roots) |
| fixture-shadow-closed | f0:0 username→none; f0:1 current-password→none (0.0 ms) | ✓ (13.0 ms, 2 roots) | ✓ (20.0 ms, 2 roots) |
| fixture-shadow-closed-in-closed | f0:0 username→none; f0:1 current-password→none (1.0 ms) | f0:0 username→none (17.0 ms, 3 roots) | ✓ (15.0 ms, 3 roots) |
| fixture-shadow-closed-nested | f0:0 username→none; f0:1 current-password→none (0.0 ms) | f0:0 username→none (15.0 ms, 3 roots) | ✓ (16.0 ms, 3 roots) |
| fixture-shadow-control-signup-light | f0:0 signup-username→none (13.0 ms) | f0:0 signup-username→none (10.0 ms, 1 roots) | f0:0 signup-username→none (13.0 ms, 1 roots) |
| fixture-shadow-formless | f0:0 username→none; f0:1 current-password→none (0.0 ms) | ✓ (11.0 ms, 2 roots) | ✓ (12.0 ms, 2 roots) |
| fixture-shadow-negatives | ✓ (0.0 ms) | ✓ (12.0 ms, 3 roots) | ✓ (15.0 ms, 3 roots) |
| fixture-shadow-nested-form | f0:0 username→none; f0:1 current-password→none (0.0 ms) | f0:0 username→none (18.0 ms, 3 roots) | ✓ (15.0 ms, 3 roots) |
| fixture-shadow-otp | f0:0 otp→none (0.0 ms) | ✓ (14.0 ms, 2 roots) | ✓ (15.0 ms, 2 roots) |
| fixture-shadow-signup | f0:0 signup-username→none; f0:1 new-password→none; f0:2 new-password→none (0.0 ms) | f0:0 signup-username→none (12.0 ms, 2 roots) | f0:0 signup-username→none (11.0 ms, 2 roots) |
| fixture-shadow-slotted | ✓ (9.0 ms) | ✓ (11.0 ms, 1 roots) | ✓ (9.0 ms, 1 roots) |
| fixture-shadow-split-closed | f0:0 username→none; f0:1 current-password→none (1.0 ms) | f0:0 username→none (12.0 ms, 3 roots) | ✓ (15.0 ms, 3 roots) |
| fixture-shadow-split-form | f0:0 username→none; f0:1 current-password→none (0.0 ms) | f0:0 username→none (16.0 ms, 3 roots) | ✓ (21.0 ms, 3 roots) |
| fixture-shadow-split-mixed | f0:0 username→none; f0:1 current-password→none (11.0 ms) | f0:0 username→none; f0:1 current-password→none (16.0 ms, 2 roots) | ✓ (20.0 ms, 2 roots) |
| fixture-shadow-split-signup | f0:0 signup-username→none; f0:1 new-password→none (1.0 ms) | f0:0 signup-username→none (13.0 ms, 3 roots) | ✓ (14.0 ms, 3 roots) |
