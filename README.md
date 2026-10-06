# Halden Ridge emissions console

A prototype operator console for a cement plant. It shows CO2 leaving the stacks in real time, lets automated capture vents respond on their own, keeps every shutdown decision with a human operator, and gives a regulator the numbers and reports they ask for. An AI copilot answers questions about production and compliance from the plant's records.

The repo also contains the design system behind it. Every color, font, size and 3D setting lives in one token file that builds the CSS.

**Live demo:** `https://<your-username>.github.io/<repo-name>/`
- Prototype: the site root
- Design system: `/design-system/`

> All data is synthetic. The plant, its permit, the emissions cap and every figure are invented for this prototype.

---

## What's inside

**The prototype** (the root `index.html`) is a single screen. The 3D plant fills it and is always visible: the regulatory overview sits in a column on the left, the copilot and event log in a panel on the right, and the line-card dock floats between them. The camera keeps the plant centred in the space they leave open.

- **Overview column (left).** An invisible container: its top bar (title, collapse button, reporting period), each card and its bottom bar (exports) float on their own over the plant. The cards scroll between the two bars and fade out where they meet them. Collapse it to a rail with the chevron in its top bar (or press `[`); the rail shows a red dot while a line is over its permit limit.
- **Side panel (right).** Collapse it to a slim rail with the chevron in its header (or press `\`) to give the 3D view more room. The rail keeps an icon for each tab and a badge counting unseen events. Both columns remember their state between visits.

- **Emissions console.** A 3D drawing of the plant with two clinker lines. Smoke shifts from yellow to red as emissions rise, fence-line sensors change color, and an air scanner sweeps the site. Each line has an automated capture vent that opens when CO2 rises past its trigger and logs when it opened, how long it ran and what it captured. Only the operator can shut a line down, and always through a confirmation step.
- **Overview.** Regulatory figures, stacked one card per row, for the last 7 days, the last 30 days or the year to date, picked at the top of the column. It shows live permit status, CO2 released, emissions per tonne against the permit target, annual cap use, captured CO2, monitoring coverage, two trend charts, CO2 by source, a per-line table and the permit-limit exceedance register. The bottom bar exports a PDF compliance report, the emissions data as CSV, and the exceedance register as CSV.
- **Copilot.** Ask about last night's production, vent activity, trends or compliance. It pulls records before answering, can draw charts, and can recommend a shutdown, but it can't perform one.
- **Event log.** Every vent, alarm, upset, air alert, shutdown and restart, with timestamps.

**The design system** (`/design-system/`) documents the principles, color, typography, shape, elevation and layout, 3D settings and every component (including the floating container, the overview column and the collapsible side panel), using the same markup and classes as the prototype. Its token sections are generated from the token file, so they're always current.

## A two-minute tour

1. Open the prototype and wait about 20 seconds. Line 1's kiln runs hot, its vent opens automatically, and an alarm fires when emissions stay over the limit.
2. Press **Shut down…** on Line 1's card, then confirm. Production ramps down and the vent closes. Check the **Event log** tab for the timeline.
3. In the copilot, try *"How did last night's production go?"* Overnight, Line 2 had an upset, a 51-minute vent run, an alarm and a shutdown.
4. In the overview on the left, pick a period and download the PDF compliance report from the bottom bar.
5. Use **Simulate kiln upset** (top right of the 3D view) whenever you want another incident.

## Run it locally

It's a static site with no build step for the app itself. You need a local web server, because the design system page loads `assets/data/tokens.json`, which browsers block when you open files directly.

```bash
npm run serve        # serves the folder at http://localhost:8080 (needs Node 18+)
# or, without Node:
python3 -m http.server 8080
```

Then open `http://localhost:8080/` for the prototype or `http://localhost:8080/design-system/` for the design system.

## Deploy to GitHub Pages

1. Push this folder to a GitHub repository, with `index.html` at the root.
2. In the repository, go to **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to **Deploy from a branch**, choose `main` and `/ (root)`, and save.
4. After a minute the site is live at `https://<your-username>.github.io/<repo-name>/`.

The generated token files are committed, so Pages doesn't need to run anything. The empty `.nojekyll` file tells Pages to serve the files as they are.

## Design tokens

All design decisions live in **`tokens/tokens.json`**, written in the [W3C Design Tokens format](https://tr.designtokens.org/format/) (`$value`, `$type`, `$description`). There are 94 tokens:

| Group | What it covers |
|---|---|
| `color.surface`, `color.text`, `color.border` | Backgrounds, text and outlines |
| `color.accent`, `color.status` | The yellow accent, alarm red and warning orange |
| `color.chart`, `color.emission` | Chart series and the yellow-to-red emission scale |
| `color.scene`, `color.print` | 3D drawing colors and the PDF report palette |
| `font.family`, `font.weight`, `font.size`, `font.tracking` | Type |
| `shape`, `effect` | Frame brackets, cut corners, floating-container radius, blur, scanlines |
| `elevation` | Drop shadows for floating containers, overview cards and chips (DTCG `shadow` composites) |
| `layout` | Floating gap, app bar height, side panel and overview column widths and rails, card gap, scroll-edge fade, breakpoint |
| `scene`, `motion` | 3D opacities, camera framing, scanner timing, panel animation, scroll-fade timing and easing |

### Editing tokens

```bash
# 1. edit tokens/tokens.json
npm run tokens          # 2. regenerate the outputs
npm run tokens:watch    #    or rebuild automatically on every save
npm run tokens:check    # 3. confirm everything is in sync (CI runs this too)
```

`scripts/build-tokens.mjs` needs no dependencies. It writes:

- **`assets/css/tokens.css`**: every token as a CSS custom property on `:root`. Every page loads this first.
- **`assets/data/tokens.json`**: a flat, resolved list that the design system page uses to draw swatches and tables.

Composite values are converted for CSS: a `shadow` token (one layer or a list) becomes a `box-shadow` value, and a `cubicBezier` array becomes `cubic-bezier()`.

Don't edit either output by hand; they're overwritten on every build. The GitHub Action in `.github/workflows/tokens.yml` fails a push if the outputs are out of date.

### Naming

A token's CSS name is its path joined with dashes. A segment named `default` is dropped:

```
color.accent.default   → --color-accent
color.text.muted       → --color-text-muted
font.size.xl           → --font-size-xl
```

### Aliases

A token can point at another one, such as `"$value": "{color.accent.default}"`. In the CSS this becomes `var(--color-accent)`, so changing the accent updates the chart, emission scale, 3D outlines and PDF accent with it. The build reports a missing or circular alias by name.

### Tokens in JavaScript

The 3D scene and the PDF report can't use CSS directly, so `assets/js/lib.js` reads tokens at runtime:

```js
token("--color-accent")                    // "#f7c948"
tokenNumber("--scene-scanner-opacity", 0.255)
tokenSeconds("--motion-scanner-period", 10)
tokenRgb("--color-print-text")             // [28, 32, 36], resolves aliases and rgba
```

Each call has a fallback, so a missing token degrades gracefully instead of breaking the scene.

### Adding a token

Add it to `tokens/tokens.json` with a `$value`, a `$type` (or inherit one from its group), and a `$description`. Run `npm run tokens`, use the new `var(--…)` in CSS or `token("--…")` in JavaScript, and commit both the source and the generated files.

## Project structure

```
├── index.html                  The prototype (emissions console)
├── design-system/index.html    Design system documentation
├── tokens/tokens.json          Design token source (edit this)
├── scripts/build-tokens.mjs    Builds tokens.css and data/tokens.json
├── assets/
│   ├── css/
│   │   ├── tokens.css          Generated. CSS custom properties
│   │   ├── base.css            Reset, page defaults, type
│   │   ├── components.css      Component library, shared by the prototype and design system
│   │   ├── console.css         Prototype layout only: full-screen 3D view, overview column, side panel, dock
│   │   └── docs.css            Design system page layout
│   ├── js/
│   │   ├── lib.js              Shared helpers: formatting, DOM, charts, token access
│   │   ├── plant.js            Plant constants and synthetic history
│   │   ├── simulation.js       Live simulation: production, upsets, vents, alarms, sensors
│   │   ├── reports.js          Production reports, event log, compliance summary
│   │   ├── ui.js               Console UI: stats, line cards, tabs, chat rendering
│   │   ├── copilot.js          Copilot tools, live and demo modes
│   │   ├── scene.js            3D plant (Three.js)
│   │   ├── overview.js         Overview column: period filter, cards, PDF/CSV exports
│   │   ├── layout.js           Floating layout: both columns' collapse, scroll fades, 3D framing
│   │   ├── main.js             Boot
│   │   └── design-system.js    Renders the design system's token sections
│   └── data/tokens.json        Generated. Token list for the design system page
├── .github/workflows/tokens.yml  Checks generated tokens are up to date
└── package.json                npm scripts
```

### How the scripts fit together

The prototype uses plain `<script>` tags with no bundler or framework. The files share one global scope and load in the order listed in `index.html`: `lib` → `plant` → `simulation` → `reports` → `ui` → `copilot` → `scene` → `overview` → `layout` → `main`. Keep that order if you add files.

The data flows in one direction:

- **`plant.js`** generates history: hourly records for the last 30 days, daily records back to 1 January, events and the exceedance register.
- **`simulation.js`** adds a live tick every second.
- **`reports.js`** answers every question about that data. The dashboard, the exports and the copilot all use the same functions, so their numbers always agree.

## The copilot: demo and live modes

The header always shows which mode is running.

- **Demo mode (GitHub Pages, local server).** Scripted answers built from the same data and tools, labelled **Demo script**. It handles last night's production, vent activity, weekly trends, compliance, and whether to shut anything down.
- **Live mode.** When the page runs as a published Claude artifact, it uses Claude through the artifact runtime (`window.claude`). Claude calls the page's own tools to fetch reports, draw charts and recommend shutdowns.

GitHub Pages can't safely hold an API key, so live mode isn't available there. To add it, put a small server or serverless function in front of the Claude API and point `copilot.js` at it. The tool definitions in `TOOLS` map almost directly onto the Claude Messages API: rename `inputSchema` to `input_schema` and run each tool's `execute` function in the browser when Claude asks for it.

## Tech and credits

- [Three.js](https://threejs.org/) r147 for the 3D view, and [jsPDF](https://github.com/parallax/jsPDF) 2.5.1 for the PDF report. Both load from public CDNs.
- [Chakra Petch](https://fonts.google.com/specimen/Chakra+Petch) and [Archivo](https://fonts.google.com/specimen/Archivo) from Google Fonts.
- No framework, no bundler, no runtime dependencies. Node is only needed to rebuild tokens or run the local server.

## Notes

- **Browsers:** needs a current browser with WebGL. The logic is covered by headless tests, but check the 3D view by eye in each browser you care about.
- **Reduced motion:** the scanner and vent fans stop spinning when the operating system asks for reduced motion.
- **Data:** history is generated from a fixed seed, so the same story appears on every load (including last night's Line 2 incident). Live readings and upsets are random. Nothing is stored or sent anywhere; reloading starts fresh.

## License

Add a license of your choice before publishing (for example MIT via GitHub's **Add file → Create new file → LICENSE** template).
