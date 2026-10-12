const FEED_URLS = {
  day: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson",
  week: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_week.geojson",
  month: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_month.geojson",
};

const RANGE_LABELS = { day: "past 24 hours", week: "past 7 days", month: "past 30 days" };
const MEASURES = {
  psa_m_per_s2: { label: "PSA", unit: "m/s²", axis: "Spectral acceleration (m/s²)", color: "#df8050" },
  psv_m_per_s: { label: "PSV", unit: "m/s", axis: "Pseudo-spectral velocity (m/s)", color: "#438775" },
  sd_m: { label: "Sd", unit: "m", axis: "Spectral displacement (m)", color: "#78964e" },
};

const elements = {
  connection: document.querySelector("#connection-label"), clock: document.querySelector("#clock"),
  range: document.querySelector("#feed-range"), refresh: document.querySelector("#refresh-button"),
  alertStatus: document.querySelector("#alert-status"), alertToggle: document.querySelector("#alert-toggle"),
  alertThreshold: document.querySelector("#alert-threshold"),
  spotlightTitle: document.querySelector("#spotlight-title"), spotlightPlace: document.querySelector("#spotlight-place"),
  spotlightMagnitude: document.querySelector("#spotlight-magnitude"), spotlightDepth: document.querySelector("#spotlight-depth"),
  spotlightTime: document.querySelector("#spotlight-time"), spotlightImage: document.querySelector("#spotlight-image"),
  spotlightPlaceholder: document.querySelector("#spotlight-placeholder"), spotlightImageStatus: document.querySelector("#spotlight-image-status"),
  spotlightImageCredit: document.querySelector("#spotlight-image-credit"), spotlightAction: document.querySelector("#spotlight-action"),
  eventCount: document.querySelector("#event-count"), strongCount: document.querySelector("#strong-count"),
  maxMagnitude: document.querySelector("#max-magnitude"), strongestPlace: document.querySelector("#strongest-place"),
  windowLabel: document.querySelector("#window-label"), mapCount: document.querySelector("#map-count"),
  eventList: document.querySelector("#event-list"), magnitudeFilter: document.querySelector("#magnitude-filter"),
  feedUpdated: document.querySelector("#feed-updated"), detailTitle: document.querySelector("#detail-title"),
  detailMag: document.querySelector("#detail-mag"), detailPlace: document.querySelector("#detail-place"),
  detailTime: document.querySelector("#detail-time"), detailDepth: document.querySelector("#detail-depth"),
  detailCoords: document.querySelector("#detail-coords"), detailType: document.querySelector("#detail-type"),
  detailLink: document.querySelector("#detail-link"), peakPsa: document.querySelector("#peak-psa"),
  peakPeriod: document.querySelector("#peak-period"), spectrumSource: document.querySelector("#spectrum-source"),
  spectrumPoints: document.querySelector("#spectrum-points"), chartEmpty: document.querySelector("#chart-empty"),
  chartCanvas: document.querySelector("#spectrum-chart"), csvUpload: document.querySelector("#csv-upload"),
};

let events = [];
let selectedEventId = null;
let map;
let markerLayer;
let spectrumRows = [];
let activeMeasure = "psa_m_per_s2";
let spectrumChart;
const ALERTS_ENABLED_KEY = "seismic-field-alerts-enabled";
const ALERT_THRESHOLD_KEY = "seismic-field-alert-threshold";
const SEEN_EVENTS_KEY = "seismic-field-seen-events";
let alertsEnabled = localStorage.getItem(ALERTS_ENABLED_KEY) === "true";
let alertsBaselineReady = false;
let knownEventIds = new Set(JSON.parse(localStorage.getItem(SEEN_EVENTS_KEY) || "[]"));
const eventDetailsCache = new Map();
let spotlightRequestId = 0;

