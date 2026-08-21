# Wokwi simulation - ESP32 (primary)

This is the main simulation for the project. It runs the real compiled ESP32
firmware, including Wi-Fi, on a simulated ESP32-WROOM-32.

An Arduino UNO variant is kept in [`uno/`](uno/) for anyone who needs it.

---

## Load it

1. Go to **wokwi.com** and click **New Project > ESP32**
2. Open the **diagram.json** tab, select all, and paste in
   [`diagram.json`](diagram.json)
3. Open the **sketch.ino** tab and paste in [`sketch.ino`](sketch.ino)
4. When the build complains about a missing library, click
   **Install "ESP32Servo" library**; do the same for **LiquidCrystal I2C**
   (or add both from the Library Manager tab up front)
5. Press the green play button

The whole circuit - 11 parts, 27 connections - appears fully wired.

---

## Pin map (ESP32)

| Function | GPIO |
|---|---|
| Hand sensor TRIG / ECHO | 5 / 18 |
| Level A TRIG / ECHO (inside) | 19 / 23 |
| Level B TRIG / ECHO (inside) | 32 / 33 |
| Servo signal | 13 |
| Buzzer | 25 |
| Green LED | 26 |
| Red LED | 27 |
| LCD SDA / SCL | 21 / 22 |

> **Wokwi pin naming.** On `board-esp32-devkit-c-v4` the GPIOs are named
> `esp:5`, `esp:18`, `esp:19` and so on - **bare numbers, no `D` prefix**.
> `esp:D0`-`esp:D3`, `esp:CMD` and `esp:CLK` are the **flash** pins, not
> GPIO 0-3. Writing `esp:D5` gives you a silently dead wire, not an error.

---

## Wi-Fi in the simulator

The sketch ships with:

```c
const char* WIFI_SSID = "Wokwi-GUEST";
const char* WIFI_PASS = "";
```

That is Wokwi's built-in network - it connects in about a second and gives the
simulated ESP32 real internet access. The serial monitor prints the IP address
it was assigned, and the built-in status page is served on it.

Change these two lines only when you flash real hardware, and blank them again
before committing to a public repository.

---

## Driving the simulation

Click any sensor while it runs and a distance control appears.

| To show | Set |
|---|---|
| Lid opening | Hand sensor to 10 cm |
| Lid closing | Hand sensor back to 80 cm, wait 3 s |
| Empty bin | Both level sensors to 30 cm |
| Half full | Both level sensors to 15 cm |
| Warning band | Both level sensors to 7.5 cm |
| Full + buzzer | Both level sensors to 3 cm |
| **Uneven load** | Level A to 3 cm, level B to 27 cm |
| Degraded mode | Delete one level sensor ECHO wire |

Type commands into the serial panel: `OPEN CLOSE AUTO MUTE UNMUTE EMPTY
STATUS WIFI HELP`.

---

## Files

| File | Purpose |
|---|---|
| `diagram.json` | The circuit - paste into the diagram.json tab |
| `sketch.ino` | Copy of `arduino_code/05_esp32_wifi_version` |
| `libraries.txt` | Libraries Wokwi should install |
| `wokwi.toml` | Only needed for the VS Code extension |
| `uno/` | The Arduino UNO variant |
