# Everything here runs through Docker, so no local Node install is required.

NODE_IMAGE := node:20-alpine
PORT       ?= 8080

.PHONY: help install build serve lint clean

help:
	@echo "make build   - build the site with Eleventy into _site/ (Docker)"
	@echo "make serve   - serve the site locally at http://localhost:$(PORT), rebuilding on change (Docker)"
	@echo "make lint    - build the site, then lint the generated HTML with htmlhint (Docker)"
	@echo "make clean   - remove _site/ and node_modules/"

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

clean:
	docker run --rm -v "$(CURDIR)":/work -w /work $(NODE_IMAGE) rm -rf _site node_modules
