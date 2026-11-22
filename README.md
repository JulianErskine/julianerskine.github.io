# julianerskine.github.io

My personal website, built with [Eleventy](https://www.11ty.dev/) and
published via GitHub Pages. Currently a scaffold with placeholder content —
real projects/bio/CV to follow.

## View the site

https://julianerskine.github.io/

Deploys on push to `master`, and on a `repository_dispatch` fired by the
[julian-CV](https://github.com/JulianErskine/julian-CV) repo whenever a new
CV release is published — see `AGENTS.md`'s "CV integration" for the full
flow. Both are built and deployed by `.github/workflows/ci.yml` (GitHub
Actions, not GitHub Pages' built-in Jekyll build — Eleventy needs an Actions
build). Updates within a minute or two.

## Local build & deployment

Everything runs through Docker, so no local Node install is required:

| Command | What it does |
|---|---|
| `make build` | Builds the site with Eleventy into `_site/` |
| `make serve` | Serves the site locally at http://localhost:8080, rebuilding on file changes |
| `make lint` | Builds the site, then lints the generated HTML with `htmlhint` (same check CI runs) |
| `make clean` | Removes `_site/` and `node_modules/` |

"Deployment" itself is just `git push` to `master` — GitHub Actions builds
and publishes it automatically; there's no separate deploy command. See
`AGENTS.md` for the project structure/conventions in detail, and
`.github/workflows/ci.yml` for exactly what runs on every push/PR.

## Adding content

- New project: add a Markdown file under `src/projects/` (see the existing
  ones for the front matter shape). Shows up on `/projects/` automatically.
- New page: add a `.njk`/`.md` file under `src/` with `layout: base.njk` in
  its front matter.
