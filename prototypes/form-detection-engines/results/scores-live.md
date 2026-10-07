# Scores (live)

| | bitwarden | proton |
|---|---|---|
| Pages fully correct | 45/55 (82%) | 46/55 (84%) |
| … multistep | 15/17 | 17/17 |
| … login | 24/26 | 21/26 |
| … negative | 5/7 | 6/7 |
| … signup | 1/5 | 2/5 |
| Visible fields correct | 84/96 (88%) | 85/96 (89%) |
| username: P / R / F1 | 86% / 93% / 0.89 (n=41) | 97% / 93% / 0.95 (n=41) |
| current-password: P / R / F1 | 92% / 100% / 0.96 (n=24) | 100% / 83% / 0.91 (n=24) |
| new-password: P / R / F1 | 100% / 86% / 0.92 (n=7) | 100% / 100% / 1.00 (n=7) |
| signup-username: P / R / F1 | 80% / 50% / 0.62 (n=8) | 75% / 75% / 0.75 (n=8) |
| otp: P / R / F1 | – / – / 0.00 (n=0) | – / – / 0.00 (n=0) |
| Predictions on invisible fields | 20 | 1 |
| Median detection time per page | 5.3 ms | 18.1 ms |
| Max detection time per page | 11 ms | 31 ms |
| Pages where the engine threw | 0 | 0 |

## Per page (misses as `field truth→predicted`)

| Page | bitwarden | proton |
|---|---|---|
| apple-login | ✓ | f2:1 current-password→none |
| archive-org-login | ✓ | f0:3 username→none; f0:4 current-password→none |
| cloudflare-login | ✓ | ✓ |
| codeberg-login | ✓ | ✓ |
| digitalocean-login | ✓ | ✓ |
| epicgames-login | ✓ | ✓ |
| figma-login | ✓ | ✓ |
| github-login | ✓ | ✓ |
| gosuslugi-login | ✓ | ✓ |
| hackernews-login | f0:0 username→none | ✓ |
| heroku-login | ✓ | ✓ |
| kaggle-login | ✓ | ✓ |
| lichess-login | ✓ | ✓ |
| mastodon-login | ✓ | ✓ |
| netflix-login | ✓ | f0:1 current-password→none |
| npm-login | ✓ | ✓ |
| openstreetmap-login | ✓ | ✓ |
| pinterest-login | ✓ | ✓ |
| reddit-login | ✓ | f0:0 username→none; f0:1 current-password→none |
| spotify-login | ✓ | f0:0 username→signup-username |
| stackoverflow-login | ✓ | ✓ |
| steam-login | f0:1 username→none | ✓ |
| tumblr-login | ✓ | ✓ |
| twitch-login | ✓ | ✓ |
| vk-login | ✓ | ✓ |
| wikipedia-login | ✓ | ✓ |
| amazon-login | ✓ | ✓ |
| atlassian-login | ✓ | ✓ |
| bitbucket-login | ✓ | ✓ |
| booking-signin | f0:0 none→current-password | ✓ |
| dockerhub-login | ✓ | ✓ |
| dropbox-login | ✓ | ✓ |
| google-login | ✓ | ✓ |
| mailru-login | ✓ | ✓ |
| microsoft-login | ✓ | ✓ |
| microsoft-login-step2 | ✓ | ✓ |
| notion-login | ✓ | ✓ |
| slack-signin | ✓ | ✓ |
| trello-login | ✓ | ✓ |
| x-login | ✓ | ✓ |
| yahoo-login | ✓ | ✓ |
| yandex-passport | f0:0 username→none | ✓ |
| zoom-signin | ✓ | ✓ |
| archive-org-home | ✓ | ✓ |
| github-reset | f0:0 none→username | f0:0 none→username |
| github-search | ✓ | ✓ |
| hackernews-home | f0:0 none→username | ✓ |
| openstreetmap-home | ✓ | ✓ |
| python-newsletter | ✓ | ✓ |
| wikipedia-home | ✓ | ✓ |
| codeberg-signup | ✓ | ✓ |
| dropbox-register | f0:0 signup-username→username | ✓ |
| openstreetmap-signup | f0:0 signup-username→username; f0:1 signup-username→username; f0:2 new-password→current-password | f0:1 signup-username→none |
| reddit-register | f0:0 signup-username→username | f0:0 signup-username→none |
| wikipedia-signup | f0:4 none→signup-username | f0:4 none→signup-username |
