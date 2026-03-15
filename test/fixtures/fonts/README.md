# Font fixtures for doc-with-fonts tests

Font structure follows the [Google Fonts](https://fonts.google.com/) directory layout. Download Roboto and Roboto Mono from Google Fonts, or use the URLs below.

## Directory structure

```
fonts/
├── Roboto/
│   ├── static/           # TTF: Roboto-Regular.ttf, Roboto-Bold.ttf, Roboto-Italic.ttf, etc.
│   └── Roboto-VariableFont_wdth,wght.ttf   # Variable font (optional)
├── Roboto_Mono/
│   ├── static/           # TTF: RobotoMono-Regular.ttf, etc.
│   └── otf/              # OTF: RobotoMono-Regular.otf (optional, for OTF test)
```

## Fixtures and tests

| Fixture | Fonts needed |
|---------|--------------|
| `font-doc.typ` | `Roboto/static/Roboto-Regular.ttf` |
| `font-multi-doc.typ` | `Roboto/static/Roboto-Regular.ttf`, `Roboto_Mono/static/RobotoMono-Regular.ttf` |
| `font-same-family-doc.typ` | `Roboto/static/Roboto-Regular.ttf`, `Roboto-Bold.ttf`, `Roboto-Italic.ttf` |
| `font-otf-doc.typ` | `Roboto_Mono/otf/RobotoMono-Regular.otf` |
| `font-variable-doc.typ` | `Roboto/Roboto-VariableFont_wdth,wght.ttf` |

## OTF (optional)

Typst supports OTF. To add the OTF test fixture:

```bash
curl -sL "https://raw.githubusercontent.com/googlefonts/RobotoMono/main/fonts/otf/RobotoMono-Regular.otf" -o Roboto_Mono/otf/RobotoMono-Regular.otf
```

## Variable fonts

Typst can load variable fonts, but full support (weight/width axes) is still limited. The variable font test uses `Roboto-VariableFont_wdth,wght.ttf` for basic loading verification.
