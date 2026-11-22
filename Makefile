# Everything here runs through Docker, so no local Ruby/Jekyll/Node install
# is required. Matches what GitHub Pages actually does: builds the site with
# Jekyll (see AGENTS.md) and lints the same HTML pages CI checks.

JEKYLL_IMAGE := jekyll/jekyll:latest
NODE_IMAGE   := node:20-alpine
PORT         ?= 4000

# Keep in sync with .github/workflows/ci.yml. header.html/footer.html are
# JS-included fragments and 404.html carries Jekyll front matter, so none of
# the three are valid standalone HTML documents; excluded on purpose.
HTML_PAGES := index.html \
	placeholder.html \
	about/index.html \
	cv/index.html \
	projects/index.html \
	"projects/*/index.html" \
	publications/index.html \
	teaching/index.html

.PHONY: help build serve lint clean

help:
	@echo "make build  - build the site with Jekyll into _site/ (Docker), as GitHub Pages would"
	@echo "make serve  - serve the site locally at http://localhost:$(PORT) with live rebuild on change (Docker)"
	@echo "make lint   - lint HTML pages with htmlhint (Docker), same check CI runs"
	@echo "make clean  - remove the _site/ build output"

build:
	docker run --rm -v "$(CURDIR)":/srv/jekyll -w /srv/jekyll $(JEKYLL_IMAGE) \
		jekyll build

serve:
	docker run --rm -v "$(CURDIR)":/srv/jekyll -w /srv/jekyll -p $(PORT):$(PORT) $(JEKYLL_IMAGE) \
		jekyll serve --host 0.0.0.0 --port $(PORT) --force_polling

lint:
	docker run --rm -v "$(CURDIR)":/work -w /work $(NODE_IMAGE) \
		npx --yes htmlhint $(HTML_PAGES) --format=compact

clean:
	docker run --rm -v "$(CURDIR)":/srv/jekyll -w /srv/jekyll $(JEKYLL_IMAGE) \
		rm -rf _site
