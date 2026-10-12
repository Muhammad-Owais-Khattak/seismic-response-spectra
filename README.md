# Seismic Field

A browser-based global earthquake monitor paired with a local structural response-spectrum viewer.

## Dashboard

- Live global earthquake catalog from the [USGS Earthquake Hazards Program](https://earthquake.usgs.gov/earthquakes/feed/), refreshed every 60 seconds.
- Map, event details, magnitude filters, and selectable 24-hour, 7-day, and 30-day catalog windows.
- Optional browser notifications for newly reported global events, with a configurable minimum magnitude.
- Response-spectrum plots for PSA, PSV, and displacement from the included CSV, with support for loading another compatible CSV.

USGS event metadata contains locations and magnitudes, not strong-motion accelerograms. The displayed spectrum is loaded separately from `results/response_spectrum.csv`; it is not calculated from the live event feed.

## Run locally

From this directory, start a static web server:

```bash
python3 -m http.server 8000
```

Open `http://localhost:8000` in a browser. The page needs an internet connection for the USGS feed and its external map/chart libraries. Click **Enable alerts** and allow browser notifications to receive alerts while the dashboard is open. Background push notifications after closing the page require a separate push service and server-side VAPID keys; this repository does not include that service.

## Deploy

The workflow in `.github/workflows/deploy-pages.yml` deploys the repository to GitHub Pages after each push to `main`. In the repository, open **Settings → Pages** and set the build and deployment source to **GitHub Actions** if Pages is not already configured. The site will be published at:

`https://Muhammad-Owais-Khattak.github.io/seismic-response-spectra/`

## Response-spectrum CSV format

CSV headers must include `period_s`, `sd_m`, `psv_m_per_s`, and `psa_m_per_s2`. Values are oscillator period in seconds, spectral displacement in metres, pseudo-spectral velocity in metres per second, and pseudo-spectral acceleration in metres per second squared.