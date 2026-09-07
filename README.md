# Jiggmaker

Personal web app for **eufyMake E1** UV print jigs — Mini / Large / custom beds, Mini alignment-frame checkbox, laser DXF/SVG, a single PLA STL, and a Studio placement template. Built to run locally, including on a **Synology DS415+** via Docker.

No files leave the browser. No accounts. No secrets.

## What it does better

- Frame is a **checkbox** (Mini only) that switches the plate to **334 × 90 mm** with rounded corners and a green **usando frame** pill — Full or Tight (Tight shortens in X and seats against the **right edge** of the frame). The Studio template stays Mini **333 × 88**.
- Works **without an STL**: type a rectangle W×H and export a pocket jig immediately.
- **scaleComp = 1.003** on PLA STLs (toggle off). Laser DXF/SVG are never scaled.
- Long 333/334 mm plates: default **assume H2 is OK**, plus `maxPrintBed: 250`, a warn banner, and an optional **split**.
- History uses the same localStorage key and JSON shape as jiggenerator (`eufyJig.history.v1` / `eufyMake_jig_history.json`) so old jobs import.

Large-frame as a mechanical system is **stubbed** in the UI (Large bed jigs work).

## Locked CAD

| Constant | Value |
| --- | --- |
| Mini bed | 333 × 88 mm |
| Large bed | 333 × 418 mm |
| Frame ON (Mini) | 334 × 90 mm, rounded corners |
| `frameClearance` | 0.3 mm/side (documented; **export plate stays 334 × 90**) |
| `scaleComp` | 1.003 PLA STL only |
| `pocketDepthExtra` | 0.2 mm, skipped when `baseThickness = 0` (through-hole) |
| Defaults | pocketDepth 4, baseThk 3, matThk 3, dpi 300, clearance 0.15 |

Laser = two bonded sheets (POCKET + BASE). 3D = one solid. Base thickness 0 = through-holes; the part sits on the printer bed.

### Exports

`{name}_{bed}_{N}up_POCKET|BASE.dxf/.svg` · `{…}.stl` / `_ascii.stl` · `_TEMPLATE.svg` · `_TEMPLATE_{dpi}dpi.png` · `_CONTOURS.svg`

SVG/DXF layers: CUT/POCKET/OUTLINE → red / ACI 1 · SCORE/GUIDE/REG → blue / ACI 5 · BED gray · TEXT `#222` · DXF `$INSUNITS=4` (mm).

## Dev (without Docker)

```bash
npm ci
npm test
npm run dev
```

Open the Vite URL. Drop an STL or keep the default 50 × 30 mm rectangle, then download DXF/SVG/STL.

## Docker Compose on Synology DS415+

The DS415+ is **Intel Atom C2538 (x86_64)** with **2 GB RAM**. Use the amd64 image below; keep the memory cap. Do not enable GPU or privileged mode.

**DSM 6** (what this NAS ships): Package Center → **Docker**.  
**DSM 7** (if you moved the project to a newer NAS): **Container Manager**.

### 1. Copy the project

SSH or File Station: put this repo on the NAS, e.g. `/volume1/docker/jiggmaker`.

### 2. Build and start

**SSH (recommended on DS415+):**

```bash
cd /volume1/docker/jiggmaker
sudo docker-compose up -d --build
```

If the NAS has Compose v2:

```bash
sudo docker compose up -d --build
```

**GUI:** Docker / Container Manager → Project → Created from `docker-compose.yml` → build path = the folder that contains this file → port **8080**.

### 3. Open the app

On your LAN: `http://<nas-ip>:8080`

Map a different host port in `docker-compose.yml` if 8080 is taken (`"9080:80"`).

### 4. Update

```bash
cd /volume1/docker/jiggmaker
git pull   # or overwrite files
sudo docker-compose up -d --build
```

### Notes for this NAS

- Image is ~nginx alpine + a static SPA. Idle RAM should stay well under the 256 MB `mem_limit`.
- First build needs internet to pull `node:20-alpine` and `nginx:1.27-alpine`. After that it runs offline.
- No volumes, no env files, no tokens. Jobs live in **your browser** (`localStorage`). Use **Output → Export…** for `eufyMake_jig_history.json` backups.
- DS415+ Docker UI is slow; prefer the SSH compose commands.

## Workflow (eufyMake Studio)

1. Setup: objects, Mini/Large/custom, optional Mini frame checkbox.
2. Layout: nest/stagger, spacing, margins, Full vs Tight.
3. Output: pocket depth / base (0 = through-hole), scaleComp, laser pick-out, DPI.
4. Download the Studio template at bed size, place artwork on the numbered outlines, hide the template, print with Zero Point Alignment. Seat the physical jig on the same corner (0,0).

If a PLA jig prints slightly tight, leave **scaleComp** on (1.003). Laser-cut sheets do not need it.
