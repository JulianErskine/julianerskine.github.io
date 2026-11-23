# AGENTS.md

Rules and gotchas for AI coding agents working in this repo. Read this before
making changes. It deliberately doesn't describe the code: module details
live in each file's header comment, and an area's architecture lives in a
`README.md` next to its code (see "Where docs go").

## What this is

Julian Erskine's personal site, source for `https://julianerskine.github.io/`.
Built with [Eleventy](https://www.11ty.dev/) (11ty): Markdown/Nunjucks content,
no client framework. Content is intentionally a scaffold with placeholder
entries (projects, bio, CV) for now; the old hand-written-HTML site is gone
from the working tree but recoverable from git history.

## Hosting and deploy

- GitHub Pages' built-in Jekyll build is **not** used. `.github/workflows/ci.yml`
  builds and deploys, on push to `master` and on a `repository_dispatch`
  (`cv-released`) from the `julian-CV` repo. This needs the repo's
  **Settings > Pages > Source** set to "GitHub Actions", a one-time manual
  setting. If the live site isn't updating after a push, check that first.
- Keep upload and deploy in separate jobs. In one job, `deploy-pages` can
  list artifacts before the just-finalized upload is visible and fail with
  `No artifacts named "github-pages" were found` (actions/deploy-pages#451),
  and re-running that combined job uploads a second artifact, failing with
  `Multiple artifacts named "github-pages"`. With the split, a failed
  `deploy` job can safely be retried with "Re-run failed jobs". If `build`
  itself has to be re-run, push a new commit instead (even an empty one).
- The CV PDFs (`src/cv/*.pdf`) and `src/_data/cvRelease.json` are fetched at
  deploy time and gitignored. Never commit them. Locally they're missing:
  the `/cv/` preview and links 404 and there's no "Last updated" line. That's
  expected, not a bug. The pipeline and its secrets are described in
  README.md under "CV integration".
- Build, lint and serve all run in Docker (`node:20-alpine`) via the
  Makefile; no local Node install.

## Conventions

- New page: a `.njk` (or `.md`) file under `src/` with front matter
  `layout: base.njk` and a `title`. Eleventy derives the URL from the path
  (`src/foo/index.njk` -> `/foo/`).
- New project: add `src/projects/<slug>.md` with front matter `title`,
  `summary`, `tags` (list), `date`. The `projects` collection
  (`.eleventy.js`) picks it up and lists it on `/projects/`, newest first.
  Don't hand-edit the listing page.
- Site-wide nav and social links live in `src/_data/site.json`, not in
  templates.
- Plain Eleventy and vanilla JS for interactive demos. Add a library only
  when a demo genuinely needs one; don't add React and the like "just in
  case". No bundler: scripts under `src/js/` are served as written, as ES
  modules.
- three.js (used by the lander) is an npm dependency. `.eleventy.js` copies
  its ES module build and the few add-ons in use into `/js/vendor/three/`,
  and the page's import map points `three` and `three/addons/` there. Using
  another add-on means adding it, and anything it imports, to that copy
  list.
- Lander (`/simulator/`, code in `src/js/lander/`): read
  `src/js/lander/README.md` before changing it. Its "Rules that span modules"
  are binding: gameplay only in `sim.js`, visuals never feed back, and
  seeded, fixed-step simulation so rounds stay reproducible.

## Where docs go

- A module's purpose and its non-obvious details: its header comment.
- How an area's modules fit together, and rules that span them: a
  `README.md` in that area's code folder (e.g. `src/js/lander/README.md`).
  `.eleventyignore` keeps `src/**/README.md` from becoming a page, and
  `src/js/` is copied to the site as `*.js` only, so these never ship.
- How to build, run, deploy, and operate the site, for humans: `README.md`.
- This file: only rules and gotchas an agent would otherwise get wrong.

## Checks before finishing

- `make lint` builds the site and lints the generated HTML with `htmlhint`.
  CI's `check` job runs the same thing.
- For visual or behavioral changes (especially the simulator), look at the
  result in a browser: `make serve`, then `http://localhost:8080/...`.
  Don't just trust that the build succeeded.

## Keep README.md in sync

`README.md` is the human-facing guide. It must always say how to build,
lint, serve and deploy the site (the `make` targets, and "push to `master`
deploys via GitHub Actions") and how the CV pipeline works. Whenever you
change the Makefile, the CI workflow, Docker images or commands, the
hosting/build model, or the CV flow, update README.md in the same change.
