/* =========================================================
   HP TAKEOUT DETECTOR
   FINAL FINAL VERSION (ANTI KOSONG)
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

  if (name.endsWith(".kml")) return await file.text();

  if (name.endsWith(".kmz")) {
    const buf = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(buf);
    const kmlFileName = Object.keys(zip.files)
      .find(k => k.toLowerCase().endsWith(".kml"));
    if (!kmlFileName) throw new Error("KMZ tidak berisi KML");
    return await zip.files[kmlFileName].async("text");
  }

  throw new Error("File harus KMZ / KML");
}

/* ===================== LABEL EXTRACTOR ===================== */
function extractLabel(feature) {
  const props = feature.properties || {};

  // 1️⃣ name
  if (props.name && props.name.trim()) return props.name.trim();

  // 2️⃣ ExtendedData (GeoJSON flatten)
  for (const key in props) {
    if (typeof props[key] === "string" && props[key].trim()) {
      return props[key].trim();
    }
  }

  // 3️⃣ description (HTML → text)
  if (props.description) {
    const div = document.createElement("div");
    div.innerHTML = props.description;
    const text = div.textContent.trim();
    if (text) return text;
  }

  return "";
}

/* ===================== HP FILTER ===================== */
function isHPLabel(label) {
  const name = label.toUpperCase();

  // ❌ EXCLUDE INFRA
  const blacklist = [
    "FAT","FDT","POLE","TIANG","CLOSURE",
    "NODE","SPLITTER","ODP","ODC","OLT",
    "CABINET","BOX","JOINT","HANDHOLE"
  ];
  for (const bad of blacklist) {
    if (name.includes(bad)) return false;
  }

  // ✅ INCLUDE HP
  if (
    name.includes("HOME") ||
    name.includes("HOMEPASS") ||
    name.includes("HOME-BIZ")
  ) return true;

  // Nomor rumah
  if (/^[0-9]/.test(name)) return true;

  return false;
}

/* ===================== PARSE HP ===================== */
function parseKmlHP(kmlText) {
  const dom = new DOMParser().parseFromString(kmlText, "text/xml");
  const geojson = toGeoJSON.kml(dom);

  return (geojson.features || [])
    .filter(f => f.geometry && f.geometry.type === "Point")
    .map(f => {
      const label = extractLabel(f);
      if (!label) return null;
      if (!isHPLabel(label)) return null;

      const c = f.geometry.coordinates;
      return {
        hpId: label,
        lat: c[1],
        lon: c[0]
      };
    })
    .filter(Boolean);
}

/* ===================== DISTANCE ===================== */
function distM(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat/2)**2 +
    Math.cos(toRad(lat1)) *
    Math.cos(toRad(lat2)) *
    Math.sin(dLon/2)**2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/* ===================== INDEX ===================== */
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
  const out = ["HP_ID,Lat,Lon,Status"];
  rows.forEach(r => {
    out.push(`"${r.hpId}",${r.lat},${r.lon},${r.status}`);
  });
  return out.join("\n");
}

function downloadCsv(name, text) {
  const blob = new Blob([text], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
}

/* ===================== TABLE ===================== */
function renderTable(rows) {
  const tb = $("table").querySelector("tbody");
  tb.innerHTML = "";
  rows.forEach(r => {
    tb.insertAdjacentHTML("beforeend", `
      <tr>
        <td>${r.hpId}</td>
        <td>${r.lat.toFixed(7)}</td>
        <td>${r.lon.toFixed(7)}</td>
        <td>${r.status}</td>
      </tr>
    `);
  });
}

/* ===================== MAIN ===================== */
$("run").addEventListener("click", async () => {
  const survey = $("survey").files[0];
  const design = $("design").files[0];
  const radius = Number($("radius").value || 0);

  if (!survey || !design) return alert("Upload KMZ Survey & Design");

  setStatus("Parsing KMZ...");
  const [sKml, dKml] = await Promise.all([
    readKmzOrKml(survey),
    readKmzOrKml(design)
  ]);

  const sHP = parseKmlHP(sKml);
  const dHP = parseKmlHP(dKml);

  const dIndex = indexById(dHP);
  let mid = 0, mdis = 0;
  const takeout = [];

  for (const hp of sHP) {
    let found = dIndex.has(hp.hpId);

    if (found) mid++;

    if (!found && radius > 0) {
      for (const d of dHP) {
        if (distM(hp.lat, hp.lon, d.lat, d.lon) <= radius) {
          found = true;
          mdis++;
          break;
        }
      }
    }

    if (!found) {
      takeout.push({ ...hp, status: "TAKEOUT" });
    }
  }

  renderTable(takeout);
  lastTakeoutRows = takeout;

  $("summary").textContent =
    `Survey HP: ${sHP.length} | Design HP: ${dHP.length} | ` +
    `Matched ID: ${mid} | Matched Dist: ${mdis} | TAKEOUT: ${takeout.length}`;

  $("download").disabled = takeout.length === 0;
  setStatus("Selesai");
});

$("download").addEventListener("click", () => {
  downloadCsv("hp_takeout.csv", toCsv(lastTakeoutRows));
});