function updateAlertControls() {
  if (!("Notification" in window)) {
    elements.alertStatus.textContent = "This browser does not support notifications";
    elements.alertToggle.textContent = "Unavailable";
    elements.alertToggle.disabled = true;
    return;
  }
  if (Notification.permission === "denied") {
    alertsEnabled = false;
    elements.alertStatus.textContent = "Notifications are blocked in browser settings";
    elements.alertToggle.textContent = "Blocked";
    elements.alertToggle.disabled = true;
    elements.alertToggle.setAttribute("aria-pressed", "false");
    return;
  }
  elements.alertToggle.disabled = false;
  elements.alertToggle.textContent = alertsEnabled && Notification.permission === "granted" ? "Alerts on" : "Enable alerts";
  elements.alertToggle.setAttribute("aria-pressed", String(alertsEnabled));
  elements.alertStatus.textContent = alertsEnabled && Notification.permission === "granted"
    ? `New global events at M ${Number(elements.alertThreshold.value).toFixed(1)}+`
    : "Choose a magnitude and enable browser notifications";
}

async function toggleAlerts() {
  if (!("Notification" in window) || Notification.permission === "denied") {
    updateAlertControls();
    return;
  }
  if (alertsEnabled) {
    alertsEnabled = false;
  } else {
    const permission = Notification.permission === "granted"
      ? "granted"
      : await Notification.requestPermission();
    alertsEnabled = permission === "granted";
  }
  localStorage.setItem(ALERTS_ENABLED_KEY, String(alertsEnabled));
  updateAlertControls();
}

function rememberEventIds(items) {
  for (const item of items) knownEventIds.add(item.id);
  if (knownEventIds.size > 3000) knownEventIds = new Set([...knownEventIds].slice(-2000));
  localStorage.setItem(SEEN_EVENTS_KEY, JSON.stringify([...knownEventIds]));
}

function checkForNewAlerts(incomingEvents) {
  if (!alertsBaselineReady) {
    rememberEventIds(incomingEvents);
    alertsBaselineReady = true;
    return;
  }
  const freshEvents = incomingEvents.filter((event) => event.id && !knownEventIds.has(event.id));
  rememberEventIds(freshEvents);
  if (!alertsEnabled || !("Notification" in window) || Notification.permission !== "granted") return;
  const cutoff = Date.now() - 15 * 60 * 1000;
  const threshold = Number(elements.alertThreshold.value);
  freshEvents
    .filter((event) => {
      const properties = event.properties;
      const latestTimestamp = Math.max(properties.time || 0, properties.updated || 0);
      return properties.status !== "deleted" && Number(properties.mag) >= threshold && latestTimestamp >= cutoff;
    })
    .sort((first, second) => second.properties.mag - first.properties.mag)
    .slice(0, 3)
    .forEach((event) => {
      const properties = event.properties;
      const depth = event.geometry?.coordinates?.[2];
      const notification = new Notification(`M ${Number(properties.mag).toFixed(1)} earthquake`, {
        body: `${properties.place || "Location unavailable"}${Number.isFinite(depth) ? ` · ${depth.toFixed(0)} km deep` : ""}`,
        tag: event.id,
      });
      notification.onclick = () => {
        window.focus();
        selectEvent(event.id);
        document.querySelector("#events").scrollIntoView({ behavior: "smooth", block: "start" });
        notification.close();
      };
    });
}

function initAlerts() {
  const savedThreshold = localStorage.getItem(ALERT_THRESHOLD_KEY);
  if ([...elements.alertThreshold.options].some((option) => option.value === savedThreshold)) {
    elements.alertThreshold.value = savedThreshold;
  }
  elements.alertThreshold.addEventListener("change", () => {
    localStorage.setItem(ALERT_THRESHOLD_KEY, elements.alertThreshold.value);
    updateAlertControls();
  });
  elements.alertToggle.addEventListener("click", toggleAlerts);
  updateAlertControls();
}

function initClock() {
  const update = () => {
    elements.clock.textContent = new Intl.DateTimeFormat("en-GB", {
      timeZone: "UTC", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    }).format(new Date());
  };
  update();
  window.setInterval(update, 1000);
}

