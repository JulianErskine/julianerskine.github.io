# AGENTS.md

Guidance for AI coding agents working in this repo. Read this before making changes.

## What this is

Julian Erskine's personal site, source for `https://julianerskine.github.io/`.
Hand-written HTML/CSS, no JS framework, no package.json, no build tooling.

## Hosting model (important, easy to get wrong)

- Repo name `<user>.github.io` + branch `master` -> GitHub Pages serves the repo
  root directly. Push to `master` and the live site updates within a minute or two.
- There is **no** `_config.yml`, but there is also **no** `.nojekyll` file, so
  GitHub Pages still runs every page through Jekyll's default build before
  publishing. Consequences:
  - Any file/dir starting with `_` is excluded from the published output.
  - Front matter (`---\nkey: value\n---` at the top of a file) is processed.
    `404.html` relies on this (`layout: default`, `permalink: /404.html`).
  - Don't assume "it's just static files" — Liquid tags (`{{ }}`, `{% %}`) in
    `.html`/`.md` files will be evaluated at publish time even without a config.

## Structure

```
index.html, about/, cv/, projects/, projects/<Topic>/, publications/, teaching/
  -> one index.html per route, each a full HTML document
header.html, footer.html
  -> HTML *fragments* (no own <head>/<body> wrapper expectations), not full pages
css/main.css
  -> single shared stylesheet
images/, projects/videos/
  -> static media, linked directly
placeholder.html, 404.html
  -> placeholder/error pages
update_date.bash
  -> meant to stamp "Last modified" dates into pages from the last git commit;
     currently broken on Linux/CI (`sed -i ""` is macOS/BSD syntax, needs `sed -i`
     on GNU sed) and not wired into CI or a git hook — don't assume it runs
```

## How pages are assembled

Every page loads `header.html`/`footer.html` **at runtime in the browser** via a
hand-rolled `w3-include-html` attribute + `XMLHttpRequest` script duplicated in
every page (see bottom of any `index.html`). This means:

- `header.html`/`footer.html` must stay HTML fragments (no `<!DOCTYPE html>`,
  no wrapping `<html>`/`<body>`), since their content is dropped into
  `innerHTML` of a `<div>`. Note `header.html` currently includes an extra
  `<!DOCTYPE html>`/`<html>` wrapper — that's existing debt, not a pattern to copy.
- There's no server or build step doing the include, so `file://` previews
  requiring XHR of local files will fail in some browsers (fetch of `file://`
  from `file://` is blocked). Preview with a local HTTP server instead, e.g.:
  `python3 -m http.server` from the repo root.
- Paths to `header.html`/`footer.html` are relative and change per directory
  depth (`../header.html`, `../../header.html`, etc.) — when adding a new page,
  match the depth of its sibling pages.

## Conventions when adding pages

- Copy the structure of the nearest existing page at the same depth
  (e.g. a new project under `projects/<Name>/index.html` should mirror
  `projects/Swarms/index.html`), including the relative `../` paths and the
  `w3-include-html` include script block.
- Link `css/main.css` with the correct relative prefix for the page's depth.
- Keep new pages as plain HTML/CSS/vanilla JS unless asked to introduce a
  framework or build step — there is none today, don't silently add one.

## Keep README.md in sync

`README.md` is the human-facing quickstart; it must always reflect how to
build, lint, serve, and deploy the site locally — currently the `make build`
/ `make serve` / `make lint` / `make clean` targets and the "push to `master`
= deploy" model. Whenever you change the Makefile, CI workflow, Docker
images/commands, or the hosting/build model (e.g. adding `_config.yml`,
a `.nojekyll`, or a different deploy mechanism), update README.md's "Local
build & deployment" section in the same change. Don't leave it describing
tooling that no longer exists or omitting tooling that does.

## Checks before finishing

- No test suite. The closest thing to a check is HTML validity; CI
  (`.github/workflows/ci.yml`) runs `htmlhint` over the real page files
  (header.html/footer.html/404.html are intentionally excluded — see above).
- For behavioral/visual changes, serve the repo locally
  (`python3 -m http.server`) and load the affected page rather than opening
  the file directly, so the header/footer includes actually load.
