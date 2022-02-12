SHELL := /bin/bash

JS_FILES = $(shell find -type f -and \( -name "*.js" \))
UI_FILES = $(shell find -type f -and \( -name "*.ui" \))
RESOURCE_FILES = $(shell find resources -mindepth 2 -type f)

LOCALES_PO = $(wildcard po/*.po)
LOCALES_MO = $(patsubst po/%.po,locale/%/LC_MESSAGES/desktop-cube.mo,$(LOCALES_PO))

.PHONY: zip install uninstall all-po pot clean

zip: desktop-cube@schneegans.github.com.zip

install: desktop-cube@schneegans.github.com.zip
	gnome-extensions install "desktop-cube@schneegans.github.com.zip" --force
	@echo "Extension installed successfully! Now restart the Shell ('Alt'+'F2', then 'r')."

uninstall:
	gnome-extensions uninstall "desktop-cube@schneegans.github.com"

all-po: $(LOCALES_PO)

pot: $(JS_FILES) $(UI_FILES)
	@echo "Generating 'desktop-cube.pot'..."
	@xgettext --from-code=UTF-8 \
			  --add-comments=Translators \
			  --copyright-holder="Simon Schneegans" \
			  --package-name="Desktop-Cube" \
			  --output=po/desktop-cube.pot \
			  $(JS_FILES) $(UI_FILES)

clean:
	rm -rf \
	desktop-cube@schneegans.github.com.zip \
	resources/desktop-cube.gresource \
	resources/desktop-cube.gresource.xml \
	schemas/gschemas.compiled \
	locale \
	ui/*.ui~ \
	po/*.po~

desktop-cube@schneegans.github.com.zip: schemas/gschemas.compiled resources/desktop-cube.gresource $(JS_FILES) $(LOCALES_MO)
	@echo "Packing zip file..."
	@rm --force desktop-cube@schneegans.github.com.zip
	@zip -r desktop-cube@schneegans.github.com.zip -- *.js src/*.js resources/desktop-cube.gresource schemas/gschemas.compiled $(LOCALES_MO) metadata.json LICENSE
	
	@#Check if the zip size is too big to be uploaded
	@if [[ "$$(stat -c %s desktop-cube@schneegans.github.com.zip)" -gt 4096000 ]]; then \
	  echo "ERROR! The extension is too big to be uploaded to the extensions website, keep it smaller than 4096 KB!"; exit 1; \
	fi

resources/desktop-cube.gresource: resources/desktop-cube.gresource.xml
	@echo "Compiling resources..."
	@glib-compile-resources --sourcedir="resources" --generate resources/desktop-cube.gresource.xml

resources/desktop-cube.gresource.xml: $(RESOURCE_FILES)
	@echo "Creating resources xml..."
	@FILES=$$(find "resources" -mindepth 2 -type f -printf "%P\n" | xargs -i echo "<file>{}</file>") ; \
	echo "<?xml version='1.0' encoding='UTF-8'?><gresources><gresource> $$FILES </gresource></gresources>" > resources/desktop-cube.gresource.xml

schemas/gschemas.compiled: schemas/org.gnome.shell.extensions.desktop-cube.gschema.xml
	@echo "Compiling schemas..."
	@glib-compile-schemas schemas

locale/%/LC_MESSAGES/desktop-cube.mo: po/%.po
	@echo "Compiling $@"
	@mkdir -p locale/$*/LC_MESSAGES
	@msgfmt -c -o $@ $<

po/%.po:
	@echo "Updating $@"
	msgmerge --previous --update $@ po/desktop-cube.pot
	@# Output translation progress
	@msgfmt --check --verbose --output-file=/dev/null $@