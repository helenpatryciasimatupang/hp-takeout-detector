/* =========================================================
   HP TAKEOUT DETECTOR
   FINAL VERSION (FOLDER-AWARE)
   ========================================================= */

const $ = (id) => document.getElementById(id);
let lastTakeoutRows = [];

/* ===================== STATUS ===================== */
function setStatus(msg) {
  $("status").textContent = msg;
}

/* ===================== READ KMZ ===================== */
async function readKmz(file) {
  const buf = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(buf);
  const kmlFile = Object.keys(zip.files).find(f => f.endsWith(".kml"));
  if (!kmlFile) throw new Error("KMZ tidak berisi KML");
  return await zip.files[kmlFile].async("text");
}

/* ===================== GET FOLDER PATH ===================== */
function getFolderPath(node) {
  let path = [];
  let cur = node.parentElement;

  while (cur) {
    if (cur.tagName === "Folder") {
      const name = cur.querySelector(":scope > name");
      if (name) path.unshift(name.textContent.trim().toUpperCase());
    }
    cur = cur.parentElement;
  }

  return path.join("/");
}

/* ===================== PARSE HP FROM KML ===================== */
function parseHPFromKML(kmlText) {
  const dom = new DOMParser().parseFromString(kmlText, "text/xml");
  const placemarks = [...dom.getElementsByTagName("Placemark")];

  const results = [];

  placemarks.forEach(pm => {
    const point = pm.getElementsByTagName("Point")[0];
    if (!point) return;

    const coordText = point.getElementsByTagName("coordinates")[0]?.textContent;
    if (!coordText) return;

    const [lon, lat] = coordText.trim().split(",").map(Number);

    const name = pm.getElementsByTagName("name")[0]?.textContent.trim() || "";

    const folderPath = getFolderPath(pm);

    const upperPath = folderPath.toUpperCase();

    // 🔥 DEFINISI HP DARI FOLDER
    const isHP =
      upperPath.includes("/HP") ||
      upperPath.endsWith("HP") ||
      upperPath.includes("/HOME") ||
      upperPath.includes("/HOME-BIZ");

    if (!isHP) return;

    results.push({
      hpId: name || "(NO_NAME)",
      lat,
      lon,
      path: folderPath
    });
  });

  return results;
}

/* ===================== DISTANCE ===================== */
function distM(a, b, c, d) {
  const R = 6371000;
  const toRad = x => x * Math.PI / 180;
  const dLat = toRad(c - a);
  const dLon = toRad(d - b);
  const h =
    Math.sin(dLat/2)**2 +
    Math.cos(toRad(a))*Math.cos(toRad(c))*Math.sin(dLon/2)**2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/* ===================== CSV ===================== */
function toCsv(rows) {
  const out = ["HP_ID,Lat,Lon,Folder"];
  rows.forEach(r => {
    out.push(`"${r.hpId}",${r.lat},${r.lon},"${r.path}"`);
  });
  return out.join("\n");
}

function downloadCsv(name, text) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  a.download = name;
  a.click();
}

/* ===================== MAIN ===================== */
$("run").addEventListener("click", async () => {
  const survey = $("survey").files[0];
  const design = $("design").files[0];
  const radius = Number($("radius").value || 0);

  if (!survey || !design) return alert("Upload KMZ Survey & Design");

  setStatus("Parsing KMZ (folder-aware) ...");

  const [sKml, dKml] = await Promise.all([
    readKmz(survey),
    readKmz(design)
  ]);

  const sHP = parseHPFromKML(sKml);
  const dHP = parseHPFromKML(dKml);

  let matched = 0;
  const takeout = [];

  for (const hp of sHP) {
    let found = dHP.some(d => d.hpId === hp.hpId);

    if (!found && radius > 0) {
      found = dHP.some(d => distM(hp.lat, hp.lon, d.lat, d.lon) <= radius);
    }

    if (!found) takeout.push({ ...hp, status: "TAKEOUT" });
    else matched++;
  }

  lastTakeoutRows = takeout;

  $("summary").textContent =
    `Survey HP: ${sHP.length} | Design HP: ${dHP.length} | ` +
    `Matched: ${matched} | TAKEOUT: ${takeout.length}`;

  $("download").disabled = takeout.length === 0;
  setStatus("Selesai");
});

$("download").addEventListener("click", () => {
  downloadCsv("hp_takeout.csv", toCsv(lastTakeoutRows));
});
