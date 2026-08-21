# 18. Screenshots and Proof Checklist

Save every image into `screenshots/` using **exactly** these filenames - the
README and the report link to them by name.

| # | Filename | What to capture | How |
|---|---|---|---|
| 1 | `01-folder-structure.png` | The full project tree | File explorer, or `tree /F` in cmd |
| 2 | `02-circuit-diagram.png` | The wiring diagram | Open `circuit_diagram/smart_dustbin_circuit.svg` in a browser |
| 3 | `03-wokwi-full-circuit.png` | The complete Wokwi circuit, all 3 sensors visible | Wokwi, simulation stopped, zoomed to fit |
| 4 | `04-lid-closed-state.png` | Running, hand sensor at 80 cm, lid closed, green LED on | Wokwi running |
| 5 | `05-object-detected.png` | Hand sensor at 10 cm, `>>> Hand detected` visible in the serial log | Wokwi running |
| 6 | `06-lid-open-state.png` | Servo at 90 degrees, lid visibly open | Wokwi running |
| 7 | `07-empty-bin-reading.png` | Both level sensors at 30 cm, `Fill=0%` | Wokwi serial panel |
| 8 | `08-half-full-reading.png` | Both at 15 cm, `A=50% B=50% Fill=50%` | Wokwi serial panel |
| 9 | `09-warning-75.png` | Both at 7.5 cm, `Status=WARNING`, red LED blinking | Wokwi running |
| 10 | `10-full-bin-alert.png` | Both at 3 cm, `Status=FULL`, red solid, buzzer active | Wokwi running |
| 11 | `11-serial-monitor.png` | A long serial capture including the boot banner | Wokwi or Arduino IDE |
| 12 | `12-lcd-display.png` | The LCD showing `Fill: 90% FULL` | Wokwi, zoomed on the LCD |
| 13 | `13-serial-commands.png` | Result of typing `HELP` then `STATUS` | Serial Monitor |
| 14 | `14-uneven-load.png` | **A at 3 cm, B at 27 cm** - `A=90% B=10% Fill=50% UNEVEN LOAD` | Wokwi serial panel |
| 15 | `15-degraded-sensor.png` | One level ECHO wire removed - `sensors=1 DEGRADED 1 SENSOR` | Wokwi serial panel |
| 16 | `16-website-public.png` | The public site: hero, KPIs and the city map | Browser, full page |
| 17 | `17-admin-login.png` | The login screen | Browser |
| 18 | `18-admin-dashboard.png` | The dashboard: map, KPIs, fleet table | Browser, full page |
| 19 | `19-admin-simulator.png` | The live firmware twin with the sliders and serial console | Browser |
| 20 | `20-source-code.png` | A representative page of the firmware | Arduino IDE or VS Code |
| 21 | `21-tests-passing.png` | `node tests/twin.test.js` showing **64 passed, 0 failed** | Terminal |
| 22 | `22-github-repo.png` | The repository home page with description and topics | Browser |
| 23 | `23-readme-preview.png` | The rendered README on GitHub | Browser |

---

## The four that matter most

If you are short of time, these four carry the project:

1. **`14-uneven-load.png`** - this is the screenshot that shows you designed
   something rather than copied it. A at 90 %, B at 10 %, fused 50 %, flag
   raised. Anyone who understands the project immediately sees the point.
2. **`11-serial-monitor.png`** - a long, clean telemetry capture is the single
   most convincing "it actually runs" artefact.
3. **`21-tests-passing.png`** - automated tests in a student embedded project
   are unusual. Show the green.
4. **`18-admin-dashboard.png`** - the thing that makes the project look like a
   product rather than a lab exercise.

---

## How to take good screenshots

**Windows:** `Win + Shift + S` for a region, `Win + PrtScn` for the full
screen (saved to Pictures\Screenshots).

**Full-page browser capture:** open DevTools with `F12`, press
`Ctrl + Shift + P`, type "screenshot", choose **Capture full size screenshot**.

**Rules**
- **PNG, not JPEG.** Text and diagrams stay crisp; JPEG makes them fuzzy.
- **Crop tightly.** Nobody needs your taskbar or your other browser tabs.
- **Make the text readable.** Zoom the serial monitor to a legible size before
  capturing. A screenshot nobody can read proves nothing.
- **Keep each file under about 500 KB.** Resize to 1600 px wide if needed.
- **Light theme for the website shots.** The Apple-style light theme is the
  design; capture it that way unless you are deliberately showing dark mode.
- **Check the file actually opens** before you commit it.

---

## Referencing screenshots in Markdown

Always use **relative** paths. An absolute path from your own machine will be
a broken image for everyone else.

```markdown
![Uneven load detection](screenshots/14-uneven-load.png)
```

Not:

```markdown
![Uneven load](C:\Users\Nischay\Documents\...\14-uneven-load.png)
```

After pushing, open the repository in a **private browsing window** and scroll
the README. Any image that does not load there is broken for every visitor.

---

## Beyond screenshots

| Artefact | Where it goes | Why it helps |
|---|---|---|
| Wokwi share link | Top of the README | A reviewer can run it themselves in one click |
| `simulation/wokwi/diagram.json` | In the repo | Stronger than any screenshot - it is the circuit |
| `data/sample_serial_output.txt` | In the repo | Full session, not a cropped moment |
| `data/test_results.csv` filled in | In the repo | Evidence of method, not just outcome |
| A 60-90 s demo video | YouTube unlisted, linked | Shows the servo and the buzzer, which stills cannot |
| GitHub Pages URL | About panel and README | Turns the dashboard into a live demo |
