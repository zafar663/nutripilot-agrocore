"use strict";

const { spawn } = require("node:child_process");
const { Worker } = require("node:worker_threads");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");

const PYTHON_SCRIPT = path.join(__dirname, "..", "python", "native_lp_worker.py");
const JS_WORKER = path.join(__dirname, "lpJsWorker.cjs");
const JOB_TIMEOUT_MS = Number(process.env.NUTRIX_SOLVER_TIMEOUT_MS) || 60000;

function workerCount() {
  const n = Number(process.env.NUTRIX_SOLVER_WORKERS);
  if (Number.isFinite(n) && n >= 1) return Math.min(8, Math.floor(n));
  return Math.min(4, Math.max(2, os.cpus().length || 2));
}

function jsModelToNative(model) {
  const variablesIn = (model && model.variables) || {};
  const constraintsIn = (model && model.constraints) || {};
  const varIds = Object.keys(variablesIn);
  const boundMin = new Set(varIds.map((id) => `var_${id}_min`));
  const boundMax = new Set(varIds.map((id) => `var_${id}_max`));

  const variables = varIds.map((id) => {
    const v = variablesIn[id] || {};
    const minC = constraintsIn[`var_${id}_min`];
    const maxC = constraintsIn[`var_${id}_max`];
    const lb = minC && Number.isFinite(Number(minC.min)) ? Number(minC.min) : 0;
    const ub = maxC && Number.isFinite(Number(maxC.max)) ? Number(maxC.max) : null;
    return {
      id,
      obj: Number.isFinite(Number(v.cost)) ? Number(v.cost) : 0,
      lb,
      ub
    };
  });

  const constraints = [];
  for (const [name, c] of Object.entries(constraintsIn)) {
    if (boundMin.has(name) || boundMax.has(name) || !c) continue;
    const pushRow = (sense, rhs) => {
      if (!Number.isFinite(Number(rhs))) return;
      const coeffs = {};
      for (const id of varIds) {
        const coef = variablesIn[id] ? variablesIn[id][name] : null;
        if (coef == null) continue;
        const n = Number(coef);
        if (!Number.isFinite(n) || n === 0) continue;
        coeffs[id] = n;
      }
      constraints.push({ name, sense, rhs: Number(rhs), coeffs });
    };
    if (c.equal != null) {
      pushRow("=", c.equal);
    } else {
      if (c.min != null) pushRow(">=", c.min);
      if (c.max != null) pushRow("<=", c.max);
    }
  }

  return {
    variables,
    constraints,
    opType: model && model.opType ? model.opType : "min"
  };
}

function nativeToJsResult(nativeOut) {
  const engine = nativeOut && nativeOut.engine;
  if (!nativeOut || nativeOut.ok === false) {
    return {
      ok: false,
      status: (nativeOut && nativeOut.status) || "solver_runtime_error",
      message: (nativeOut && (nativeOut.error || nativeOut.message)) || "Native LP worker failed.",
      result: null,
      engine
    };
  }
  if (nativeOut.feasible === false || nativeOut.status === "INFEASIBLE") {
    return {
      ok: true,
      status: "solved",
      message: "LP solver executed.",
      result: { feasible: false, result: "Infeasible" },
      engine
    };
  }
  const result = {
    feasible: true,
    bounded: nativeOut.status !== "UNBOUNDED",
    result: nativeOut.objective,
    cost: nativeOut.objective
  };
  const values = nativeOut.values || {};
  for (const [id, val] of Object.entries(values)) {
    result[id] = val;
  }
  if (nativeOut.duals && typeof nativeOut.duals === "object") result.duals = nativeOut.duals;
  if (nativeOut.reduced_costs && typeof nativeOut.reduced_costs === "object") {
    result.reduced_costs = nativeOut.reduced_costs;
  }
  return {
    ok: true,
    status: "solved",
    message: "LP solver executed.",
    result,
    engine
  };
}

function findPythonBins() {
  if (process.env.PYTHON_BIN) return [process.env.PYTHON_BIN];
  if (process.platform === "win32") return ["python", "python3", "py"];
  return ["python3", "python"];
}

class LineReader {
  constructor(stream, onLine) {
    this.buf = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      this.buf += chunk;
      let idx;
      while ((idx = this.buf.indexOf("\n")) >= 0) {
        const line = this.buf.slice(0, idx).trim();
        this.buf = this.buf.slice(idx + 1);
        if (line) onLine(line);
      }
    });
  }
}

class SolverPool {
  constructor() {
    this.size = workerCount();
    this.pythonSlots = [];
    this.jsSlots = [];
    this.queue = [];
    this.jobSeq = 0;
    this.engine = null;
    this.mode = "starting";
    this.ready = this.start();
  }

  async start() {
    if (!fs.existsSync(PYTHON_SCRIPT)) {
      this.mode = "js-workers";
      this.startJsWorkers();
      return;
    }
    const bins = findPythonBins();
    let spawned = 0;
    for (let i = 0; i < this.size; i++) {
      const slot = await this.spawnPythonSlot(bins);
      if (slot) {
        this.pythonSlots.push(slot);
        spawned += 1;
        if (slot.engine) this.engine = slot.engine;
      }
    }
    if (spawned > 0) {
      this.mode = "native";
      console.log(`[solverPool] ${spawned} native LP workers (${this.engine || "ortools"})`);
      return;
    }
    this.mode = "js-workers";
    this.startJsWorkers();
    console.warn("[solverPool] native HiGHS/GLOP workers unavailable; using javascript-lp-solver worker threads");
  }

