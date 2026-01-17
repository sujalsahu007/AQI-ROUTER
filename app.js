const $ = (id) => document.getElementById(id);

const fromInput = $("fromInput");
const toInput = $("toInput");
const planBtn = $("planBtn");
const swapBtn = $("swapBtn");
const clearBtn = $("clearBtn");
const fromPickBtn = $("fromPickBtn");
const toPickBtn = $("toPickBtn");

const sampleToggle = $("sampleToggle");
const sampleCount = $("sampleCount");
const sampleCountLabel = $("sampleCountLabel");

const msg = $("msg");
const statusEl = $("status");

const distKpi = $("distKpi");
const durKpi = $("durKpi");
const aqiAvgKpi = $("aqiAvgKpi");
const aqiWorstKpi = $("aqiWorstKpi");
const advice = $("advice");

const samplesCard = $("samplesCard");
const samplesList = $("samplesList");

sampleCount.addEventListener("input", () => {
  sampleCountLabel.textContent = sampleCount.value;
});

function setStatus(t){ statusEl.textContent = t; }
function showMsg(t){
  msg.hidden = false;
  msg.textContent = t;
}
function hideMsg(){ msg.hidden = true; msg.textContent = ""; }

function fmtKm(m){ return (m/1000).toFixed(1) + " km"; }
function fmtMin(s){ return Math.round(s/60) + " min"; }

function aqiCategory(aqi){
  if(aqi <= 50) return {label:"Good", cls:"good"};
  if(aqi <= 100) return {label:"Moderate", cls:"mod"};
  if(aqi <= 150) return {label:"Unhealthy (SG)", cls:"usg"};
  if(aqi <= 200) return {label:"Unhealthy", cls:"unhl"};
  if(aqi <= 300) return {label:"Very Unhealthy", cls:"vh"};
  return {label:"Hazardous", cls:"haz"};
}

/**
 * Estimate AQI from air quality variables.
 * Not official EPA AQI; we map a "severity score" to 0-400.
 */
function estimateAQI({pm25, pm10, no2, o3}){
  // Normalize each pollutant roughly by typical guideline-ish ranges.
  const s25 = pm25 / 12;   // ~12 µg/m3 (good)
  const s10 = pm10 / 45;   // ~45 µg/m3 (good-ish daily)
  const sN  = no2 / 40;    // ~40 µg/m3
  const sO  = o3  / 100;   // ~100 µg/m3 (very rough)

  // Weighted severity score
  const sev = (0.45*s25) + (0.25*s10) + (0.18*sN) + (0.12*sO);

  // Map to AQI-like number
  let aqi = Math.round(sev * 80); // scale
  aqi = Math.max(0, Math.min(400, aqi));
  return aqi;
}

// ---------------- MAP SETUP ----------------
const map = L.map("map").setView([23.2599, 77.4126], 12); // default Bhopal-ish
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap'
}).addTo(map);

let fromMarker = null;
let toMarker = null;
let routeLine = null;
let sampleMarkers = [];

let pickMode = null; // "from" | "to" | null

fromPickBtn.addEventListener("click", () => {
  pickMode = "from";
  showMsg("Pick mode: click on the map to set FROM point.");
});
toPickBtn.addEventListener("click", () => {
  pickMode = "to";
  showMsg("Pick mode: click on the map to set TO point.");
});

map.on("click", async (e) => {
  if(!pickMode) return;

  const {lat, lng} = e.latlng;
  if(pickMode === "from"){
    setFromPoint({lat, lon: lng}, "Picked location");
  } else {
    setToPoint({lat, lon: lng}, "Picked location");
  }

  // reverse geocode (optional)
  try{
    const place = await reverseGeocode(lat, lng);
    if(pickMode === "from") fromInput.value = place;
    else toInput.value = place;
  }catch{}

  pickMode = null;
  hideMsg();
});

// ---------------- GEOCODING ----------------
async function geocode(query){
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {headers:{ "Accept":"application/json" }});
  if(!res.ok) throw new Error("Geocoding failed");
  const data = await res.json();
  if(!data.length) throw new Error("Place not found: " + query);
  return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon), name: data[0].display_name };
}

