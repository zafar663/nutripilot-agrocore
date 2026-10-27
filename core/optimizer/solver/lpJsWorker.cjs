"use strict";

const { parentPort } = require("worker_threads");

let solver = null;
try {
  solver = require("javascript-lp-solver");
} catch (err) {
  solver = null;
}

parentPort.on("message", (msg) => {
  const jobId = msg && msg.jobId;
  if (!solver || typeof solver.Solve !== "function") {
    parentPort.postMessage({
      jobId,
      ok: false,
      status: "solver_not_available",
      message: "javascript-lp-solver is not installed in the worker.",
      result: null,
      engine: "javascript-lp-solver"
    });
    return;
  }
  try {
    const result = solver.Solve(msg.model);
    parentPort.postMessage({
      jobId,
      ok: true,
      status: "solved",
      message: "LP solver executed.",
      result,
      engine: "javascript-lp-solver"
    });
  } catch (err) {
    parentPort.postMessage({
      jobId,
      ok: false,
      status: "solver_runtime_error",
      message: err && err.message ? err.message : String(err),
      result: null,
      engine: "javascript-lp-solver"
    });
  }
});
