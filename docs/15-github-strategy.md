# 15. GitHub Upload Strategy

## Repository settings

**Best repository name**

```
Smart-Dustbin-Embedded-System
```

**Best description**

```
Embedded systems smart dustbin with touchless automatic lid control, dual-sensor
waste-level monitoring and full-bin alerts using Arduino/ESP32, plus a live web
dashboard for managing bins across a city.
```

**Best topics / tags** (Settings > About > Topics, or the gear icon on the
repo home page)

```
embedded-systems   arduino          esp32
ultrasonic-sensor  servo-motor      smart-dustbin
automation         embedded-c       iot
sensors            sensor-fusion    smart-city
arduino-uno        wokwi            waste-management
```

GitHub allows up to 20 topics. Put `embedded-systems`, `arduino` and `iot`
first - those are the ones recruiters actually filter on.

---

## Step by step

### 1. Create the repository

On github.com: **New repository**.

- Name: `Smart-Dustbin-Embedded-System`
- Description: as above
- **Public** - the whole point is that it is visible
- Do **not** tick "Add a README" - you already have one

### 2. Set up git locally

```bash
git init
```

```bash
git branch -M main
```

```bash
git remote add origin https://github.com/<your-username>/Smart-Dustbin-Embedded-System.git
```

Replace `<your-username>` with your GitHub username.

### 3. Configure your identity (first time only)

```bash
git config --global user.name "Nischay"
```

```bash
git config --global user.email "your-github-email@example.com"
```

Use the email attached to your GitHub account, otherwise the commits will not
be linked to your profile and will not appear on your contribution graph.

### 4. Commit in stages, not all at once

This matters more than students expect. A repository with one commit called
"final project" tells a reviewer nothing. A repository with fifteen commits
that each do one thing shows how you actually work.

`docs/17-proof-plan.md` has a full day-by-day commit plan. The short version:

```bash
git add .gitignore README.md docs/
```

```bash
git commit -m "docs: project brief, architecture and component selection"
```

```bash
git add arduino_code/01_lid_module circuit_diagram/
```

```bash
git commit -m "feat: ultrasonic hand detection and servo lid control"
```

...and so on, one commit per subsystem.

### 5. Push

```bash
git push -u origin main
```

After the first push, later pushes are just `git push`.

### 6. Set the About panel

On the repo home page, click the gear next to **About** and add the
description, the topics, and - once you deploy - the website URL.

---

## What to upload, and what not to

**Upload**

| Path | Why |
|---|---|
| `src/`, `arduino_code/` | The actual work |
| `simulation/wokwi/diagram.json` | Lets anyone reproduce your circuit in 30 seconds |
| `circuit_diagram/` | The SVG is vector, so it stays sharp and diffs cleanly |
| `website/`, `server/` | The dashboard, which is what makes this stand out |
| `tests/` | Automated tests in a student embedded project are rare and impressive |
| `docs/` | Shows you can explain the work, not just do it |
| `data/` | Real captured output and completed test results |
| `screenshots/` | Proof it runs |
| `reports/` | The formal write-up |

**Do not upload**

| Path | Why |
|---|---|
| `.pio/`, `build/`, `*.hex`, `*.elf` | Build artefacts, regenerated every compile |
| `node_modules/` | Never. Huge and reproducible from a manifest |
| `server/fleet.json` | Runtime state, changes on every run |
| Large videos | Keep under 10 MB, or link to YouTube/Drive |
| Wi-Fi passwords | See the warning below |

> **Before you push the ESP32 sketch, blank your Wi-Fi credentials.**
> `arduino_code/05_esp32_wifi_version` ships with `Wokwi-GUEST` and an empty
> password, which is safe. If you replace them with your home network details
> to test on real hardware, put them back before committing. Anything pushed
> to a public repository is public forever, even if you delete it afterwards -
> automated scanners find committed credentials within minutes.

---

## Writing good commit messages

Use the conventional prefix style. It is what most professional teams use and
it costs nothing to adopt.

| Prefix | Use for | Example |
|---|---|---|
| `feat:` | New capability | `feat: fuse two in-bin sensors into one fill level` |
| `fix:` | Bug fix | `fix: treat any negative distance as a no-echo sentinel` |
| `docs:` | Documentation | `docs: add bin level calculation with worked examples` |
| `test:` | Tests | `test: cover uneven-load and degraded-sensor cases` |
| `refactor:` | Restructuring | `refactor: split firmware into modules under src/` |
| `chore:` | Housekeeping | `chore: add .gitignore for build artefacts` |
| `style:` | Appearance only | `style: restyle the dashboard in a light Apple theme` |

**Good:** `feat: add uneven-load detection using two in-bin sensors`
**Bad:** `update`, `final`, `changes`, `asdf`

Write the message so it completes the sentence "This commit will…".

---

## Deploying the website on GitHub Pages

Free, and it turns your repo into a live demo link.

1. Repo **Settings > Pages**.
2. Source: **Deploy from a branch**.
3. Branch: `main`, folder: `/ (root)`. Save.
4. Wait a minute, then open
   `https://<your-username>.github.io/Smart-Dustbin-Embedded-System/website/`

The site is static, so the public page, the login and the dashboard all work.
The optional Node server in `server/` is not used by Pages - the site falls
back to its built-in browser storage, which is exactly what it does offline.

Put that URL in the About panel and at the top of your README.

---

## Making the repository look finished

- [ ] README renders with no broken images (check in a private window)
- [ ] Description and topics set
- [ ] Website URL in the About panel
- [ ] Wokwi share link near the top of the README
- [ ] At least 10 commits with meaningful messages
- [ ] `data/test_results.csv` filled in with real observations
- [ ] Screenshots present and referenced with **relative** paths
- [ ] No build artefacts, no `node_modules`, no credentials
- [ ] `LICENSE` file added (MIT is the usual choice for coursework)