function initMap() {
  if (!window.L) {
    document.querySelector("#earthquake-map").innerHTML = '<div class="empty-state">Map library unavailable. Reload when connected.</div>';
    return;
  }
  map = L.map("earthquake-map", { zoomControl: false, worldCopyJump: true, minZoom: 2 }).setView([17, 5], 2);
  L.control.zoom({ position: "topright" }).addTo(map);
  map.attributionControl.setPrefix(false);
  markerLayer = L.layerGroup().addTo(map);
  loadWorldMap();
}

async function loadWorldMap() {
  try {
    const response = await fetch("https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json");
    if (!response.ok) throw new Error(`Map data returned ${response.status}`);
    const topology = await response.json();
    L.geoJSON(topojson.feature(topology, topology.objects.countries), {
      interactive: false,
      style: { color: "#9aafa4", weight: 0.7, fillColor: "#d7e5d9", fillOpacity: 0.82 },
    }).addTo(map);
    map.attributionControl.addAttribution('Country boundaries: <a href="https://www.naturalearthdata.com/">Natural Earth</a>');
    markerLayer.bringToFront();
  } catch (error) {
    console.error("Unable to load country boundaries:", error);
    document.querySelector("#map-count").textContent = "Country outlines unavailable; event locations remain plotted";
  }
}

function magnitudeClass(magnitude) {
  if (magnitude >= 5.5) return "major";
  if (magnitude >= 4) return "moderate";
  return "minor";
}

