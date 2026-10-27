#!/usr/bin/env python3
"""Persistent native-bound LP worker (HiGHS, else OR-Tools GLOP).

One JSON object per stdin line:
  {"id": 1, "ping": true}
  {"id": 1, "problem": {"variables":[...], "constraints":[...], "opType":"min"}}

One JSON object per stdout line. Logs go to stderr only.
Ingredient min/max are variable bounds, not extra constraint rows.
"""
from __future__ import annotations

import json
import sys
import traceback

def _log(msg: str) -> None:
    sys.stderr.write(msg + "\n")
    sys.stderr.flush()


def _pick_ortools_solver():
    from ortools.linear_solver import pywraplp

    solver = pywraplp.Solver.CreateSolver("HIGHS")
    if solver is not None:
        return solver, "highs"
    solver = pywraplp.Solver.CreateSolver("GLOP")
    if solver is not None:
        return solver, "glop"
    return None, None


_ENGINE = None
_ENGINE_KIND = None


def _warm_engine():
    global _ENGINE, _ENGINE_KIND
    if _ENGINE_KIND:
        return _ENGINE_KIND
    try:
        solver, kind = _pick_ortools_solver()
        if solver is not None:
            _ENGINE = "ortools"
            _ENGINE_KIND = kind
            return _ENGINE_KIND
    except Exception as exc:
        _log(f"[native_lp_worker] ortools unavailable: {exc}")
    _ENGINE = None
    _ENGINE_KIND = None
    return None


def solve_problem(problem: dict) -> dict:
    kind = _warm_engine()
    if not kind:
        return {
            "ok": False,
            "status": "SOLVER_NOT_AVAILABLE",
            "engine": None,
            "error": "Neither OR-Tools HiGHS nor GLOP is available.",
        }

    from ortools.linear_solver import pywraplp

    solver, kind = _pick_ortools_solver()
    if solver is None:
        return {
            "ok": False,
            "status": "SOLVER_NOT_AVAILABLE",
            "engine": None,
            "error": "Failed to create OR-Tools solver.",
        }

    try:
        solver.SetSolverSpecificParametersAsString(
            "output_flag=false\nprimal_feasibility_tolerance=1e-8\ndual_feasibility_tolerance=1e-8"
        )
    except Exception:
        pass
    inf = solver.infinity()
    variables = problem.get("variables") or []
    constraints = problem.get("constraints") or []
    op_type = str(problem.get("opType") or "min").lower()

    var_map = {}
    for i, spec in enumerate(variables):
        orig = spec.get("id")
        if orig is None:
            continue
        lb = spec.get("lb")
        ub = spec.get("ub")
        lower = 0.0 if lb is None else float(lb)
        upper = inf if ub is None else float(ub)
        if upper < lower:
            upper = lower
        var_map[str(orig)] = solver.NumVar(lower, upper, f"x{i}")

    constraint_refs = []
    for idx, row in enumerate(constraints):
        coeffs = row.get("coeffs") or {}
        try:
            rhs = float(row.get("rhs"))
        except (TypeError, ValueError):
            continue
        sense = str(row.get("sense") or "=")
        if sense not in ("=", ">=", "<="):
            continue
        terms = []
        for vname, coef in coeffs.items():
            var = var_map.get(str(vname))
            if var is None:
                continue
            try:
                c = float(coef)
            except (TypeError, ValueError):
                continue
            if c == 0:
                continue
            terms.append((var, c))
        if not terms:
            continue
        name = str(row.get("name") or f"c{idx}")
        if sense == "=":
            ct = solver.Constraint(rhs, rhs, name)
        elif sense == ">=":
            ct = solver.Constraint(rhs, inf, name)
        else:
            ct = solver.Constraint(-inf, rhs, name)
        for var, c in terms:
            ct.SetCoefficient(var, c)
        constraint_refs.append((name, ct))

    obj = solver.Objective()
    for spec in variables:
        orig = spec.get("id")
        var = var_map.get(str(orig)) if orig is not None else None
        if var is None:
            continue
        try:
            coef = float(spec.get("obj") or 0)
        except (TypeError, ValueError):
            coef = 0.0
        obj.SetCoefficient(var, coef)
    if op_type == "max":
        obj.SetMaximization()
    else:
        obj.SetMinimization()

    status = solver.Solve()
    status_map = {
        pywraplp.Solver.OPTIMAL: "OPTIMAL",
        pywraplp.Solver.FEASIBLE: "FEASIBLE",
        pywraplp.Solver.INFEASIBLE: "INFEASIBLE",
        pywraplp.Solver.UNBOUNDED: "UNBOUNDED",
        pywraplp.Solver.ABNORMAL: "ABNORMAL",
        pywraplp.Solver.NOT_SOLVED: "NOT_SOLVED",
    }
    label = status_map.get(status, f"STATUS_{status}")
    feasible = status in (pywraplp.Solver.OPTIMAL, pywraplp.Solver.FEASIBLE)
    values = {}
    duals = {}
    reduced_costs = {}
    objective = None
    if feasible:
        objective = obj.Value()
        for orig, var in var_map.items():
            values[orig] = var.solution_value()
            try:
                reduced_costs[orig] = var.reduced_cost()
            except Exception:
                try:
                    reduced_costs[orig] = var.ReducedCost()
                except Exception:
                    pass
        for name, ct in constraint_refs:
            try:
                duals[name] = ct.dual_value()
            except Exception:
                try:
                    duals[name] = ct.DualValue()
                except Exception:
                    pass

    return {
        "ok": True,
        "status": label,
        "engine": kind,
        "feasible": feasible,
        "objective": objective,
        "values": values,
        "duals": duals,
        "reduced_costs": reduced_costs,
    }


def main() -> None:
    engine = _warm_engine()
    _log(f"[native_lp_worker] ready engine={engine or 'none'}")
    for raw in sys.stdin:
        line = raw.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError as exc:
            sys.stdout.write(json.dumps({"id": None, "ok": False, "error": f"bad json: {exc}"}) + "\n")
            sys.stdout.flush()
            continue
        job_id = msg.get("id")
        try:
            if msg.get("ping"):
                out = {
                    "id": job_id,
                    "ok": True,
                    "pong": True,
                    "engine": _ENGINE_KIND,
                }
            else:
                result = solve_problem(msg.get("problem") or {})
                out = {"id": job_id, **result}
        except Exception as exc:
            out = {
                "id": job_id,
                "ok": False,
                "status": "WORKER_EXCEPTION",
                "engine": _ENGINE_KIND,
                "error": str(exc),
                "trace": traceback.format_exc()[-800:],
            }
        sys.stdout.write(json.dumps(out, allow_nan=False) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