  async spawnPythonSlot(bins) {
    for (const bin of bins) {
      const args = bin === "py" ? ["py", ["-3", "-u", PYTHON_SCRIPT]] : [bin, ["-u", PYTHON_SCRIPT]];
      try {
        const child = spawn(args[0], args[1], {
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
          env: { ...process.env, PYTHONUNBUFFERED: "1", PYTHONWARNINGS: "ignore" }
        });
        const spawnFailed = await new Promise((resolve) => {
          const onErr = (err) => resolve(err);
          child.once("error", onErr);
          child.once("spawn", () => {
            child.off("error", onErr);
            resolve(null);
          });
        });
        if (spawnFailed) continue;
        const slot = {
          child,
          busy: false,
          engine: null,
          pending: new Map(),
          alive: true
        };
        child.stderr.setEncoding("utf8");
        child.stderr.on("data", (d) => {
          const t = String(d).trim();
          if (t) console.warn("[native_lp_worker]", t);
        });
        new LineReader(child.stdout, (line) => {
          let msg;
          try {
            msg = JSON.parse(line);
          } catch {
            return;
          }
          const wait = slot.pending.get(msg.id);
          if (wait) {
            slot.pending.delete(msg.id);
            wait.resolve(msg);
          }
        });
        child.on("exit", () => {
          slot.alive = false;
          for (const wait of slot.pending.values()) {
            wait.reject(new Error("Native LP worker exited"));
          }
          slot.pending.clear();
          slot.busy = false;
          this.pump();
        });
        const ping = await this.sendPython(slot, { id: "ping", ping: true }, 8000);
        if (ping && ping.ok) {
          slot.engine = ping.engine || "ortools";
          return slot;
        }
        try {
          child.kill();
        } catch {
          /* ignore */
        }
      } catch {
        /* try next bin */
      }
    }
    return null;
  }

  sendPython(slot, payload, timeoutMs) {
    return new Promise((resolve, reject) => {
      if (!slot.alive) {
        reject(new Error("Native LP worker is not alive"));
        return;
      }
      const timer = setTimeout(() => {
        slot.pending.delete(payload.id);
        reject(new Error("Native LP worker timed out"));
      }, timeoutMs || JOB_TIMEOUT_MS);
      slot.pending.set(payload.id, {
        resolve: (msg) => {
          clearTimeout(timer);
          resolve(msg);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        }
      });
      try {
        slot.child.stdin.write(JSON.stringify(payload) + "\n");
      } catch (err) {
        clearTimeout(timer);
        slot.pending.delete(payload.id);
        reject(err);
      }
    });
  }

  startJsWorkers() {
    for (let i = 0; i < this.size; i++) {
      const worker = new Worker(JS_WORKER);
      const slot = { worker, busy: false, pending: new Map() };
      worker.on("message", (msg) => {
        const wait = slot.pending.get(msg.jobId);
        if (wait) {
          slot.pending.delete(msg.jobId);
          wait.resolve(msg);
        }
      });
      worker.on("error", (err) => {
        for (const wait of slot.pending.values()) wait.reject(err);
        slot.pending.clear();
      });
      this.jsSlots.push(slot);
    }
  }

  enqueue(task) {
    return new Promise((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
      this.pump();
    });
  }

  pump() {
    const slots = this.mode === "native" ? this.pythonSlots : this.jsSlots;
    for (const slot of slots) {
      if (this.queue.length === 0) return;
      if (this.mode === "native") {
        if (!slot.alive || slot.busy) continue;
      } else if (slot.busy) continue;
      const job = this.queue.shift();
      slot.busy = true;
      Promise.resolve()
        .then(() => job.task(slot))
        .then(job.resolve, job.reject)
        .finally(() => {
          slot.busy = false;
          this.pump();
        });
    }
  }

  async solveJsModel(model) {
    await this.ready;
    return this.enqueue(async (slot) => {
      if (this.mode === "native") {
        const id = `j${++this.jobSeq}`;
        const native = jsModelToNative(model);
        const msg = await this.sendPython(slot, { id, problem: native }, JOB_TIMEOUT_MS);
        return nativeToJsResult(msg);
      }
      const jobId = `j${++this.jobSeq}`;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          slot.pending.delete(jobId);
          reject(new Error("javascript-lp-solver worker timed out"));
        }, JOB_TIMEOUT_MS);
        slot.pending.set(jobId, {
          resolve: (msg) => {
            clearTimeout(timer);
            resolve(msg);
          },
          reject: (err) => {
            clearTimeout(timer);
            reject(err);
          }
        });
        slot.worker.postMessage({ jobId, model });
      });
    });
  }
}

const pool = new SolverPool();

async function solveJsLpModel(model) {
  try {
    return await pool.solveJsModel(model);
  } catch (err) {
    return {
      ok: false,
      status: "solver_runtime_error",
      message: err && err.message ? err.message : String(err),
      result: null,
      engine: pool.engine || pool.mode
    };
  }
}

function solverPoolInfo() {
  return {
    mode: pool.mode,
    engine: pool.engine,
    workers: pool.size
  };
}

module.exports = {
  solveJsLpModel,
  jsModelToNative,
  solverPoolInfo
};
