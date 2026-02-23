"use strict";

const http = require("http");

function postJson(url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = Buffer.from(JSON.stringify(body));
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": data.length
        }
      },
      (res) => {
        let chunks = "";
        res.on("data", (d) => (chunks += d.toString("utf8")));
        res.on("end", () => {
          try {
            resolve(JSON.parse(chunks));
          } catch (e) {
            reject(new Error("Bad JSON response: " + chunks.slice(0, 200)));
          }
        });
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

function summarize(r) {
  const evals = r?.evaluation || [];
  const fails = evals.filter(x => x.status === "FAIL").map(x => x.key);
  const warns = evals.filter(x => x.status === "WARN").map(x => x.key);
  const unknown = r?.nutrient_profile_full?.unknown || r?.unknown || [];
  return { ok: r?.ok, reqKey: r?.meta?.reqKey, fails, warns, unknown_len: unknown.length };
}

async function main() {
  const url = "http://localhost:3001/v1/analyze";

  const tests = [
    // Broiler
    {
      name: "Broiler Ross starter",
      body: {
        locale: "US", species: "poultry", type: "broiler", production: "meat",
        breed: "ross_308", phase: "starter", region: "us", version: "v1",
        normalize: true,
        formula_text: "Corn 55\nSBM 48 32\nSoy oil 4\nLimestone 1.0\nDCP 1.8\nSalt 0.35\nDL-Met 0.25\nL-Lys HCl 0.18"
      }
    },

    // Layer egg
    {
      name: "Layer Hyline peak",
      body: {
        locale: "US", species: "poultry", type: "layer", production: "egg",
        breed: "hyline_w36", phase: "peak", region: "us", version: "v1",
        normalize: true,
        formula_text: "Corn 55\nSBM 48 20\nLimestone 9\nDCP 1.6\nSalt 0.35\nSoy oil 2\nDL-Met 0.25\nL-Lys HCl 0.05"
      }
    },

    // Layer breeder (new)
    {
      name: "Layer breeder generic lay",
      body: {
        locale: "US", species: "poultry", type: "layer", production: "breeder",
        breed: "generic", phase: "lay", region: "us", version: "v1",
        normalize: true,
        formula_text: "Corn 55\nSBM 48 18\nLimestone 10\nDCP 1.7\nSalt 0.35\nSoy oil 1.5\nDL-Met 0.22\nL-Lys HCl 0.05"
      }
    },

    // Broiler breeder female lay
    {
      name: "Broiler breeder female Ross lay",
      body: {
        locale: "US", species: "poultry", type: "broiler_breeder", production: "female",
        breed: "ross_308", phase: "lay", region: "us", version: "v1",
        normalize: true,
        formula_text: "Corn 60\nSBM 48 18\nWheat bran 5\nLimestone 9\nDCP 1.6\nSalt 0.35\nSoy oil 2\nDL-Met 0.22\nL-Lys HCl 0.08"
      }
    }
  ];

  for (const t of tests) {
    const r = await postJson(url, t.body);
    const s = summarize(r);
    console.log("\n==", t.name, "==");
    console.log(JSON.stringify(s, null, 2));
  }

  console.log("\n✅ Golden test run completed.");
}

main().catch(e => {
  console.error("❌ Golden test run failed:", e.message);
  process.exit(1);
});
