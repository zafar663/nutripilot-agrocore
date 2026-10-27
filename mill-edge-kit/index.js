import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const __dir = path.dirname(fileURLToPath(import.meta.url));

function loadCfg() {
  const cfgPath = path.join(__dir, "config.json");
  if (!fs.existsSync(cfgPath)) {
    console.error("Missing config.json — download mill-edge again from Mill IQ for this mill.");
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(cfgPath, "utf8"));
}

const cfg = loadCfg();
const watch = cfg.watch_folder;
const webhook = cfg.webhook_url;
const pollMs = Number(cfg.poll_ms) || 4000;
const exts = (cfg.extensions || [".csv", ".json", ".txt", ".xml"]).map((e) => e.toLowerCase());

if (!watch || !webhook || String(webhook).includes("YOUR_")) {
  console.error("config.json: set webhook_url and watch_folder.");
  process.exit(1);
}
fs.mkdirSync(watch, { recursive: true });

const sentDir = cfg.sent_folder || path.join(watch, "sent");
const failDir = cfg.fail_folder || path.join(watch, "failed");
const recursive = cfg.recursive !== false;
const namePrefix = String(cfg.filename_prefix || "").toLowerCase();
fs.mkdirSync(sentDir, { recursive: true });
fs.mkdirSync(failDir, { recursive: true });
for (const sub of ["weighbridge", "lab", "process", "dispatch"]) {
  fs.mkdirSync(path.join(watch, sub), { recursive: true });
}

const busy = new Set();
const skippedLogged = new Set();

function kindOf(full, name) {
  const p = full.replace(/\\/g, "/").toLowerCase();
  const n = name.toLowerCase();
  if (p.includes("/lab/") || /coa|lims|analysis/.test(n)) return "lab";
  if (p.includes("/weigh") || /weigh|receipt|inward/.test(n)) return "weighbridge";
  if (p.includes("/process") || /process|pellet|pdi|kwh/.test(n)) return "process";
  if (p.includes("/dispatch") || /dispatch|delivery|loadout/.test(n)) return "dispatch";
  return "batch";
}

function urlFor(kind) {
  const map = {
    batch: "/inbound/batch/",
    lab: "/inbound/feed-analysis/",
    weighbridge: "/inbound/weighbridge/",
    dispatch: "/inbound/dispatch/",
    process: "/inbound/process/",
  };
  return String(webhook).replace("/inbound/batch/", map[kind] || map.batch);
}

function contentType(name) {
  return path.extname(name).toLowerCase() === ".json" ? "application/json" : "text/plain";
}

function walk(dir, acc = []) {
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return acc; }
  for (const f of names) {
    if (f === "sent" || f === "failed") continue;
    const full = path.join(dir, f);
    let st;
    try { st = fs.statSync(full); } catch { continue; }
    if (st.isDirectory()) {
      if (recursive) walk(full, acc);
    } else if (isReport(f)) acc.push(full);
  }
  return acc;
}

function isReport(file) {
  const ext = path.extname(file).toLowerCase();
  const base = path.basename(file);
  if (base.startsWith(".")) return false;
  if (!exts.includes(ext)) return false;
  if (namePrefix && !base.toLowerCase().startsWith(namePrefix)) {
    if (!skippedLogged.has(base)) {
      skippedLogged.add(base);
      console.log(`[skip] ${base}`);
    }
    return false;
  }
  return true;
}

async function postFile(full) {
  const name = path.basename(full);
  if (busy.has(name)) return;
  busy.add(name);
  try {
    await new Promise((r) => setTimeout(r, 800));
    const kind = kindOf(full, name);
    const raw = fs.readFileSync(full);
    const destUrl = urlFor(kind) + (urlFor(kind).includes("?") ? "&" : "?") + "filename=" + encodeURIComponent(name);
    const res = await fetch(destUrl, {
      method: "POST",
      headers: { "Content-Type": contentType(name), "X-Filename": name },
      body: raw,
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* ignore */ }
    if (!res.ok || json?.ok === false) {
      throw new Error(json?.error || text.slice(0, 400) || `HTTP ${res.status}`);
    }
    fs.renameSync(full, path.join(sentDir, `${Date.now()}_${name}`));
    console.log(`[ok] ${name} → ${kind}`);
  } catch (e) {
    console.error(`[fail] ${name}:`, e.message);
    try { fs.renameSync(full, path.join(failDir, `${Date.now()}_${name}`)); } catch { /* locked */ }
  } finally {
    busy.delete(name);
  }
}

function runPullCommand() {
  if (!cfg.pull_command) return;
  try {
    execSync(cfg.pull_command, { cwd: watch, stdio: "inherit", windowsHide: true });
  } catch (e) {
    console.error("[pull_command]", e.message);
  }
}

function scan() {
  runPullCommand();
  for (const full of walk(watch)) void postFile(full);
}

console.log("mill-edge");
console.log("  watch:", watch);

async function pingCloud() {
  try {
    const pingUrl = String(webhook).replace("/inbound/batch/", "/inbound/ping/");
    const res = await fetch(pingUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Filename": "mill-edge-start" },
      body: "{}",
    });
    if (!res.ok) {
      const text = await res.text();
      console.warn("[ping]", res.status, text.slice(0, 200));
    } else {
      console.log("[ping] online");
    }
  } catch (e) {
    console.warn("[ping]", e.message);
  }
}

await pingCloud();
scan();
setInterval(scan, pollMs);
setInterval(() => { void pingCloud(); }, Math.max(pollMs * 8, 30000));
