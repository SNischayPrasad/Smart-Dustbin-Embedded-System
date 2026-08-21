# Outputs

Generated results worth keeping, as opposed to source files.

Suggested contents:

| File | What it is |
|---|---|
| `serial_capture_<date>.txt` | A raw Serial Monitor session saved from a real run |
| `fill_history.csv` | Fill percentage logged over time, for a chart in the report |
| `fill_chart.png` | That data plotted |
| `route_plan.txt` | Output of the dashboard collection-route planner |
| `build_sizes.txt` | Compiler flash/RAM figures for each sketch |

A reference capture generated from the firmware twin is already committed at
[`../data/sample_serial_output.txt`](../data/sample_serial_output.txt) - use it
to compare against your own hardware run.

## Capturing serial output to a file

The Arduino IDE Serial Monitor cannot save directly. Options:

- **PuTTY** - Session > Serial, set the COM port and 9600 baud, then
  Session > Logging > All session output to a file.
- **arduino-cli** - `arduino-cli monitor -p COM3 -c baudrate=9600 > outputs/capture.txt`
- **Wokwi** - select the serial panel text and paste it into a file.
