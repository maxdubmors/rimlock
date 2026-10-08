# Shadow-root check: chrome, live

| | proton | protonWalk | protonGroup |
|---|---|---|---|
| Pages fully correct | 43/51 | 44/51 | 45/51 |
| Visible fields correct | 78/88 | 80/88 | 82/88 |
| Predictions on invisible fields | 1 | 1 | 1 |
| Median / max detection per page | 19.4 / 28.9 ms | 18.3 / 29.1 ms | 18.8 / 33.4 ms |
| … of which root walk, median / max | – | 0.9 / 4.5 ms | 0.8 / 4.7 ms |
| Roots with an input, median / max | – | 1 / 6 | 1 / 6 |
| Pages with an error | 0 | 0 | 0 |

Not compared (visible fields differed between loads): cloudflare-login, github-reset, gosuslugi-login, stackoverflow-login

## Per page (misses as `field truth→predicted`)

| Page | proton | protonWalk | protonGroup |
|---|---|---|---|
| amazon-login | ✓ (16.8 ms) | ✓ (20.1 ms, 1 roots) | ✓ (23.6 ms, 1 roots) |
| apple-login | f2:1 current-password→none (21.3 ms) | f2:1 current-password→none (20.3 ms, 2 roots) | f2:1 current-password→none (32.1 ms, 2 roots) |
| archive-org-home | ✓ (0.5 ms) | ✓ (29.1 ms, 6 roots) | ✓ (28.6 ms, 6 roots) |
| archive-org-login | f0:3 username→none; f0:4 current-password→none (0.4 ms) | ✓ (25.2 ms, 5 roots) | ✓ (33.4 ms, 5 roots) |
| atlassian-login | ✓ (15.9 ms) | ✓ (15.2 ms, 1 roots) | ✓ (16.0 ms, 1 roots) |
| bitbucket-login | ✓ (15.5 ms) | ✓ (20.1 ms, 1 roots) | ✓ (15.8 ms, 1 roots) |
| booking-signin | ✓ (15.8 ms) | ✓ (16.0 ms, 1 roots) | ✓ (20.3 ms, 1 roots) |
| codeberg-login | ✓ (21.3 ms) | ✓ (18.9 ms, 1 roots) | ✓ (20.0 ms, 1 roots) |
| codeberg-signup | ✓ (25.0 ms) | ✓ (21.1 ms, 1 roots) | ✓ (21.8 ms, 1 roots) |
| digitalocean-login | ✓ (18.5 ms) | ✓ (24.2 ms, 1 roots) | ✓ (22.1 ms, 1 roots) |
| dockerhub-login | ✓ (16.9 ms) | ✓ (19.2 ms, 1 roots) | ✓ (17.7 ms, 1 roots) |
| dropbox-login | ✓ (14.9 ms) | ✓ (5.9 ms, 1 roots) | ✓ (4.7 ms, 1 roots) |
| dropbox-register | ✓ (17.4 ms) | ✓ (5.0 ms, 1 roots) | ✓ (5.8 ms, 1 roots) |
| epicgames-login | ✓ (25.0 ms) | ✓ (18.1 ms, 1 roots) | ✓ (17.1 ms, 1 roots) |
| figma-login | ✓ (15.6 ms) | ✓ (23.7 ms, 1 roots) | ✓ (20.3 ms, 1 roots) |
| github-login | ✓ (22.2 ms) | ✓ (19.9 ms, 1 roots) | ✓ (20.3 ms, 1 roots) |
| github-search | ✓ (15.9 ms) | ✓ (17.6 ms, 1 roots) | ✓ (17.5 ms, 1 roots) |
| google-login | ✓ (23.9 ms) | ✓ (22.6 ms, 1 roots) | ✓ (28.5 ms, 1 roots) |
| hackernews-home | ✓ (20.2 ms) | ✓ (18.1 ms, 1 roots) | ✓ (23.5 ms, 1 roots) |
| hackernews-login | ✓ (28.0 ms) | ✓ (19.5 ms, 1 roots) | ✓ (19.8 ms, 1 roots) |
| heroku-login | ✓ (20.5 ms) | ✓ (25.2 ms, 1 roots) | ✓ (19.1 ms, 1 roots) |
| kaggle-login | ✓ (22.7 ms) | ✓ (18.8 ms, 1 roots) | ✓ (29.4 ms, 1 roots) |
| lichess-login | ✓ (23.4 ms) | ✓ (5.6 ms, 1 roots) | ✓ (6.1 ms, 1 roots) |
| mailru-login | ✓ (19.4 ms) | ✓ (16.5 ms, 1 roots) | ✓ (17.3 ms, 1 roots) |
| mastodon-login | ✓ (20.6 ms) | ✓ (18.7 ms, 1 roots) | ✓ (18.2 ms, 1 roots) |
| microsoft-login | ✓ (14.1 ms) | ✓ (18.0 ms, 1 roots) | ✓ (15.0 ms, 1 roots) |
| microsoft-login-step2 | ✓ (19.8 ms) | ✓ (23.0 ms, 1 roots) | ✓ (19.4 ms, 1 roots) |
| netflix-login | f0:1 current-password→none (16.0 ms) | f0:1 current-password→none (18.1 ms, 1 roots) | f0:1 current-password→none (18.3 ms, 1 roots) |
| notion-login | ✓ (14.5 ms) | ✓ (13.3 ms, 1 roots) | ✓ (13.8 ms, 1 roots) |
| npm-login | ✓ (21.9 ms) | ✓ (19.0 ms, 1 roots) | ✓ (18.8 ms, 1 roots) |
| openstreetmap-home | ✓ (20.1 ms) | ✓ (9.3 ms, 1 roots) | ✓ (5.0 ms, 1 roots) |
| openstreetmap-login | ✓ (19.6 ms) | ✓ (10.2 ms, 1 roots) | ✓ (6.4 ms, 1 roots) |
| openstreetmap-signup | f0:1 signup-username→none (26.9 ms) | f0:1 signup-username→none (11.6 ms, 1 roots) | f0:1 signup-username→none (9.0 ms, 1 roots) |
| pinterest-login | ✓ (20.5 ms) | ✓ (18.3 ms, 1 roots) | ✓ (16.8 ms, 1 roots) |
| python-newsletter | ✓ (14.5 ms) | ✓ (21.2 ms, 1 roots) | ✓ (19.7 ms, 1 roots) |
| reddit-login | f0:0 username→none; f0:1 current-password→none (0.7 ms) | f0:0 username→none; f0:1 current-password→none (11.1 ms, 5 roots) | ✓ (21.5 ms, 5 roots) |
| reddit-register | f0:0 signup-username→none (0.8 ms) | f0:0 signup-username→none (12.8 ms, 5 roots) | f0:0 signup-username→none (18.5 ms, 5 roots) |
| slack-signin | ✓ (18.7 ms) | ✓ (5.3 ms, 1 roots) | ✓ (6.9 ms, 1 roots) |
| spotify-login | f0:0 username→signup-username (16.1 ms) | f0:0 username→signup-username (16.8 ms, 1 roots) | f0:0 username→signup-username (17.5 ms, 1 roots) |
| steam-login | ✓ (19.4 ms) | ✓ (23.1 ms, 1 roots) | ✓ (20.3 ms, 1 roots) |
| trello-login | ✓ (15.6 ms) | ✓ (16.7 ms, 1 roots) | ✓ (16.1 ms, 1 roots) |
| tumblr-login | ✓ (24.2 ms) | ✓ (22.4 ms, 1 roots) | ✓ (23.6 ms, 1 roots) |
| twitch-login | ✓ (28.9 ms) | ✓ (25.4 ms, 1 roots) | ✓ (20.4 ms, 1 roots) |
| vk-login | ✓ (13.9 ms) | ✓ (13.5 ms, 1 roots) | ✓ (15.3 ms, 1 roots) |
| wikipedia-home | ✓ (17.1 ms) | ✓ (24.0 ms, 1 roots) | ✓ (21.0 ms, 1 roots) |
| wikipedia-login | ✓ (22.1 ms) | ✓ (27.9 ms, 1 roots) | ✓ (24.3 ms, 1 roots) |
| wikipedia-signup | f0:4 none→signup-username (21.3 ms) | f0:4 none→signup-username (23.1 ms, 1 roots) | f0:4 none→signup-username (23.4 ms, 1 roots) |
| x-login | ✓ (19.6 ms) | ✓ (7.9 ms, 1 roots) | ✓ (9.5 ms, 1 roots) |
| yahoo-login | ✓ (20.0 ms) | ✓ (17.1 ms, 1 roots) | ✓ (16.5 ms, 1 roots) |
| yandex-passport | ✓ (16.8 ms) | ✓ (16.9 ms, 1 roots) | ✓ (21.4 ms, 1 roots) |
| zoom-signin | ✓ (26.1 ms) | ✓ (18.1 ms, 1 roots) | ✓ (17.9 ms, 1 roots) |
