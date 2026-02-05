/* =========================================================
   HP TAKEOUT DETECTOR
   FINAL (FOLDER-AWARE + SHOW LIST + NEAREST FAT)
   ========================================================= */

const $ = (id) => document.getElementById(id);
let lastTakeoutRows = [];

/* ===================== STATUS ===================== */
function setStatus(msg) {
  $("status").textContent = msg;
}

/* ===================== READ KMZ / KML ===================== */
async function readKmzOrKml(file) {
  const lower = file.name.toLowerCase();

  if (lower.endsWith(".kml")) return await file.text();

  if (lower.endsWith(".kmz")) {
    const buf = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(buf);
    const kmlFile = Object.keys(zip.files).find(f => f.toLowerCase().endsWith(".kml"));
    if (!kmlFile) throw new Error("KMZ tidak berisi file KML");
    return await zip.files[kmlFile].async("text");
  }

  throw new Error("File harus KMZ / KML");
}

/* ===================== GET FOLDER PATH ===================== */
function getFolderPath(node) {
  const parts = [];
  let cur = node.parentElement;

  while (cur) {
    if (cur.tagName === "Folder") {
      const nm = cur.querySelector(":scope > name");
      if (nm && nm.textContent.trim()) parts.unshift(nm.textContent.trim());
    }
    cur = cur.parentElement;
  }
  return parts.join("/");
}

/* ===================== DISTANCE ===================== */
function distM(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = x => x * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat/2)**2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2)**2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/* ===================== PARSE PLACEMARK POINTS ===================== */
function parsePointsFromKML(kmlText) {
  const dom = new DOMParser().parseFromString(kmlText, "text/xml");
  const placemarks = [...dom.getElementsByTagName("Placemark")];

  const points = [];

  for (const pm of placemarks) {
    const point = pm.getElementsByTagName("Point")[0];
    if (!point) continue;

    const coordText = point.getElementsByTagName("coordinates")[0]?.textContent;
    if (!coordText) continue;

    const [lon, lat] = coordText.trim().split(",").map(Number);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    const name = pm.getElementsByTagName("name")[0]?.textContent?.trim() || "";
    const folderPath = getFolderPath(pm);

    points.push({
      name: name || "(NO_NAME)",
      lat,
      lon,
      path: folderPath
    });
  }

  return points;
}

/* ===================== FILTER: HP (by folder path) ===================== */
function isHPByFolder(path) {
  const p = (path || "").toUpperCase();
  return (
    p.includes("/HP") || p.endsWith("HP") ||
    p.includes("/HOME") ||
    p.includes("/HOME-BIZ")
  );
}

/* ===================== FILTER: FAT (by folder path OR name) ===================== */
function isFATPoint(pt) {
  const p = (pt.path || "").toUpperCase();
  const n = (pt.name || "").toUpperCase();

  // Folder contain FAT or name contain FAT
  // (Tidak pakai "FAT " doang supaya ketemu FATxxx, FOT..., dsb yang masih ada FAT di label)
  return (
    p.includes("/FAT") || p.endsWith("FAT") ||
    n.includes("FAT")
  );
}

/* ===================== BUILD HP LIST FROM POINTS ===================== */
function extractHP(points) {
  return points
    .filter(pt => isHPByFolder(pt.path))
    .map(pt => ({
      hpId: pt.name,
      lat: pt.lat,
      lon: pt.lon,
      path: pt.path
    }));
}

/* ===================== BUILD FAT LIST FROM POINTS ===================== */
function extractFAT(points) {
  // FAT biasanya ada di KMZ design. Kita ambil semua FAT point.
  return points
    .filter(isFATPoint)
    .map(pt => ({
      fatId: pt.name,
      lat: pt.lat,
      lon: pt.lon,
      path: pt.path
    }));
}