function formatTime(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "--";
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

function formatOrigin(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "--";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC", day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).format(date) + " UTC";
}

function relativeTime(timestamp) {
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function getCoordinates(event) {
  const [longitude, latitude, depth] = event.geometry?.coordinates ?? [];
  return { longitude, latitude, depth };
}

function filteredEvents() {
  const minimum = Number(elements.magnitudeFilter.value);
  return events.filter((event) => Number(event.properties.mag ?? 0) >= minimum);
}

function renderMetrics() {
  const ranked = events.filter((event) => Number.isFinite(event.properties.mag)).sort((a, b) => b.properties.mag - a.properties.mag);
  const strongest = ranked[0];
  elements.eventCount.textContent = events.length.toLocaleString("en-US");
  elements.strongCount.textContent = events.filter((event) => event.properties.mag >= 4.5).length.toLocaleString("en-US");
  elements.maxMagnitude.textContent = strongest ? strongest.properties.mag.toFixed(1) : "--";
  elements.strongestPlace.textContent = strongest?.properties.place ?? "No events in this window";
  elements.windowLabel.textContent = `USGS · ${RANGE_LABELS[elements.range.value]}`;
}

function renderMap() {
  if (!map || !markerLayer) return;
  markerLayer.clearLayers();
  for (const event of events) {
    const { longitude, latitude } = getCoordinates(event);
    const magnitude = Number(event.properties.mag);
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || !Number.isFinite(magnitude)) continue;
    const color = magnitude >= 5.5 ? "#df705b" : magnitude >= 4 ? "#eda04e" : "#75b989";
    L.circleMarker([latitude, longitude], {
      radius: Math.max(4, Math.min(13, 3 + magnitude * 1.15)),
      color, fillColor: color, fillOpacity: 0.72, weight: 1.2,
    }).bindTooltip(`M ${magnitude.toFixed(1)} · ${event.properties.place ?? "Unknown location"}`).addTo(markerLayer)
      .on("click", () => selectEvent(event.id));
  }
  elements.mapCount.textContent = `${events.length.toLocaleString("en-US")} locations plotted`;
}

function renderEventList() {
  const visible = filteredEvents().sort((a, b) => b.properties.time - a.properties.time).slice(0, 40);
  if (!visible.length) {
    elements.eventList.innerHTML = '<div class="empty-state">No events match this magnitude filter.</div>';
    return;
  }
  elements.eventList.innerHTML = visible.map((event) => {
    const magnitude = Number(event.properties.mag);
    const magLabel = Number.isFinite(magnitude) ? magnitude.toFixed(1) : "--";
    const { depth } = getCoordinates(event);
    const place = event.properties.place ?? "Unknown location";
    const selected = event.id === selectedEventId ? " selected" : "";
    return `<button class="event-row${selected}" type="button" data-event-id="${escapeAttribute(event.id)}" aria-label="Magnitude ${magLabel}, ${escapeAttribute(place)}">
      <span class="event-main"><span class="magnitude-badge ${magnitudeClass(magnitude)}">${magLabel}</span><span class="event-place-wrap"><span class="event-place">${escapeHTML(place)}</span><span class="event-region">${escapeHTML(event.properties.magType ?? "Earthquake")}</span></span></span>
      <span class="event-depth">${Number.isFinite(depth) ? `${depth.toFixed(0)} km` : "--"}</span><span class="event-time">${relativeTime(event.properties.time)}</span>
    </button>`;
  }).join("");
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function escapeAttribute(value) {
  return escapeHTML(value).replace(/`/g, "&#96;");
}

function selectEvent(eventId) {
  const event = events.find((item) => item.id === eventId);
  if (!event) return;
  selectedEventId = eventId;
  const properties = event.properties;
  const { longitude, latitude, depth } = getCoordinates(event);
  const magnitude = Number(properties.mag);
  elements.detailTitle.textContent = `Magnitude ${Number.isFinite(magnitude) ? magnitude.toFixed(1) : "--"}`;
  elements.detailMag.textContent = Number.isFinite(magnitude) ? `M ${magnitude.toFixed(1)}` : "M --";
  elements.detailPlace.textContent = properties.place ?? "Unknown location";
  elements.detailTime.textContent = formatOrigin(properties.time);
  elements.detailDepth.textContent = Number.isFinite(depth) ? `${depth.toFixed(1)} km` : "--";
  elements.detailCoords.textContent = Number.isFinite(latitude) && Number.isFinite(longitude) ? `${latitude.toFixed(3)}°, ${longitude.toFixed(3)}°` : "--";
  elements.detailType.textContent = String(properties.magType ?? "Unknown").toUpperCase();
  elements.detailLink.href = properties.url ?? "#";
  elements.detailLink.classList.toggle("disabled", !properties.url);
  elements.detailLink.setAttribute("aria-disabled", String(!properties.url));
  renderSpotlight(event);
  renderEventList();
}

function chooseFeaturedEvent(items) {
  const significant = items.filter((event) => Number(event.properties.mag) >= 4.5);
  const candidates = significant.length ? significant : items;
  return candidates.reduce((strongest, event) => Number(event.properties.mag) > Number(strongest.properties.mag) ? event : strongest);
}

async function renderSpotlight(event) {
  const requestId = ++spotlightRequestId;
  const properties = event.properties;
  const [, , depth] = event.geometry?.coordinates ?? [];
  elements.spotlightTitle.textContent = `Magnitude ${Number(properties.mag).toFixed(1)}`;
  elements.spotlightPlace.textContent = properties.place ?? "Location unavailable";
  elements.spotlightMagnitude.textContent = Number(properties.mag).toFixed(1);
  elements.spotlightDepth.textContent = Number.isFinite(depth) ? `${depth.toFixed(0)} km` : "--";
  elements.spotlightTime.textContent = formatOrigin(properties.time).replace(/\s+UTC$/, "");
  elements.spotlightAction.disabled = false;
  elements.spotlightImage.hidden = true;
  elements.spotlightImage.removeAttribute("src");
  elements.spotlightImageStatus.textContent = "Checking USGS products";
  elements.spotlightImageCredit.textContent = "USGS INTENSITY SHAKE MAP · MMI";
  elements.spotlightAction.onclick = () => {
    document.querySelector("#events").scrollIntoView({ behavior: "smooth", block: "start" });
    selectEvent(event.id);
  };

  if (!properties.detail) {
    elements.spotlightImageStatus.textContent = "No event detail record available";
    return;
  }

  try {
    if (!eventDetailsCache.has(event.id)) {
      eventDetailsCache.set(event.id, fetch(properties.detail).then((response) => {
        if (!response.ok) throw new Error(`USGS detail returned ${response.status}`);
        return response.json();
      }));
    }
    const detail = await eventDetailsCache.get(event.id);
    if (requestId !== spotlightRequestId) return;
    const shakemap = detail.properties.products?.shakemap?.[0];
    const contents = shakemap?.contents ?? {};
    const image = contents["download/intensity.jpg"]
      ?? contents["download/intensity.png"]
      ?? Object.values(contents).find((item) => /^image\/(jpeg|png)$/i.test(item.contentType ?? ""));
    if (!image?.url) {
      elements.spotlightImageStatus.textContent = "No ShakeMap published for this event";
      elements.spotlightImageCredit.textContent = "USGS EVENT · SHAKE MAP UNAVAILABLE";
      return;
    }
    elements.spotlightImage.onload = () => {
      if (requestId !== spotlightRequestId) return;
      elements.spotlightImage.hidden = false;
      elements.spotlightPlaceholder.hidden = true;
    };
    elements.spotlightImage.onerror = () => {
      if (requestId === spotlightRequestId) elements.spotlightImageStatus.textContent = "ShakeMap image unavailable";
    };
    elements.spotlightImage.src = image.url;
    elements.spotlightImage.alt = `USGS ShakeMap intensity image for M ${Number(properties.mag).toFixed(1)} earthquake near ${properties.place ?? "unknown location"}`;
  } catch (error) {
    if (requestId === spotlightRequestId) elements.spotlightImageStatus.textContent = "USGS image product unavailable";
    console.warn("Unable to load event ShakeMap:", error);
  }
}

async function loadFeed() {
  const endpoint = FEED_URLS[elements.range.value];
  elements.refresh.classList.add("loading");
  elements.connection.textContent = "Updating USGS feed";
  try {
    const response = await fetch(endpoint, { cache: "no-store" });
    if (!response.ok) throw new Error(`USGS returned ${response.status}`);
    const payload = await response.json();
    events = Array.isArray(payload.features) ? payload.features : [];
    checkForNewAlerts(events);
    elements.connection.textContent = "USGS feed connected";
    elements.feedUpdated.textContent = `Updated ${formatTime(Date.now())} UTC`;
    renderMetrics();
    renderMap();
    renderEventList();
    if (events.length && !events.some((event) => event.id === selectedEventId)) selectEvent(chooseFeaturedEvent(events).id);
    if (!events.length) {
      selectedEventId = null;
      elements.detailTitle.textContent = "No current events";
      elements.detailPlace.textContent = "No earthquake events were returned in this window.";
    }
  } catch (error) {
    elements.connection.textContent = "USGS feed unavailable";
    elements.feedUpdated.textContent = "Could not refresh · retrying in 60 sec";
    if (!events.length) elements.eventList.innerHTML = '<div class="empty-state">Live feed unavailable. Check your connection and refresh.</div>';
    console.error("Unable to load USGS earthquake feed:", error);
  } finally {
    elements.refresh.classList.remove("loading");
  }
}

function parseSpectrumCSV(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) throw new Error("CSV must include a header and at least one data row.");
  const headers = lines[0].split(",").map((header) => header.trim());
  const required = ["period_s", "sd_m", "psv_m_per_s", "psa_m_per_s2"];
  const indexes = Object.fromEntries(required.map((name) => [name, headers.indexOf(name)]));
  if (Object.values(indexes).some((index) => index < 0)) {
    throw new Error(`CSV needs these columns: ${required.join(", ")}`);
  }
  const rows = lines.slice(1).map((line) => {
    const values = line.split(",").map((value) => Number(value.trim()));
    return Object.fromEntries(required.map((name) => [name, values[indexes[name]]]));
  }).filter((row) => required.every((name) => Number.isFinite(row[name])) && row.period_s > 0);
  if (!rows.length) throw new Error("CSV contains no valid spectrum rows.");
  return rows.sort((a, b) => a.period_s - b.period_s);
}

async function loadDefaultSpectrum() {
  try {
    const response = await fetch("results/response_spectrum.csv");
    if (!response.ok) throw new Error(`CSV returned ${response.status}`);
    setSpectrum(parseSpectrumCSV(await response.text()), "Source: results/response_spectrum.csv");
  } catch (error) {
    elements.spectrumSource.textContent = "Load a response-spectrum CSV to display analysis";
    elements.spectrumPoints.textContent = "No spectrum loaded";
    console.warn("Unable to load the project response-spectrum CSV:", error);
  }
}

function setSpectrum(rows, source) {
  spectrumRows = rows;
  elements.spectrumSource.textContent = source;
  elements.spectrumPoints.textContent = `${rows.length} data points`;
  const peak = rows.reduce((maximum, row) => row.psa_m_per_s2 > maximum.psa_m_per_s2 ? row : maximum, rows[0]);
  elements.peakPsa.innerHTML = `${peak.psa_m_per_s2.toFixed(2)}<small>m/s²</small>`;
  elements.peakPeriod.textContent = `Peak at ${peak.period_s.toFixed(2)} s period`;
  renderChart();
}

function renderChart() {
  if (!spectrumRows.length || !window.Chart) {
    if (!window.Chart) elements.chartEmpty.hidden = false;
    return;
  }
  const measure = MEASURES[activeMeasure];
  const context = elements.chartCanvas.getContext("2d");
  const fill = context.createLinearGradient(0, 0, 0, 205);
  fill.addColorStop(0, `${measure.color}30`);
  fill.addColorStop(1, `${measure.color}00`);
  const data = spectrumRows.map((row) => ({ x: row.period_s, y: row[activeMeasure] }));
  if (spectrumChart) {
    spectrumChart.data.datasets[0].data = data;
    spectrumChart.data.datasets[0].borderColor = measure.color;
    spectrumChart.data.datasets[0].backgroundColor = fill;
    spectrumChart.options.scales.y.title.text = measure.axis;
    spectrumChart.update();
    return;
  }
  spectrumChart = new Chart(context, {
    type: "line",
    data: { datasets: [{ data, borderColor: measure.color, backgroundColor: fill, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, pointHoverBackgroundColor: measure.color, fill: true, tension: 0.18 }] },
    options: {
      animation: { duration: 350 }, maintainAspectRatio: false,
      interaction: { intersect: false, mode: "index" },
      plugins: {
        legend: { display: false },
        tooltip: { backgroundColor: "#173b35", padding: 10, titleFont: { family: "DM Mono" }, bodyFont: { family: "DM Mono" }, callbacks: { label: (context) => ` ${context.parsed.y.toFixed(3)} ${measure.unit}` } },
      },
      scales: {
        x: { type: "linear", grid: { color: "#edf1ee" }, border: { display: false }, title: { display: true, text: "Oscillator period (s)", color: "#7d8982", font: { family: "DM Mono", size: 10 } }, ticks: { color: "#89958e", font: { family: "DM Mono", size: 9 }, maxTicksLimit: 9 } },
        y: { beginAtZero: true, grid: { color: "#edf1ee" }, border: { display: false }, title: { display: true, text: measure.axis, color: "#7d8982", font: { family: "DM Mono", size: 10 } }, ticks: { color: "#89958e", font: { family: "DM Mono", size: 9 }, maxTicksLimit: 5 } },
      },
    },
  });
}

elements.range.addEventListener("change", loadFeed);
elements.refresh.addEventListener("click", loadFeed);
elements.magnitudeFilter.addEventListener("change", renderEventList);
elements.eventList.addEventListener("click", (event) => {
  const row = event.target.closest("[data-event-id]");
  if (row) selectEvent(row.dataset.eventId);
});
document.querySelectorAll(".measure-button").forEach((button) => {
  button.addEventListener("click", () => {
    activeMeasure = button.dataset.measure;
    document.querySelectorAll(".measure-button").forEach((item) => item.classList.toggle("active", item === button));
    renderChart();
  });
});
elements.csvUpload.addEventListener("change", async (event) => {
  const [file] = event.target.files;
  if (!file) return;
  try {
    setSpectrum(parseSpectrumCSV(await file.text()), `Source: ${file.name}`);
  } catch (error) {
    window.alert(error.message);
  }
  event.target.value = "";
});

initClock();
initAlerts();
initMap();
loadDefaultSpectrum();
loadFeed();
window.setInterval(loadFeed, 60000);