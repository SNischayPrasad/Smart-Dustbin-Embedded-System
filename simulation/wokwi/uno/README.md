# Wokwi - Arduino UNO variant

The **primary** simulation for this project is the ESP32 one in the parent
folder. This UNO build is kept as an alternative for anyone who wants to run
the project on an ATmega328P, or whose course specifically requires an
Arduino UNO.

Everything works identically except that there is no Wi-Fi and therefore no
REST API - the UNO is controlled over the serial monitor instead.

## Load it

1. wokwi.com > New Project > **Arduino Uno**
2. Paste `diagram.json` into the diagram.json tab
3. Paste `sketch.ino` into the sketch.ino tab
4. Add the **Servo** and **LiquidCrystal I2C** libraries
5. Press play

## Pin map (UNO)

| Function | Pin |
|---|---|
| Hand TRIG / ECHO | D2 / D3 |
| Level A TRIG / ECHO | D4 / D5 |
| Level B TRIG / ECHO | D8 / D9 |
| Servo | D6 |
| Buzzer | D7 |
| Green LED | D10 |
| Red LED | D12 |
| LCD SDA / SCL | A4 / A5 |
