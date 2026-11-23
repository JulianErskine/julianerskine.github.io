// The built site: everything the pages load must actually be in it. Builds
// with Eleventy into a temporary directory (the real _site is left alone).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const repo = path.resolve(import.meta.dirname, "..");
let out;

before(() => {
  out = mkdtempSync(path.join(tmpdir(), "site-test-"));
  execFileSync("npx", ["@11ty/eleventy", `--output=${out}`, "--quiet"], { cwd: repo, stdio: "pipe" });
});

after(() => rmSync(out, { recursive: true, force: true }));

const read = (url) => readFileSync(path.join(out, url), "utf8");

/**
 * Every module reachable from `entry` (a site URL), resolving through
 * `importMap`, and every .wasm those modules load.
 */
function moduleGraph(entry, importMap) {
  const seen = new Set();
  const wasms = new Set();
  const missing = [];
  const queue = [entry];
  while (queue.length) {
    const url = queue.pop();
    if (seen.has(url)) continue;
    seen.add(url);
    if (!existsSync(path.join(out, url))) {
      missing.push(url);
      continue;
    }
    const source = read(url);
    const specifiers = [
      ...source.matchAll(/(?:^|[\s;}])(?:import|export)\s[^'"]*?from\s*["']([^"']+)["']/g),
      ...source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g),
    ].map((m) => m[1]);
    for (const spec of specifiers) {
      // Node built-ins: Emscripten's loader only imports them when run in Node.
      if (spec.startsWith("node:")) continue;
      let target;
      if (spec.startsWith(".") || spec.startsWith("/")) {
        target = new URL(spec, `http://site${url}`).pathname;
      } else {
        const key = Object.keys(importMap).filter((k) => spec === k || (k.endsWith("/") && spec.startsWith(k))).sort((a, b) => b.length - a.length)[0];
        assert.ok(key, `${url} imports "${spec}", which the import map doesn't resolve`);
        target = importMap[key] + spec.slice(key.length);
      }
      queue.push(target);
    }
    // Emscripten finds its .wasm next to the glue: new URL('x.wasm', import.meta.url).
    for (const m of source.matchAll(/new URL\(\s*["']([^"']+\.wasm)["']\s*,\s*import\.meta\.url\s*\)/g)) {
      const wasm = new URL(m[1], `http://site${url}`).pathname;
      wasms.add(wasm);
      if (!existsSync(path.join(out, wasm))) missing.push(wasm);
    }
  }
  return { modules: seen, wasms, missing };
}

test("every page links only to stylesheets and scripts that exist", () => {
  for (const page of ["index.html", "simulator/index.html", "projects/index.html", "cv/index.html", "404.html"]) {
    const html = read(page);
    for (const [, url] of html.matchAll(/<(?:script|link)[^>]+(?:src|href)="(\/[^"]+\.(?:js|css))"/g)) {
      assert.ok(existsSync(path.join(out, url)), `${page} references ${url}, which isn't built`);
    }
  }
});

test("the simulator's whole module graph is in the site, three.js and the MPC's wasm included", () => {
  const html = read("simulator/index.html");
  const mapJson = html.match(/<script type="importmap">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(mapJson, "simulator page has no import map");
  const { imports } = JSON.parse(mapJson);
  const entry = html.match(/<script type="module" src="([^"]+)"/)?.[1];
  assert.ok(entry, "simulator page has no module entry");
  const { modules, wasms, missing } = moduleGraph(entry, imports);
  assert.deepEqual(missing, [], "referenced but not built");
  for (const expected of ["/js/lander/autopilot_mpc.js", "/js/lander/mpc/lander_mpc.js", "/js/vendor/three/three.core.js"]) {
    assert.ok(modules.has(expected), `${expected} isn't reachable from ${entry}; did the crawl break?`);
  }
  assert.ok(wasms.has("/js/lander/mpc/lander_mpc.wasm"), "the MPC's .wasm reference wasn't found; did the crawl break?");
});

test("developer docs next to the code don't ship", () => {
  const found = execFileSync("find", [out, "-iname", "readme*"], { encoding: "utf8" }).trim();
  assert.equal(found, "", `shipped: ${found}`);
});
