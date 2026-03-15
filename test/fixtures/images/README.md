# Sample images from Wikimedia Commons

Fetch sample images for richer integration tests:

```bash
# From repo root:
./scripts/fetch-wiki-samples.sh
```

Or manually:

```bash
cd test/fixtures/images
curl -sL "https://upload.wikimedia.org/wikipedia/commons/2/2c/CC-0.png" -o cc0-icon.png
curl -sL "https://upload.wikimedia.org/wikipedia/commons/a/a2/Icon_pdf_file_%28smaller%29.png" -o pdf-icon.png
```

`doc-with-images.typ` uses logo.png + fish.jpg. The compile test runs when fish.jpg exists.
