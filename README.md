# julianerskine.github.io

My personal website, published via GitHub Pages.

## View the site

https://julianerskine.github.io/

This repo publishes directly from the `master` branch root. GitHub Pages
builds it with its default Jekyll pipeline (no `_config.yml` needed, and
there's no `.nojekyll` file disabling that). Pushing to `master` updates the
live site within a minute or two.

## Local build & deployment

Everything runs through Docker, so no local Ruby/Jekyll/Node install is
required:

| Command | What it does |
|---|---|
| `make build` | Builds the site with Jekyll into `_site/`, the same way GitHub Pages does |
| `make serve` | Serves the site locally at http://localhost:4000, rebuilding on file changes |
| `make lint` | Lints the HTML pages with `htmlhint` (same check CI runs) |
| `make clean` | Removes the `_site/` build output |

"Deployment" itself is just `git push` to `master` — GitHub Pages picks it up
automatically; there's no separate deploy command or hosting account to
configure. See `AGENTS.md` for the hosting/build model in more detail, and
`.github/workflows/ci.yml` for what CI checks on every push/PR.
