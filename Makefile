# Everything here runs through Docker, so no local Node install is required.

NODE_IMAGE := node:20-alpine
MPC_IMAGE  := lander-mpc-toolchain
PORT       ?= 8080

.PHONY: help install build serve lint test clean mpc

help:
	@echo "make build   - build the site with Eleventy into _site/ (Docker)"
	@echo "make serve   - serve the site locally at http://localhost:$(PORT), rebuilding on change (Docker)"
	@echo "make lint    - build the site, then lint the generated HTML with htmlhint (Docker)"
	@echo "make test    - run the test suite (Docker)"
	@echo "make clean   - remove _site/ and node_modules/"
	@echo "make mpc     - regenerate the lander's acados MPC and its wasm build (Docker; slow the first time)"

install:
	docker run --rm -v "$(CURDIR)":/work -w /work $(NODE_IMAGE) npm ci

build: install
	docker run --rm -v "$(CURDIR)":/work -w /work $(NODE_IMAGE) npx eleventy

serve: install
	docker run --rm -v "$(CURDIR)":/work -w /work -p $(PORT):$(PORT) $(NODE_IMAGE) \
		npx eleventy --serve --port=$(PORT) --watch

lint: build
	docker run --rm -v "$(CURDIR)":/work -w /work $(NODE_IMAGE) \
		npx --yes htmlhint "_site/**/*.html" --format=compact

# test/*.test.mjs with Node's built-in runner. The src/ modules are ES
# modules in a package without "type": "module" (.eleventy.js is CommonJS),
# so Node detects their syntax and warns each time; that warning is noise.
test: install
	docker run --rm -v "$(CURDIR)":/work -w /work $(NODE_IMAGE) \
		node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test test/

clean:
	docker run --rm -v "$(CURDIR)":/work -w /work $(NODE_IMAGE) rm -rf _site node_modules

# The lander's MPC: acados generates the C solver from tools/lander-mpc/ocp.py,
# Emscripten compiles it to src/js/lander/mpc/ (committed, so plain builds and
# CI never need this toolchain).
mpc:
	docker build -t $(MPC_IMAGE) tools/lander-mpc
	docker run --rm -v "$(CURDIR)":/work -w /work -e HOST_UID=$$(id -u) -e HOST_GID=$$(id -g) \
		$(MPC_IMAGE) sh tools/lander-mpc/build.sh
