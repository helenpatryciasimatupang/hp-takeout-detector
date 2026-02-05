/* =========================================================
   HP TAKEOUT DETECTOR
   FINAL VERSION - HP ONLY
   ========================================================= */

const $ = (id) => document.getElementById(id);
let lastTakeoutRows = [];

/* ===================== STATUS ===================== */
function setStatus(msg) {
  $("status").textContent = msg;
}

/* ===================== READ KMZ / KML ===================== */
async function readKmzOrKml(file) {
  const name = file.name.toLowerCase();

  if (name.endsWith(".kml")) {
    return await file.text();
  }

  if (name.endsWith(".kmz")) {
    const buf = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(buf);
    const kmlFileName = Object.keys(zip.files)
      .find(k => k.toLowerCase().endsWith(".kml"));

    if (!kmlFileName) throw new Error("KMZ tidak berisi file KML");

    return await zip.files[kmlFileName].async("text");
  }

  throw new Error("File harus KMZ atau KML");
}

/* ===================== HP FILTER (FINAL RULE) ===================== */
/*
  HP JIKA:
  - POINT
  - DAN (mengandung HOME / HOMEPASS / HOME-BIZ)
    ATAU
  - Nama diawali angka (nomor rumah)

  BUKAN HP JIKA:
  - FAT / FDT / POLE / TIANG / CLOSURE / NODE / SPLITTER / dll
*/
function isHPFeature(feature) {
  if (!feature.geometry || feature.geometry.type !== "Point") return false;

  const name = (feature.properties?.name || "").trim().toUpperCase();
  if (!name) return false;

  // ❌ EXCLUDE NON-HP
  const blacklist = [
    "FAT",
    "FDT",
    "POLE",
    "TIANG",
    "CLOSURE",
    "NODE",
    "SPLITTER",
    "ODP",
    "ODC",
    "OLT",
    "CABINET",
    "BOX",
    "JOINT",
    "HANDHOLE"
  ];

  for (const bad of blacklist) {
    if (name.includes(bad)) return false;
  }

  // ✅ INCLUDE HP
  const isHomeKeyword =
    name.includes("HOME") ||
    name.includes("HOMEPASS") ||
    name.includes("HOME-BIZ");

  const isHouseNumber = /^[0-9]/.test(name);

  return isHomeKeyword || isHouseNumber;
}

/* ===================== PARSE KML (HP ONLY) ===================== */
function parseKmlHP(kmlText) {
  const dom = new DOMParser().parseFromString(kmlText, "text/xml");
  const geojson = toGeoJSON.kml(dom);

  return (geojson.features || [])
    .filter(isHPFeature)
    .map(f => {
      const coords = f.geometry.coordinates;
      const name = (f.properties?.name || "").trim();

      return {
        hpId: name,        // ID UTAMA = NAMA
        lat: coords[1],
        lon: coords[0]
      };
    });
}

/* ===================== DISTANCE ===================== */
function distanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
    Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) ** 2;

  return 2 * R * Math.asin(Math.sqrt(a));
}

/* ===================== INDEX DESIGN BY ID ===================== */
function indexById(points) {
  const map = new Map();
  for (const p of points) {
    if (!map.has(p.hpId)) map.set(p.hpId, []);
    map.get(p.hpId).push(p);
  }
  return map;
}

/* ===================== CSV ===================== */
function toCsv(rows) {
  const header = ["HP_ID", "Lat", "Lon", "Status"];
  const lines = [header.join(",")];

  for (const r of rows) {
    lines.push(
      `"${r.hpId}",${r.lat},${r.lon},${r.status}`
    );
  }
  return lines.join("\n");
}

function downloadCsv(filename, text) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/* ===================== TABLE ===================== */
function renderTable(rows) {
  const tbody = $("table").querySelector("tbody");
  tbody.innerHTML = "";

  for (const r of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.hpId}</td>
      <td>${r.lat.toFixed(7)}</td>
      <td>${r.lon.toFixed(7)}</td>
      <td>${r.status}</td>
    `;
    tbody.appendChild(tr);
  }
}

/* ===================== MAIN PROCESS ===================== */
$("run").addEventListener("click", async () => {
  try {
    const surveyFile = $("survey").files[0];
    const designFile = $("design").files[0];
    const radius = Number($("radius").value || 0);

    if (!surveyFile || !designFile) {
      alert("Upload KMZ Survey dan KMZ Design");
      return;
    }

    setStatus("Membaca file...");
    $("download").disabled = true;
    lastTakeoutRows = [];

    const [surveyKml, designKml] = await Promise.all([
      readKmzOrKml(surveyFile),
      readKmzOrKml(designFile)
    ]);

    setStatus("Parsing HP saja...");
    const surveyHP = parseKmlHP(surveyKml);
    const designHP = parseKmlHP(designKml);

    const designIndex = indexById(designHP);

    let matchId = 0;
    let matchDist = 0;
    const takeout = [];

    for (const hp of surveyHP) {
      let found = false;

      // MATCH BY ID
      if (designIndex.has(hp.hpId)) {
        matchId++;
        found = true;
      }

      // FALLBACK BY DISTANCE
      if (!found && radius > 0) {
        for (const d of designHP) {
          if (distanceMeters(hp.lat, hp.lon, d.lat, d.lon) <= radius) {
            matchDist++;
            found = true;
            break;
          }
        }
      }

      if (!found) {
        takeout.push({
          hpId: hp.hpId,
          lat: hp.lat,
          lon: hp.lon,
          status: "TAKEOUT"
        });
      }
    }

    lastTakeoutRows = takeout;
    renderTable(takeout);

    $("summary").textContent =
      `Survey HP: ${surveyHP.length} | ` +
      `Design HP: ${designHP.length} | ` +
      `Matched by ID: ${matchId} | ` +
      `Matched by Distance: ${matchDist} | ` +
      `TAKEOUT: ${takeout.length}`;

    $("download").disabled = takeout.length === 0;
    setStatus("Selesai.");

  } catch (err) {
    console.error(err);
    alert(err.message || err);
    setStatus("Error");
  }
});

/* ===================== DOWNLOAD ===================== */
$("download").addEventListener("click", () => {
  const csv = toCsv(lastTakeoutRows);
  downloadCsv("hp_takeout.csv", csv);
});