/* ===================== FIND NEAREST FAT ===================== */
function nearestFAT(hp, fats) {
  if (!fats.length) return { fatId: "", distM: "" };

  let best = fats[0];
  let bestD = distM(hp.lat, hp.lon, best.lat, best.lon);

  for (let i = 1; i < fats.length; i++) {
    const f = fats[i];
    const d = distM(hp.lat, hp.lon, f.lat, f.lon);
    if (d < bestD) {
      bestD = d;
      best = f;
    }
  }

  return { fatId: best.fatId, distM: bestD };
}

/* ===================== TABLE RENDER ===================== */
function renderTableTakeout(rows) {
  const tbody = $("table").querySelector("tbody");
  tbody.innerHTML = "";
  if (!rows.length) return;

  for (const r of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.hpId}</td>
      <td>${Number(r.lat).toFixed(7)}</td>
      <td>${Number(r.lon).toFixed(7)}</td>
      <td>${r.nearestFat || "-"}</td>
      <td>${(r.distToFatM === "" ? "-" : Number(r.distToFatM).toFixed(1))}</td>
      <td>${r.reason}</td>
    `;
    tbody.appendChild(tr);
  }
}

/* ===================== CSV ===================== */
function toCsv(rows) {
  const header = ["HP_ID","Lat","Lon","Folder","NearestFAT","DistToFAT_m","Reason"];
  const lines = [header.join(",")];

  const esc = (v) => `"${String(v ?? "").replaceAll('"','""')}"`;

  for (const r of rows) {
    lines.push([
      esc(r.hpId),
      r.lat,
      r.lon,
      esc(r.path),
      esc(r.nearestFat || ""),
      r.distToFatM === "" ? "" : Number(r.distToFatM).toFixed(2),
      esc(r.reason)
    ].join(","));
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

/* ===================== MAIN ===================== */
$("run").addEventListener("click", async () => {
  try {
    const survey = $("survey").files[0];
    const design = $("design").files[0];
    const radius = Number($("radius").value || 0);

    if (!survey || !design) return alert("Upload KMZ Survey & KMZ Design");

    setStatus("Parsing KMZ...");
    $("download").disabled = true;
    lastTakeoutRows = [];
    renderTableTakeout([]); // clear

    const [sKml, dKml] = await Promise.all([
      readKmzOrKml(survey),
      readKmzOrKml(design)
    ]);

    // Parse ALL points first (so we can extract HP & FAT reliably)
    const surveyPoints = parsePointsFromKML(sKml);
    const designPoints = parsePointsFromKML(dKml);

    // Extract HP from both
    const sHP = extractHP(surveyPoints);
    const dHP = extractHP(designPoints);

    // Extract FAT from DESIGN
    const fats = extractFAT(designPoints);

    // Match logic: by ID first, fallback by distance
    let matched = 0;
    const takeout = [];

    for (const hp of sHP) {
      let found = dHP.some(d => d.hpId === hp.hpId);

      if (!found && radius > 0) {
        found = dHP.some(d => distM(hp.lat, hp.lon, d.lat, d.lon) <= radius);
      }

      if (found) {
        matched++;
        continue;
      }

      // TAKEOUT -> find nearest FAT
      const nf = nearestFAT(hp, fats);

      takeout.push({
        ...hp,
        reason: "TAKEOUT",
        nearestFat: nf.fatId,
        distToFatM: nf.distM === "" ? "" : nf.distM
      });
    }

    lastTakeoutRows = takeout;
    renderTableTakeout(takeout);

    $("summary").textContent =
      `Survey HP: ${sHP.length} | Design HP: ${dHP.length} | Matched: ${matched} | TAKEOUT: ${takeout.length} | FAT found: ${fats.length}`;

    $("download").disabled = takeout.length === 0;
    setStatus("Selesai.");
  } catch (err) {
    console.error(err);
    alert(err.message || err);
    setStatus("Error");
  }
});

$("download").addEventListener("click", () => {
  downloadCsv("hp_takeout_nearest_fat.csv", toCsv(lastTakeoutRows));
});
