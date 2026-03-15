# Font fixtures for doc-with-fonts tests

To run the optional font integration test, add Roboto (Google Font) as `test.ttf`:

```bash
curl -sL "https://github.com/google/fonts/raw/main/apache/roboto/static/Roboto-Regular.ttf" -o test.ttf
```

font-doc.typ uses `#set text(font: "Roboto")`.
