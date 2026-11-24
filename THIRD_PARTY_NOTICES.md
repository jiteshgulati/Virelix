# Third-party notices

Virelix redistributes the following third-party files. Each remains under its own licence; the full
licence texts are included alongside the files.

| Component | Version | Files | Licence | Licence text |
|---|---|---|---|---|
| Bootstrap | 5.3.9 | `frontend/assets/vendor/bootstrap/bootstrap.min.css`, `bootstrap.bundle.min.js` (includes Popper) | MIT, © 2011–2026 The Bootstrap Authors | `frontend/assets/vendor/bootstrap/LICENSE` |
| Newsreader (variable, latin subset) | via @fontsource-variable 5.x | `frontend/assets/fonts/newsreader-latin-opsz-*.woff2` | SIL Open Font License 1.1, © 2020 The Newsreader Project Authors | `frontend/assets/fonts/LICENSE-Newsreader.txt` |
| Geist and Geist Mono (variable, latin subset) | via @fontsource-variable 5.x | `frontend/assets/fonts/geist-*.woff2` | SIL Open Font License 1.1, © 2024 The Geist Project Authors | `frontend/assets/fonts/LICENSE-Geist.txt` |

The minified Bootstrap files keep their original copyright headers; only the trailing source-map
comments were removed.

## Development-only tools (not redistributed)

Declared in `tests/e2e/package.json` and `package-lock.json`, installed with `npm ci`, and never
committed:

| Tool | Licence |
|---|---|
| Playwright (`@playwright/test`) | Apache-2.0 |
| axe-core and `@axe-core/playwright` | MPL-2.0 |

## Project licence

The repository owner hasn't yet chosen a licence for Virelix itself, so no project licence is
granted. The notices above cover only the third-party components.
