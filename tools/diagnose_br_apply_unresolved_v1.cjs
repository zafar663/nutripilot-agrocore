"use strict";

const fs = require("fs");
const path = require("path");

function readJson(p) {
  let raw = fs.readFileSync(p, "utf8");
  if (raw && raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
  return JSON.parse(raw);
}
function norm(s){return String(s||"").trim();}

function firstNumber(arr) {
  if (!Array.isArray(arr)) return null;
  for (const x of arr) {
    const n = Number(x);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function main(){
  const tablesPath = process.argv[2] || path.resolve("tools","br_tables_parsed.v7f.json");
  const dbPath = path.resolve("core","db","ingredients","poultry","br","v1","ingredients.poultry.br.sid.v1.json");

  const j = readJson(tablesPath);
  const tables = j.tables || [];

  const structured = readJson(dbPath);
  const DB = structured.db ? structured.db : structured;

  const reason = new Map();
  const sample = new Map();

  function bump(r, row){
    reason.set(r,(reason.get(r)||0)+1);
    if(!sample.has(r)) sample.set(r, []);
    const a = sample.get(r);
    if(a.length<20) a.push(row);
  }

  let rowsSeen=0;

  for(const t of tables){
    const heading = t.heading_raw || "";
    const idGuess = Object.keys(DB).find(id => DB[id] && DB[id].display_name === heading) || null;

    const rows = t.nutrient_rows || [];
    for(const r of rows){
      rowsSeen++;
      const key = r.key;

      if(!heading) { bump("no_heading", {table_no:t.table_no,page:t.page,title:t.title,heading, row:r}); continue; }

      // note: heading resolves by your pipeline; this is just diagnosis
      // unresolved in apply usually means: id not found OR skip rows
      const v = firstNumber(r.values);

      if(!key) { bump("key_null_or_missing", {table_no:t.table_no,page:t.page,title:t.title,heading, row:r}); continue; }

      if(v === null) { bump("no_numeric_value", {table_no:t.table_no,page:t.page,title:t.title,heading, key, values:r.values}); continue; }

      // if it got here, it is "eligible" (would have been written)
      bump("eligible_row", {table_no:t.table_no,page:t.page,heading,key,value:v});
    }
  }

  console.log("rowsSeen=", rowsSeen);
  const sorted = Array.from(reason.entries()).sort((a,b)=>b[1]-a[1]);
  console.log("Reason counts:");
  for(const [k,n] of sorted) console.log(String(n).padStart(6," "), k);

  const out = {};
  for(const [k,a] of sample.entries()) out[k]=a;

  const outPath = path.resolve("tools","br_unresolved_diagnosis.sample.json");
  fs.writeFileSync(outPath, JSON.stringify({ meta:{ tables: tables.length, rowsSeen }, reason_counts:Object.fromEntries(reason), samples: out }, null, 2) + "\n", "utf8");
  console.log("Wrote:", outPath);
}

main();
