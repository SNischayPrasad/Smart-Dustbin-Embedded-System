# Screenshots

Proof images for the README and the project report.

Use **exactly** the filenames listed in
[`docs/18-screenshot-checklist.md`](../docs/18-screenshot-checklist.md) - the
README and the report link to them by name, so renaming one breaks an image.

## The four that matter most

| File | Why |
|---|---|
| `14-uneven-load.png` | Shows the dual-sensor design working: A 90 %, B 10 %, fused 50 %, `UNEVEN LOAD`. This is the screenshot that proves you designed rather than copied. |
| `11-serial-monitor.png` | A long clean telemetry capture is the most convincing "it runs" artefact |
| `21-tests-passing.png` | `64 passed, 0 failed` - automated tests are rare in a student embedded project |
| `18-admin-dashboard.png` | Makes the project look like a product, not a lab exercise |

## Rules

- PNG, not JPEG - text stays crisp
- Crop tightly, no taskbars or stray tabs
- Zoom the serial monitor so the text is readable
- Keep each file under about 500 KB
- Reference them with **relative** paths: `![alt](screenshots/14-uneven-load.png)`
- After pushing, check the README in a private browser window - any image that
  does not load there is broken for everyone
