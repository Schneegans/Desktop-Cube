SHELL := /bin/bash

JS_FILES = $(shell find -type f -and \( -name "*.js" \))

.PHONY: zip install uninstall clean

zip: desktop-cube@schneegans.github.com.zip

install: desktop-cube@schneegans.github.com.zip
	gnome-extensions install "desktop-cube@schneegans.github.com.zip" --force
	@echo "Extension installed successfully! Now restart the Shell ('Alt'+'F2', then 'r')."

uninstall:
	gnome-extensions uninstall "desktop-cube@schneegans.github.com"

clean:
	rm \
	desktop-cube@schneegans.github.com.zip

desktop-cube@schneegans.github.com.zip: $(JS_FILES)
	@# Check if the VERSION variable was passed and set version to it
	@if [[ "$(VERSION)" != "" ]]; then \
	  sed -i "s|  \"version\":.*|  \"version\": $(VERSION)|g" metadata.json; \
	fi
	@# TODO Maybe echo version number of the release that was built, in order to facilitate double-checking before publishing it?
	
	@echo "Packing zip file..."
	@rm --force desktop-cube@schneegans.github.com.zip
	@zip -r desktop-cube@schneegans.github.com.zip -- *.js metadata.json LICENSE
	
	@#Check if the zip size is too big to be uploaded
	@if [[ "$$(stat -c %s desktop-cube@schneegans.github.com.zip)" -gt 4096000 ]]; then \
	  echo "ERROR! The extension is too big to be uploaded to the extensions website, keep it smaller than 4096 KB!"; exit 1; \
	fi
