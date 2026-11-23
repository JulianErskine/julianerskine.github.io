# julianerskine.github.io

My personal website, built with [Eleventy](https://www.11ty.dev/) and
published via GitHub Pages. Currently a scaffold with placeholder content —
real projects/bio/CV to follow.

## View the site

https://julianerskine.github.io/

Deploys on push to `master`, and on a `repository_dispatch` fired by the
[julian-CV](https://github.com/JulianErskine/julian-CV) repo whenever a new
CV release is published (see "CV integration" below). Both are built and
deployed by `.github/workflows/ci.yml` (GitHub Actions, not GitHub Pages'
built-in Jekyll build: Eleventy needs an Actions build). Updates within a
minute or two.

## Local build & deployment

Everything runs through Docker, so no local Node install is required:

| Command | What it does |
|---|---|
| `make build` | Builds the site with Eleventy into `_site/` |
| `make serve` | Serves the site locally at http://localhost:8080, rebuilding on file changes |
| `make lint` | Builds the site, then lints the generated HTML with `htmlhint` (CI runs this) |
| `make test` | Runs the test suite in `test/` (CI runs this too): the simulator's physics and rules, the autopilots, the MPC's wasm, the 3D terrain's guarantees, and that the built site contains everything its pages load |
| `make clean` | Removes `_site/` and `node_modules/` |
| `make mpc` | Regenerates the simulator's MPC autopilot with acados and recompiles it to WebAssembly ([details](tools/lander-mpc/README.md)). Only needed after changing it; the output is committed |

`build`, `serve`, `lint` and `test` run `npm ci` first. Besides Eleventy that installs
[three.js](https://threejs.org/), which the `/simulator/` page loads as plain
ES modules: Eleventy copies it into `_site/js/vendor/three/`, no bundler.

"Deployment" itself is just `git push` to `master`: GitHub Actions builds
and publishes it automatically; there's no separate deploy command. See
`.github/workflows/ci.yml` for exactly what runs on every push/PR.

## Layout

| Path | What |
|---|---|
| `.eleventy.js` | Eleventy config: `src/` -> `_site/`, passthrough copies, the projects collection |
| `src/_includes/base.njk` | The one shared layout (header, nav, footer) |
| `src/_data/site.json` | Site name, nav links, social links |
| `src/index.njk`, `src/404.njk` | Home page, 404 page |
| `src/projects/` | Projects listing and one Markdown file per project |
| `src/cv/index.njk` | CV page (the PDFs arrive at deploy time; see below) |
| `src/simulator/index.njk` + `src/js/lander/` | The lunar lander simulator; [its README](src/js/lander/README.md) explains how it works |
| `tools/lander-mpc/` | acados + Emscripten toolchain for the simulator's MPC autopilot (`make mpc`) |
| `src/backend-demo/index.njk` + `src/js/backend-demo.js` | Page that `fetch()`es the separate [site-api](https://github.com/JulianErskine/site-api) backend |
| `src/css/style.css` | The one stylesheet |
| `test/` | The test suite (`make test`), one `*.test.mjs` per area |

## Adding content

- New project: add a Markdown file under `src/projects/` (see the existing
  ones for the front matter shape). Shows up on `/projects/` automatically.
- New page: add a `.njk`/`.md` file under `src/` with `layout: base.njk` in
  its front matter.

## CV integration

The CV is maintained in a separate private repo, `JulianErskine/julian-CV`
(LaTeX, with its own Docker/Make build).

1. Pushing a `v*` tag there runs `julian-CV/.github/workflows/release.yml`.
   It publishes `erskine-cv-{en,fr}-public.pdf` (among others) as GitHub
   Release assets, then fires a `repository_dispatch` (`cv-released`) at
   this repo.
2. This repo's `build` job (`.github/workflows/ci.yml`) runs on that
   dispatch, or on a normal push to `master`. It resolves the latest release
   tag, writes its `tagName`/`publishedAt` to `src/_data/cvRelease.json`,
   downloads `erskine-cv-{en,fr}-public.pdf` into `src/cv/` as
   `public_cv-en.pdf`/`public_cv-fr.pdf`, then builds and deploys.
3. `.eleventy.js` passthrough-copies `src/cv/*.pdf`. `src/cv/index.njk`
   links to them by those fixed names, embeds one in an `<iframe>` preview
   (the Preview/Aperçu links retarget it, no JS), and shows the
   `cvRelease` date and tag as "Last updated" when that data file exists.

It depends on two secrets:

- `CV_REPO_TOKEN`, in **this** repo: a PAT with read access to `julian-CV`.
  That repo is private, so even its release assets need auth; plain
  unauthenticated `curl`/`actions/download-artifact` will 404.
- `SITE_DISPATCH_TOKEN`, in `julian-CV`'s secrets: a PAT with `dispatches`
  access to this (public) repo, used by its release workflow.

The PDFs and `cvRelease.json` are never committed (both gitignored); they're
always fetched fresh at deploy time. A local `make build`/`make serve` won't
have them: the preview and links 404 and there's no "Last updated" line.
That's expected.
