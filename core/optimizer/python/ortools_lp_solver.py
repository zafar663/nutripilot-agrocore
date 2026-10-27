import json
import sys
from ortools.linear_solver import pywraplp

def solve_model(payload):
    variables = payload.get("variables", [])
    rows = payload.get("rows", {})
    objective = payload.get("objective", {})

    solver = pywraplp.Solver.CreateSolver("GLOP")
    if solver is None:
        return {
            "ok": False,
            "solver_status": "SOLVER_NOT_AVAILABLE",
            "objective_value": None,
            "variable_values": {},
            "notes": ["Failed to create OR-Tools GLOP solver."]
        }

    var_map = {}
    for v in variables:
        name = v["var_name"]
        lb = float(v.get("lower_bound", 0))
        ub = float(v.get("upper_bound", 100))
        var_map[name] = solver.NumVar(lb, ub, name)

    total_row = rows.get("formula_total")
    if total_row:
        expr = solver.Sum(
            coef * var_map[name]
            for name, coef in total_row.get("coefficients", {}).items()
            if coef is not None and name in var_map
        )
        rhs = float(total_row["rhs"])
        op = total_row["operator"]
        if op == "=":
            solver.Add(expr == rhs)
        elif op == ">=":
            solver.Add(expr >= rhs)
        elif op == "<=":
            solver.Add(expr <= rhs)

    for row in rows.get("nutrient_hard", []):
        coeffs = row.get("coefficients", {})
        expr = solver.Sum(
            (coef / 100.0) * var_map[name]
            for name, coef in coeffs.items()
            if coef is not None and name in var_map
        )
        rhs = float(row["rhs"])
        op = row["operator"]

        if op == "=":
            solver.Add(expr == rhs)
        elif op == ">=":
            solver.Add(expr >= rhs)
        elif op == "<=":
            solver.Add(expr <= rhs)
        else:
            return {
                "ok": False,
                "solver_status": "UNSUPPORTED_OPERATOR",
                "objective_value": None,
                "variable_values": {},
                "notes": [f"Unsupported operator: {op}"]
            }

    obj = solver.Objective()
    for item in objective.get("cost_vector", []):
        name = item["var_name"]
        coef = item.get("coefficient")
        if coef is None:
            coef = 0.0
        if name in var_map:
            obj.SetCoefficient(var_map[name], float(coef))
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

    variable_values = {}
    reduced_costs = {}
    if status in (pywraplp.Solver.OPTIMAL, pywraplp.Solver.FEASIBLE):
        for name, var in var_map.items():
            variable_values[name] = var.solution_value()
        # Reduced costs: available only at OPTIMAL; FEASIBLE may not expose them
        if status == pywraplp.Solver.OPTIMAL:
            try:
                for name, var in var_map.items():
                    reduced_costs[name] = var.ReducedCost()
            except Exception:
                reduced_costs = {}

    return {
        "ok": status in (pywraplp.Solver.OPTIMAL, pywraplp.Solver.FEASIBLE),
        "solver_status": status_map.get(status, f"STATUS_{status}"),
        "objective_value": obj.Value() if status in (pywraplp.Solver.OPTIMAL, pywraplp.Solver.FEASIBLE) else None,
        "variable_values": variable_values,
        "reduced_costs": reduced_costs,
        "notes": ["OR-Tools GLOP solve executed."]
    }

def main():
    raw = sys.stdin.read()
    payload = json.loads(raw)
    result = solve_model(payload)
    sys.stdout.write(json.dumps(result))

if __name__ == "__main__":
    main()
