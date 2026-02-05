const $ = (id) => document.getElementById(id);

let lastTakeoutRows = [];

function setStatus(msg) {
  $("status").textContent = msg;
}

function parseKmlToFeatures(kmlText) {
  const dom = new DOMParser().parseFromString(kmlText, "text/xml");
  const gj = toGeoJSON.kml(dom);
  const feats = (gj.features || []).filter(f => f.geometry && f.geometry.type === "Point");
  // Normalize: id from name / ExtendedData
  return feats.map((f, idx) => {
    const props = f.properties || {};
    const coords = f.geometry.coordinates; // [lon, lat]
    const name = (props.name || "").trim();
    const ext = props || {};
    // Try common fields
    const hpId =
      name ||
      (ext.HP_ID && String(ext.HP_ID).trim()) ||
      (ext.hp_id && String(ext.hp_id).trim()) ||
      (ext.ID && String(ext.ID).trim()) ||
      "";
    return {
      hpId,
      lat: coords[1],
      lon: coords[0],
      props,
      idx
    };
  });
}

async function readKmzOrKml(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".kml")) {
    return await file.text();
  }
  if (name.endsWith(".kmz")) {
    const buf = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(buf);
    // Find first .kml
    const kmlFileName = Object.keys(zip.files).find(k => k.toLowerCase().endsWith(".kml"));
    if (!kmlFileName) throw new Error("KMZ tidak berisi file .kml");
    return await zip.files[kmlFileName].async("text");
  }
  throw new Error("File harus .kmz atau .kml");
}

// Haversine distance in meters
function distMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat/2)**2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2)**2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function toCsv(rows) {
  const header = ["HP_ID","Lat","Lon","MatchedBy"];
  const lines = [header.join(",")];
  for (const r of rows) {
    const esc = (v) => `"${String(v ?? "").replaceAll('"','""')}"`;
    lines.push([esc(r.hpId), r.lat, r.lon, esc(r.matchedBy)].join(","));
  }
  return lines.join("\n");
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function renderTable(rows) {
  const tb = $("table").querySelector("tbody");
  tb.innerHTML = "";
  for (const r of rows.slice(0, 2000)) { // safety cap for UI
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.hpId || ""}</td>
      <td>${Number(r.lat).toFixed(7)}</td>
      <td>${Number(r.lon).toFixed(7)}</td>
      <td>${r.matchedBy}</td>
    `;
    tb.appendChild(tr);
  }
}

function makeIndexById(features) {
  const map = new Map();
  for (const f of features) {
    const key = (f.hpId || "").trim();
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(f);
  }
  return map;
}

function findMatch(surveyPoint, designIdIndex, designPoints, radiusM) {
  const id = (surveyPoint.hpId || "").trim();
  if (id && designIdIndex.has(id)) {
    return { ok: true, matchedBy: "ID" };
  }
  // fallback distance search (naive O(n), good enough for few thousands)
  if (radiusM <= 0) return { ok: false, matchedBy: "NONE" };

  for (const dp of designPoints) {
    const d = distMeters(surveyPoint.lat, surveyPoint.lon, dp.lat, dp.lon);
    if (d <= radiusM) return { ok: true, matchedBy: `DIST<=${radiusM}m` };
  }
  return { ok: false, matchedBy: "NONE" };
}

$("run").addEventListener("click", async () => {
  try {
    const fSurvey = $("survey").files?.[0];
    const fDesign = $("design").files?.[0];
    if (!fSurvey || !fDesign) {
      alert("Pilih dua file: KMZ Survey & KMZ Design");
      return;
    }

    setStatus("Membaca file...");
    $("download").disabled = true;
    lastTakeoutRows = [];

    const radiusM = Number($("radius").value || 0);

    const [kmlSurvey, kmlDesign] = await Promise.all([
      readKmzOrKml(fSurvey),
      readKmzOrKml(fDesign)
    ]);

    setStatus("Parsing KML → Point features...");
    const surveyPts = parseKmlToFeatures(kmlSurvey);
    const designPts = parseKmlToFeatures(kmlDesign);

    const designIndex = makeIndexById(designPts);

    setStatus("Mencari TAKEOUT...");
    const takeouts = [];
    let matchedId = 0, matchedDist = 0, unmatched = 0;

    for (const sp of surveyPts) {
      const res = findMatch(sp, designIndex, designPts, radiusM);
      if (res.ok) {
        if (res.matchedBy === "ID") matchedId++;
        else matchedDist++;
      } else {
        unmatched++;
        takeouts.push({
          hpId: sp.hpId,
          lat: sp.lat,
          lon: sp.lon,
          matchedBy: "TAKEOUT"
        });
      }
    }

    lastTakeoutRows = takeouts;
    renderTable(takeouts);

    $("summary").textContent =
      `Survey points: ${surveyPts.length} | Design points: ${designPts.length} | Matched by ID: ${matchedId} | Matched by distance: ${matchedDist} | TAKEOUT: ${unmatched}`;

    setStatus("Selesai.");
    $("download").disabled = takeouts.length === 0;
  } catch (err) {
    console.error(err);
    setStatus(`Error: ${err.message || err}`);
    alert(`Error: ${err.message || err}`);
  }
});

$("download").addEventListener("click", () => {
  const csv = toCsv(lastTakeoutRows);
  downloadText("hp_takeout.csv", csv);
});
