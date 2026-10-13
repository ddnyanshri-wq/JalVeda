# 🌱 JalVeda – Smart Agriculture Dashboard

JalVeda is a web dashboard that monitors soil moisture and controls irrigation automatically. It combines sensor readings with live weather forecasts so water is not wasted when rain is on the way.

Public Url
https://ddnyanshri-wq.github.io/JalVeda/

## Features
- Live soil moisture ring and history chart
- Automatic and manual irrigation modes
- Rain-aware watering: pauses irrigation when rain is expected
- Hysteresis (dry vs. target thresholds) to prevent rapid pump ON/OFF switching
- Safety limits: too-wet cutoff, maximum watering time, emergency stop
- 24-hour forecast (temperature, humidity, rain probability) from Open-Meteo, with no API key needed
- Notification history and pop-up alerts
- Multi-language UI: English, हिंदी, मराठी
- Location selector (Nashik, Pune, Mumbai, Nagpur, Delhi)
- Adjustable thresholds to calibrate for your own soil

## Modes
| Mode | Description |
|------|-------------|
| **Demo** (default) | Built-in simulator, so no hardware is needed |
| **Hardware** (`?mode=hardware`) | Reads live data from an Arduino through a Flask backend |

## Tech Stack
HTML, CSS, JavaScript, Chart.js, Open-Meteo API, Flask and Arduino (hardware mode)

## Run locally
Open `index.html` in a browser, or serve the folder:

    python -m http.server 8000

## Hardware mode
Needs the Flask backend exposing `/api/status`, `/api/auto`, `/api/pump/on`, `/api/pump/off`, `/api/pump/stop` and `/api/config`.