async function reverseGeocode(lat, lon){
  const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`;
  const res = await fetch(url);
  if(!res.ok) throw new Error("Reverse geocode failed");
  const data = await res.json();
  return data.display_name || `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

// ---------------- ROUTING ----------------
async function getRoute(from, to){
  // OSRM expects lon,lat
  const url = `https://router.project-osrm.org/route/v1/driving/${from.lon},${from.lat};${to.lon},${to.lat}?overview=full&geometries=geojson&alternatives=false&steps=false`;
  const res = await fetch(url);
  if(!res.ok) throw new Error("Routing failed");
  const data = await res.json();
  if(!data.routes || !data.routes.length) throw new Error("No route found");
  return data.routes[0]; // distance, duration, geometry
}

function clearRouteVisuals(){
  if(routeLine){ map.removeLayer(routeLine); routeLine = null; }
  sampleMarkers.forEach(m => map.removeLayer(m));
  sampleMarkers = [];
}

function setFromPoint(p, label){
  if(fromMarker) map.removeLayer(fromMarker);
  fromMarker = L.marker([p.lat, p.lon]).addTo(map).bindPopup(`From: ${label}`).openPopup();
  window._fromPoint = p;
}
function setToPoint(p, label){
  if(toMarker) map.removeLayer(toMarker);
  toMarker = L.marker([p.lat, p.lon]).addTo(map).bindPopup(`To: ${label}`).openPopup();
  window._toPoint = p;
}

swapBtn.addEventListener("click", () => {
  const a = fromInput.value;
  fromInput.value = toInput.value;
  toInput.value = a;

  const fp = window._fromPoint;
  const tp = window._toPoint;
  window._fromPoint = tp;
  window._toPoint = fp;

  if(window._fromPoint) setFromPoint(window._fromPoint, "Swapped");
  if(window._toPoint) setToPoint(window._toPoint, "Swapped");
});

clearBtn.addEventListener("click", () => {
  fromInput.value = "";
  toInput.value = "";
  hideMsg();
  setStatus("Ready.");
  distKpi.textContent = "—";
  durKpi.textContent = "—";
  aqiAvgKpi.textContent = "—";
  aqiWorstKpi.textContent = "—";
  advice.hidden = true;
  samplesCard.hidden = true;

  if(fromMarker){ map.removeLayer(fromMarker); fromMarker = null; }
  if(toMarker){ map.removeLayer(toMarker); toMarker = null; }
  clearRouteVisuals();

  window._fromPoint = null;
  window._toPoint = null;
});

// ---------------- AQI SAMPLING ----------------
function sampleCoordinates(geojsonLine, count){
  // geojsonLine: {type:"LineString", coordinates:[[lon,lat],...]}
  const coords = geojsonLine.coordinates;
  if(coords.length <= count) return coords.map(c => ({lon:c[0], lat:c[1]}));

  // pick evenly spaced indices
  const out = [];
  for(let i=0;i<count;i++){
    const idx = Math.floor((i/(count-1)) * (coords.length-1));
    out.push({lon: coords[idx][0], lat: coords[idx][1]});
  }
  return out;
}

async function fetchAir(lat, lon){
  // Open-Meteo Air Quality API (hourly). We'll take current hour.
  const url =
    `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}` +
    `&hourly=pm10,pm2_5,nitrogen_dioxide,ozone&timezone=auto`;

  const res = await fetch(url);
  if(!res.ok) throw new Error("Air quality fetch failed");
  const data = await res.json();

  const h = data.hourly;
  if(!h || !h.time || !h.time.length) throw new Error("No air data");

  // choose closest hour to "now"
  const now = new Date();
  let bestIdx = 0;
  let bestDiff = Infinity;
  for(let i=0;i<h.time.length;i++){
    const t = new Date(h.time[i]);
    const d = Math.abs(t - now);
    if(d < bestDiff){ bestDiff = d; bestIdx = i; }
  }

  return {
    time: h.time[bestIdx],
    pm10: h.pm10?.[bestIdx] ?? 0,
    pm25: h.pm2_5?.[bestIdx] ?? 0,
    no2: h.nitrogen_dioxide?.[bestIdx] ?? 0,
    o3:  h.ozone?.[bestIdx] ?? 0
  };
}

function renderAdvice(avg, worst){
  const cAvg = aqiCategory(avg);
  const cWorst = aqiCategory(worst);

  let tip = "";
  if(worst > 200){
    tip = "Avoid outdoor travel if possible. Use N95 mask, keep car windows closed, and use recirculation mode.";
  } else if(worst > 150){
    tip = "Sensitive groups should avoid long exposure. Consider mask and shorter stops.";
  } else if(worst > 100){
    tip = "Moderate risk. If you feel discomfort, reduce outdoor time. Mask can help.";
  } else {
    tip = "Air quality looks acceptable for most people. Still avoid heavy outdoor exertion near traffic.";
  }

  advice.hidden = false;
  advice.innerHTML = `
    <b>Recommendation:</b><br/>
    Avg category: <span class="pill ${cAvg.cls}">${cAvg.label}</span>
    &nbsp;•&nbsp; Worst category: <span class="pill ${cWorst.cls}">${cWorst.label}</span>
    <div class="muted small" style="margin-top:8px">${tip}</div>
  `;
}

function addSampleMarker(lat, lon, aqi){
  const cat = aqiCategory(aqi);
  const m = L.circleMarker([lat, lon], {
    radius: 7,
    weight: 1,
    opacity: 1,
    fillOpacity: 0.8
  }).addTo(map);
  m.bindPopup(`<b>AQI:</b> ${aqi} <span class="pill ${cat.cls}">${cat.label}</span><br/><span class="muted small">${lat.toFixed(4)}, ${lon.toFixed(4)}</span>`);
  sampleMarkers.push(m);
}

// ---------------- MAIN FLOW ----------------
planBtn.addEventListener("click", async () => {
  hideMsg();
  advice.hidden = true;
  samplesCard.hidden = true;

  try{
    setStatus("Geocoding…");

    const fromText = fromInput.value.trim();
    const toText = toInput.value.trim();

    // allow map-picked points without text
    let from = window._fromPoint;
    let to = window._toPoint;

    if(!from){
      if(!fromText) throw new Error("Enter FROM location (or pick on map).");
      from = await geocode(fromText);
      setFromPoint(from, from.name);
    }
    if(!to){
      if(!toText) throw new Error("Enter TO location (or pick on map).");
      to = await geocode(toText);
      setToPoint(to, to.name);
    }

    window._fromPoint = from;
    window._toPoint = to;

    setStatus("Finding route…");
    clearRouteVisuals();

    const route = await getRoute(from, to);
    distKpi.textContent = fmtKm(route.distance);
    durKpi.textContent = fmtMin(route.duration);

    routeLine = L.geoJSON(route.geometry, { style: { weight: 6, opacity: 0.9 } }).addTo(map);
    map.fitBounds(routeLine.getBounds(), {padding:[20,20]});

    if(!sampleToggle.checked){
      setStatus("Route ready (AQI sampling off).");
      showMsg("Route drawn. Turn on sampling to estimate AQI along the route.");
      return;
    }

    setStatus("Sampling AQI points…");
    const n = parseInt(sampleCount.value, 10);
    const points = sampleCoordinates(route.geometry, n);

    // Fetch AQI sequentially (more reliable for free APIs)
    const samples = [];
    for(let i=0;i<points.length;i++){
      setStatus(`Fetching air data (${i+1}/${points.length})…`);
      const p = points[i];
      const air = await fetchAir(p.lat, p.lon);
      const aqi = estimateAQI(air);
      samples.push({ ...p, ...air, aqi });
      addSampleMarker(p.lat, p.lon, aqi);
    }

    const avg = Math.round(samples.reduce((a,s)=>a+s.aqi,0) / samples.length);
    const worst = Math.max(...samples.map(s=>s.aqi));

    aqiAvgKpi.textContent = String(avg);
    aqiWorstKpi.textContent = String(worst);
    renderAdvice(avg, worst);

    // list
    samplesCard.hidden = false;
    samplesList.innerHTML = "";
    samples.forEach((s, idx) => {
      const cat = aqiCategory(s.aqi);
      const div = document.createElement("div");
      div.className = "sample";
      div.innerHTML = `
        <div>
          <b>Point ${idx+1}</b>
          <div class="muted small">${new Date(s.time).toLocaleString()}</div>
          <div class="muted small">PM2.5: ${s.pm25.toFixed(1)} • PM10: ${s.pm10.toFixed(1)} • NO₂: ${s.no2.toFixed(1)} • O₃: ${s.o3.toFixed(1)}</div>
          <div class="muted small">${s.lat.toFixed(4)}, ${s.lon.toFixed(4)}</div>
        </div>
        <span class="badge pill ${cat.cls}">AQI ${s.aqi} • ${cat.label}</span>
      `;
      samplesList.appendChild(div);
    });

    setStatus("Done.");
  }catch(e){
    setStatus("Error.");
    showMsg(e.message || "Something went wrong.");
  }
});
