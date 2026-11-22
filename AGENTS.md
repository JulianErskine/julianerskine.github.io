# AGENTS.md

Guidance for AI coding agents working in this repo. Read this before making changes.

## What this is

Julian Erskine's personal site, source for `https://julianerskine.github.io/`.
Built with [Eleventy](https://www.11ty.dev/) (11ty) — Markdown/Nunjucks content,
no client framework. Content is intentionally a scaffold with placeholder
entries (projects, bio, CV) for now; the old hand-written-HTML version of this
site is gone from the working tree but fully recoverable from git history if
anything from it is ever needed.

## Hosting model (important, different from before)

- GitHub Pages' built-in Jekyll build is **not** used anymore (Eleventy isn't
  a generator Pages builds natively). The site is built and deployed by
  `.github/workflows/ci.yml`, on push to `master` and on a
  `repository_dispatch` (`cv-released`) fired by the `julian-CV` repo's
  release workflow, via `actions/upload-pages-artifact` + `actions/deploy-pages`.
- This requires the repo's **Settings > Pages > Source** to be set to
  "GitHub Actions" (not "Deploy from a branch"). That's a one-time manual
  setting in the GitHub UI — if the live site isn't updating after a push,
  check that first.
- Local build/lint/serve all run in Docker (`node:20-alpine`), no local Node
  install required. See the Makefile.
- If `deploy` fails with `actions/deploy-pages`: `Error: Multiple artifacts
  named "github-pages" were unexpectedly found` — don't click "Re-run failed
  jobs". `upload-pages-artifact` doesn't clean up a previous attempt's
  artifact, so re-running the job uploads a second one with the same name
  and `deploy-pages` can't pick between them. Push a new commit instead (even
  an empty one) to get a clean run with no leftover artifacts.

## Structure

```
package.json, .eleventy.js      -> Eleventy config: input src/, output _site/,
                                    passthrough copies, projects collection
src/_includes/base.njk          -> the one shared layout (header/nav/footer)
src/_data/site.json             -> site name, nav links, social links
src/index.njk                   -> home/about page
src/projects/index.njk          -> listing page, reads collections.projects
src/projects/*.md               -> one file per project (front matter: title,
                                    summary, tags, date); adding a project is
                                    just adding a file here, nothing else
src/simulator/index.njk + src/js/simulator.js
                                 -> small interactive canvas demo (lander
                                    game); first of presumably more "fun
                                    little simulator" pages
src/cv/index.njk                -> links to the CV PDFs; the files themselves
                                    are fetched at deploy time, not committed
                                    (see "CV integration" below)
src/css/style.css                -> single shared stylesheet
src/images/                      -> static images (passthrough-copied)
src/404.njk                      -> custom 404 page (permalink: /404.html)
```

## Conventions

- New page: a `.njk` (or `.md`) file under `src/` with front matter
  `layout: base.njk` and a `title`. Eleventy derives the URL from the file
  path (`src/foo/index.njk` -> `/foo/`).
- New project: add `src/projects/<slug>.md` with front matter `title`,
  `summary`, `tags` (list), `date`. It's picked up automatically by the
  `projects` collection (`.eleventy.js`) and shown on `/projects/`, sorted
  newest-first by `date`. Don't hand-edit the listing page for this.
- Site-wide nav/social links live in `src/_data/site.json`, not hardcoded in
  templates.
- Keep using plain Eleventy + vanilla JS/canvas for interactive demos unless
  a specific demo genuinely needs a framework — don't add React/etc. "just in
  case."

## CV integration

The CV is maintained in a separate private repo, `JulianErskine/julian-CV`
(LaTeX, built via its own Docker/Make setup — not this repo's concern).
Flow:

1. Pushing a `v*` tag there runs `julian-CV/.github/workflows/release.yml`:
   builds `current-cv-{en,fr}.pdf` plus phone-less
   `current-cv-{en,fr}-nophone.pdf`, publishes them all as GitHub Release
   assets, then fires a `repository_dispatch` (`cv-released`) at this repo.
2. This repo's `deploy` job (`.github/workflows/ci.yml`) reacts to that
   dispatch (or a normal push to `master`): resolves the latest release tag,
   writes its `tagName`/`publishedAt` to `src/_data/cvRelease.json`, and
   downloads only that release's `*-nophone` PDFs via `gh release download`
   into `src/cv/`, renamed to `public_cv-en.pdf`/`public_cv-fr.pdf`, then
   builds and deploys. The full-contact PDFs are never published on the site.
3. `.eleventy.js` passthrough-copies `src/cv/*.pdf`; `src/cv/index.njk`
   links to them by that fixed filename, embeds one in an `<iframe>` preview
   (the Preview/Aperçu links retarget it, no JS), and shows the
   `cvRelease` date/tag as "Last updated" when that data file exists.

Two secrets this depends on, both in **this** repo's Settings > Secrets:
- `CV_REPO_TOKEN`: a PAT with read access to `julian-CV` (it's private, so
  even its release assets need auth to download — plain unauthenticated
  `curl`/`actions/download-artifact` will 404).
- (In `julian-CV`'s secrets, not here) `SITE_DISPATCH_TOKEN`: a PAT with
  `dispatches` access to this (public) repo, used by its release workflow.

The PDFs and `cvRelease.json` are never committed here (both gitignored) —
always fetched fresh at deploy time. Local `make build`/`make serve` won't
have them (preview and links 404 locally, no "Last updated" line); that's
expected, not a bug.

## Checks before finishing

- `make lint` builds the site and lints the generated HTML with `htmlhint`
  (Docker, no local Node needed). This is also what CI's `check` job runs.
- For visual/behavioral changes (especially the simulator), build and look:
  `make build && (cd _site && python3 -m http.server 8080)`, then open
  `http://localhost:8080/...` in a real browser — don't just trust that the
  build succeeded.

## Keep README.md in sync

`README.md` is the human-facing quickstart; it must always reflect how to
build, lint, serve, and deploy the site locally — currently the `make build`
/ `make serve` / `make lint` / `make clean` targets and the "push to `master`
= deploy via GitHub Actions" model. Whenever you change the Makefile, CI
workflow, Docker images/commands, or the hosting/build model, update
README.md's "Local build & deployment" section in the same change. Don't
leave it describing tooling that no longer exists or omitting tooling that
does.
