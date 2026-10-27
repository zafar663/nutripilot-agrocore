'use strict';

/**
 * Joint mill-book allocation LP.
 * Variables are kilograms of ingredient i in formula f (and optional tons[f]).
 * Stock is shared. Nutrition is per formula. Premix children explode when
 * parent tons and premix rates are fixed.
 */

const { resolveUsableTonnes, farmPlanTons } = require('./allocate.rhs.service.cjs');

function num(v, d = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function round4(v) {
  const n = num(v, 0);
  return Math.round(n * 1e4) / 1e4;
}

function keyOf(name, id) {
  return String(name || id || '').trim().toLowerCase();
}

function safeId(s) {
  return String(s || 'x').replace(/[^a-zA-Z0-9]/g, '_').slice(0, 40);
}

function loadLp() {
  try {
    return require('javascript-lp-solver');
  } catch {
    return null;
  }
}

const NUTRIENT_KEYS = [
  'dm','moisture','me','me_mj','de_mcal_kg','amen','ne',
  'cp','ee','cf','ash','starch','sugars','ndf','adf','lignin',
  'ca','total_p','avp','na','k','cl','mg','s',
  'total_lys','total_met','total_cys','total_metcys','total_thr','total_trp',
  'total_arg','total_val','total_ile','total_leu',
  'sid_lys','sid_met','sid_cys','sid_metcys','sid_thr','sid_trp',
  'sid_arg','sid_val','sid_ile','sid_leu',
  'fe','zn','mn','cu','se','vit_a','vit_d3','vit_e'
];

function pickNutrients(src) {
  const out = {};
  if (!src || typeof src !== 'object') return out;
  const bag = src.nutrients && typeof src.nutrients === 'object' ? { ...src, ...src.nutrients } : src;
  for (const k of NUTRIENT_KEYS) {
    const v = num(bag[k], null);
    if (v != null) out[k] = v;
  }
  return out;
}

function normalizeFormula(raw, idx) {
  const tons = Math.max(0, num(raw.tons, 1) || 0);
  const ings = [];
  for (const row of raw.ingredients || raw.formula_rows || []) {
    const name = String(row.display_name || row.ingredient_name || row.name || '').trim();
    const id = String(row.id || row.ingredient_id || name);
    if (!name && !id) continue;
    if (row.enabled === false || row.included === false) continue;
    const nutrients = pickNutrients(row);
    const inclusion = num(row.inclusion ?? row.optimized_inclusion, 0) || 0;
    const locked = !!(row.locked || row.lock);
    const min = locked ? inclusion : num(row.min, 0);
    const max = locked ? inclusion : num(row.max, 100);
    const bagKg = num(row.bag_kg, null);
    ings.push({
      id,
      name,
      key: keyOf(name, id),
      cost: num(row.cost, 0) || 0,
      min: min == null ? 0 : min,
      max: max == null ? 100 : max,
      locked,
      inclusion,
      nutrients,
      integer: !!(row.integer || bagKg),
      bag_kg: bagKg || (row.integer ? 25 : null),
      premix_formula_id: row.premix_formula_id || row.premix_id || null,
      premix_mix: Array.isArray(row.premix_mix) ? row.premix_mix : null
    });
  }
  const constraints = [];
  for (const c of raw.constraints || raw.target_profile || []) {
    const key = String(c.key || c.nutrient || '').toLowerCase();
    if (!key) continue;
    constraints.push({
      key,
      min: num(c.min, null),
      max: num(c.max, null),
      target: num(c.target ?? c.std, null)
    });
  }
  const ratios = (raw.true_ratio_constraints || raw.ratio_rows || [])
    .filter(r => r && r.key && r.source && num(r.factor, 0))
    .map(r => ({
      key: String(r.key).toLowerCase(),
      source: String(r.source).toLowerCase(),
      factor: num(r.factor, 1),
      op: r.op || '≥'
    }));
  return {
    idx,
    id: raw.id || `f${idx}`,
    code: raw.code || raw.formula_id || raw.id || `F${idx + 1}`,
    name: raw.name || raw.formula_name || raw.code || `Formula ${idx + 1}`,
    tons,
    min_tons: num(raw.min_tons, tons),
    max_tons: num(raw.max_tons, tons),
    sell_price: num(raw.sell_price ?? raw.iofc_per_ton, null),
    ingredients: ings,
    constraints,
    ratios,
    is_premix: !!raw.is_premix
  };
}

function mergePremixChildren(formulas) {
  const children = [];
  for (const f of formulas) {
    for (const ing of f.ingredients) {
      if (!ing.premix_mix || !ing.premix_mix.length) continue;
      const cid = `pmx_${safeId(ing.premix_formula_id || ing.key)}`;
      if (children.some(c => c.id === cid)) continue;
      const childIngs = ing.premix_mix.map((m, i) => ({
        id: m.id || m.ingredient_id || m.name || `pmxrow${i}`,
        name: m.name || m.ingredient_name || `src${i}`,
        key: keyOf(m.name, m.id),
        cost: num(m.cost, 0) || 0,
        min: num(m.min, 0) || 0,
        max: num(m.max, 100) || 100,
        locked: false,
        inclusion: num(m.pct ?? m.inclusion, 0) || 0,
        nutrients: pickNutrients(m),
        integer: false,
        bag_kg: null,
        premix_formula_id: null,
        premix_mix: null
      }));
      const premixTons = formulas.reduce((s, pf) => {
        const hit = pf.ingredients.find(x => (x.premix_formula_id || x.premix_id) && keyOf(x.premix_formula_id || x.key) === keyOf(ing.premix_formula_id, ing.key));
        if (!hit) return s;
        return s + pf.tons * (num(hit.inclusion, 0) || 0) / 100;
      }, 0);
      children.push({
        idx: formulas.length + children.length,
        id: cid,
        code: ing.name,
        name: ing.name,
        tons: Math.max(premixTons, 0.0001),
        min_tons: Math.max(premixTons, 0.0001),
        max_tons: Math.max(premixTons, 0.0001),
        sell_price: null,
        ingredients: childIngs,
        constraints: [],
        ratios: [],
        is_premix: true,
        parent_rates: formulas.map(pf => {
          const hit = pf.ingredients.find(x => x.premix_mix && keyOf(x.premix_formula_id || x.key) === keyOf(ing.premix_formula_id, ing.key));
          return { formula_idx: pf.idx, rate: hit ? (num(hit.inclusion, 0) || 0) / 100 : 0 };
        }).filter(x => x.rate > 0)
      });
      ing._child_id = cid;
    }
  }
  return children;
}

function addVar(model, name, obj, bounds, extra) {
  const v = { cost: obj || 0, ...(extra || {}) };
  if (bounds && bounds.min != null) {
    const c = `lo_${name}`;
    model.constraints[c] = { min: bounds.min };
    v[c] = 1;
  }
  if (bounds && bounds.max != null) {
    const c = `up_${name}`;
    model.constraints[c] = { max: bounds.max };
    v[c] = 1;
  }
  model.variables[name] = v;
}

function bump(model, varName, consName, coef) {
  if (!model.variables[varName]) return;
  const cur = num(model.variables[varName][consName], 0) || 0;
  model.variables[varName][consName] = cur + coef;
}

function solveModel(model) {
  const lp = loadLp();
  if (!lp || typeof lp.Solve !== 'function') {
    return { ok: false, status: 'solver_not_available', result: null };
  }
  try {
    const result = lp.Solve(model);
    const infeasible = result?.feasible === false || result?.result === 'Infeasible';
    return { ok: !infeasible && !!result, status: infeasible ? 'infeasible' : 'solved', result };
  } catch (err) {
    return { ok: false, status: 'solver_runtime_error', message: err.message, result: null };
  }
}

function buildAndSolve(formulas, stockMap, options) {
  const mode = options.mode || 'least_cost';
  const maxUseKey = keyOf(options.max_use_ingredient);
  const minNeedKey = keyOf(options.min_need_ingredient);
  const variableTons = mode === 'max_return';
  const earlyShare = num(options.early_share, null);
  const model = { optimize: 'cost', opType: 'min', constraints: {}, variables: {} };

  const STOCK_PENALTY = 5e5;
  const NUT_PENALTY = 2e4;
  const MASS_PENALTY = 1e6;

  const varW = {}; // `${fi}_${ikey}` → w name
  const tonsVar = {};

  for (const f of formulas) {
    if (variableTons) {
      const tv = `t_${f.idx}`;
      tonsVar[f.idx] = tv;
      addVar(model, tv, -(num(f.sell_price, 0) || 0), {
        min: Math.max(0, num(f.min_tons, 0) || 0),
        max: Math.max(num(f.max_tons, f.tons) || f.tons, 0.01)
      });
    }
    const massName = `mass_${f.idx}`;
    if (variableTons) {
      model.constraints[massName] = { equal: 0 };
      bump(model, tonsVar[f.idx], massName, -1000);
    } else {
      model.constraints[massName] = { equal: f.tons * 1000 };
    }

    for (const ing of f.ingredients) {
      if (ing.premix_mix && ing.premix_mix.length) continue;
      const w = `w_${f.idx}_${safeId(ing.key)}`;
      varW[`${f.idx}:${ing.key}`] = w;
      let obj = ing.cost;
      if (mode === 'max_use' && maxUseKey && ing.key === maxUseKey) obj = -1;
      if (mode === 'min_need' && minNeedKey && ing.key === minNeedKey) obj = 1;
      const extra = {};
      if (ing.integer && ing.bag_kg > 0) extra.int = 1;
      const bag = (ing.integer && ing.bag_kg > 0) ? ing.bag_kg : 1;
      addVar(model, w, obj * bag, { min: 0 }, extra);
      bump(model, w, massName, bag);

      const tonsRef = f.tons;
      if (!variableTons) {
        const lo = (ing.min / 100) * tonsRef * 1000 / bag;
        const hi = (ing.max / 100) * tonsRef * 1000 / bag;
        if (ing.locked) {
          const eq = `lk_${f.idx}_${safeId(ing.key)}`;
          model.constraints[eq] = { equal: (ing.inclusion / 100) * tonsRef * 1000 / bag };
          bump(model, w, eq, 1);
        } else {
          if (ing.min > 0) {
            const c = `imin_${f.idx}_${safeId(ing.key)}`;
            model.constraints[c] = { min: lo };
            bump(model, w, c, 1);
          }
          if (ing.max < 100) {
            const c = `imax_${f.idx}_${safeId(ing.key)}`;
            model.constraints[c] = { max: hi };
            bump(model, w, c, 1);
          }
        }
      } else {
        const cmin = `imin_${f.idx}_${safeId(ing.key)}`;
        const cmax = `imax_${f.idx}_${safeId(ing.key)}`;
        model.constraints[cmin] = { min: 0 };
        model.constraints[cmax] = { min: 0 };
        bump(model, w, cmin, bag);
        bump(model, tonsVar[f.idx], cmin, -(ing.min / 100) * 1000);
        bump(model, tonsVar[f.idx], cmax, (ing.max / 100) * 1000);
        bump(model, w, cmax, -bag);
      }
    }

    for (const c of f.constraints) {
      const has = f.ingredients.some(ing => ing.nutrients[c.key] != null);
      if (!has) continue;
      if (c.min != null) {
        const cn = `nmin_${f.idx}_${safeId(c.key)}`;
        const slack = `sln_${f.idx}_${safeId(c.key)}`;
        addVar(model, slack, NUT_PENALTY, { min: 0 });
        if (variableTons) {
          model.constraints[cn] = { min: 0 };
          bump(model, tonsVar[f.idx], cn, -c.min * 1000);
        } else {
          model.constraints[cn] = { min: c.min * f.tons * 1000 };
        }
        bump(model, slack, cn, 1);
        for (const ing of f.ingredients) {
          if (ing.premix_mix && ing.premix_mix.length) continue;
          const w = varW[`${f.idx}:${ing.key}`];
          const nut = num(ing.nutrients[c.key], 0) || 0;
          const bag = (ing.integer && ing.bag_kg > 0) ? ing.bag_kg : 1;
          if (w && nut) bump(model, w, cn, nut * bag);
        }
      }
      if (c.max != null) {
        const cn = `nmax_${f.idx}_${safeId(c.key)}`;
        const slack = `sxn_${f.idx}_${safeId(c.key)}`;
        addVar(model, slack, NUT_PENALTY, { min: 0 });
        if (variableTons) {
          model.constraints[cn] = { max: 0 };
          bump(model, tonsVar[f.idx], cn, -c.max * 1000);
        } else {
          model.constraints[cn] = { max: c.max * f.tons * 1000 };
        }
        bump(model, slack, cn, -1);
        for (const ing of f.ingredients) {
          if (ing.premix_mix && ing.premix_mix.length) continue;
          const w = varW[`${f.idx}:${ing.key}`];
          const nut = num(ing.nutrients[c.key], 0) || 0;
          const bag = (ing.integer && ing.bag_kg > 0) ? ing.bag_kg : 1;
          if (w && nut) bump(model, w, cn, nut * bag);
        }
      }
    }

    for (const r of f.ratios) {
      const cn = `ratio_${f.idx}_${safeId(r.key)}_${safeId(r.source)}`;
      if (r.op === '≤' || r.op === '<=') model.constraints[cn] = { max: 0 };
      else if (r.op === '=' || r.op === '==') model.constraints[cn] = { equal: 0 };
      else model.constraints[cn] = { min: 0 };
      for (const ing of f.ingredients) {
        if (ing.premix_mix && ing.premix_mix.length) continue;
        const w = varW[`${f.idx}:${ing.key}`];
        const kv = num(ing.nutrients[r.key], 0) || 0;
        const sv = num(ing.nutrients[r.source], 0) || 0;
        const bag = (ing.integer && ing.bag_kg > 0) ? ing.bag_kg : 1;
        const coef = (kv - r.factor * sv) * bag;
        if (w && coef) bump(model, w, cn, coef);
      }
    }
  }

  // Premix explode: parent nutrients get child contribution (fixed tons only)
  for (const child of formulas.filter(f => f.is_premix)) {
    for (const link of child.parent_rates || []) {
      const parent = formulas.find(p => p.idx === link.formula_idx);
      if (!parent || variableTons) continue;
      const share = child.tons > 0 ? (link.rate * parent.tons) / child.tons : 0;
      for (const c of parent.constraints) {
        if (c.min == null && c.max == null) continue;
        const cn = c.min != null ? `nmin_${parent.idx}_${safeId(c.key)}` : `nmax_${parent.idx}_${safeId(c.key)}`;
        for (const ing of child.ingredients) {
          const w = varW[`${child.idx}:${ing.key}`];
          const nut = num(ing.nutrients[c.key], 0) || 0;
          if (w && nut && share) bump(model, w, cn, nut * share);
        }
      }
    }
  }

    const stockCons = [];
  for (const [k, st] of stockMap.entries()) {
    const mustKg = num(st.must_use_t, 0) * 1000;
    if (mustKg > 0) {
      const cnM = `stkm_${safeId(k)}`;
      model.constraints[cnM] = { min: mustKg };
      for (const f of formulas) {
        for (const ing of f.ingredients) {
          if (ing.key !== k || (ing.premix_mix && ing.premix_mix.length)) continue;
          const w = varW[`${f.idx}:${ing.key}`];
          const bag = (ing.integer && ing.bag_kg > 0) ? ing.bag_kg : 1;
          if (w) bump(model, w, cnM, bag);
        }
      }
    }

    const capKg = Math.max(0, (num(st.usable_t, 0) + (options.use_inbound ? num(st.inbound_t, 0) : 0)) * 1000);
    if (!(capKg > 0) && mode === 'min_need' && k === minNeedKey) {
      // no cap — we minimize use
      continue;
    }
    if (st.unlimited) continue;
    if (!(capKg > 0) && mode !== 'min_need') continue;
    const cn = `stk_${safeId(k)}`;
    const slack = `ssk_${safeId(k)}`;
    if (!options.hard_stock) addVar(model, slack, STOCK_PENALTY, { min: 0 });
    model.constraints[cn] = { max: capKg };
    if (!options.hard_stock) bump(model, slack, cn, -1);
    for (const f of formulas) {
      for (const ing of f.ingredients) {
        if (ing.key !== k) continue;
        if (ing.premix_mix && ing.premix_mix.length) continue;
        const w = varW[`${f.idx}:${ing.key}`];
        const bag = (ing.integer && ing.bag_kg > 0) ? ing.bag_kg : 1;
        if (w) bump(model, w, cn, bag);
      }
    }
    stockCons.push({ key: k, name: st.name, cn, capKg, slack });

    if (earlyShare != null && earlyShare > 0 && earlyShare < 1 && st.usable_t > 0) {
      const cnE = `stke_${safeId(k)}`;
      const slackE = `sske_${safeId(k)}`;
      addVar(model, slackE, STOCK_PENALTY, { min: 0 });
      model.constraints[cnE] = { max: num(st.usable_t, 0) * 1000 };
      bump(model, slackE, cnE, -1);
      for (const f of formulas) {
        for (const ing of f.ingredients) {
          if (ing.key !== k || (ing.premix_mix && ing.premix_mix.length)) continue;
          const w = varW[`${f.idx}:${ing.key}`];
          const bag = (ing.integer && ing.bag_kg > 0) ? ing.bag_kg : 1;
          if (w) bump(model, w, cnE, bag * earlyShare);
        }
      }
    }
  }

  const massSlack = `smass`;
  addVar(model, massSlack, MASS_PENALTY, { min: 0 });

  const solve = solveModel(model);
  return { model, solve, varW, tonsVar, stockCons, variableTons };
}

function readKg(result, varW, fi, key, ing) {
  const w = varW[`${fi}:${key}`];
  if (!w || !result) return 0;
  const bag = (ing && ing.integer && ing.bag_kg > 0) ? ing.bag_kg : 1;
  return (num(result[w], 0) || 0) * bag;
}

function extract(formulas, stockMap, pack, options) {
  const { solve, varW, tonsVar, stockCons, variableTons } = pack;
  const raw = solve.result || {};
  const formulasOut = [];
  let bookCost = 0;
  let bookTons = 0;

  for (const f of formulas) {
    if (f.is_premix) continue;
    const tons = variableTons ? (num(raw[tonsVar[f.idx]], f.tons) || 0) : f.tons;
    const rows = [];
    let costPerKg = 0;
    for (const ing of f.ingredients) {
      let kg = 0;
      if (ing.premix_mix && ing.premix_mix.length) {
        kg = (ing.inclusion / 100) * tons * 1000;
      } else {
        kg = readKg(raw, varW, f.idx, ing.key, ing);
      }
      const pct = tons > 0 ? (kg / (tons * 1000)) * 100 : 0;
      costPerKg += (pct / 100) * ing.cost;
      rows.push({
        ingredient_id: ing.id,
        ingredient_name: ing.name,
        pct: round4(pct),
        kg: round4(kg),
        cost: ing.cost,
        locked: ing.locked
      });
    }
    const nutrients = {};
    for (const c of f.constraints) {
      let achieved = 0;
      for (const ing of f.ingredients) {
        const row = rows.find(r => keyOf(r.ingredient_name, r.ingredient_id) === ing.key);
        const pct = row ? row.pct : 0;
        achieved += (pct / 100) * (num(ing.nutrients[c.key], 0) || 0);
      }
      const child = formulas.find(x => x.is_premix && (x.parent_rates || []).some(p => p.formula_idx === f.idx));
      if (child) {
        const link = child.parent_rates.find(p => p.formula_idx === f.idx);
        for (const ing of child.ingredients) {
          const kg = readKg(raw, varW, child.idx, ing.key, ing);
          const childPct = child.tons > 0 ? kg / (child.tons * 1000) : 0;
          achieved += (link.rate) * childPct * (num(ing.nutrients[c.key], 0) || 0);
        }
      }
      const status = (c.min != null && achieved + 1e-6 < c.min) ? 'low'
        : (c.max != null && achieved - 1e-6 > c.max) ? 'high' : 'ok';
      nutrients[c.key] = { key: c.key, min: c.min, max: c.max, achieved: round4(achieved), status };
    }
    const offSpec = Object.values(nutrients).filter(n => n.status !== 'ok').length;
    bookCost += costPerKg * tons * 1000;
    bookTons += tons;
    formulasOut.push({
      id: f.id,
      code: f.code,
      name: f.name,
      tons: round4(tons),
      cost_per_kg: round4(costPerKg),
      batch_cost: round4(costPerKg * tons * 1000),
      status: solve.ok ? 'ok' : 'infeasible',
      offSpec,
      onSpec: offSpec === 0,
      composition: rows.filter(r => r.pct > 0.001).sort((a, b) => b.pct - a.pct),
      batchRows: rows.filter(r => r.pct > 0.001),
      nutrients: Object.values(nutrients)
    });
  }

  const demand = new Map();
  const addDemand = (key, name, kg) => {
    const cur = demand.get(key) || { name, kg: 0 };
    cur.kg += kg;
    demand.set(key, cur);
  };
  for (const f of formulasOut) {
    for (const r of f.batchRows) addDemand(keyOf(r.ingredient_name, r.ingredient_id), r.ingredient_name, r.kg);
  }
  for (const child of formulas.filter(x => x.is_premix)) {
    for (const ing of child.ingredients) {
      addDemand(ing.key, ing.name, readKg(raw, varW, child.idx, ing.key, ing));
    }
  }

  const position = [];
  const keys = new Set([...demand.keys(), ...stockMap.keys()]);
  for (const k of keys) {
    const dem = demand.get(k) || { name: k, kg: 0 };
    const st = stockMap.get(k) || { name: dem.name, usable_t: null, inbound_t: 0, locked_t: 0, reserved_t: 0, stock_t: null };
    const demandT = dem.kg / 1000;
    const limitT = st.usable_t != null ? (num(st.usable_t, 0) + (options.use_inbound ? num(st.inbound_t, 0) : 0)) : null;
    const slackName = `ssk_${safeId(k)}`;
    const over = num(raw[slackName], 0) || 0;
    position.push({
      name: st.name || dem.name,
      demandT: round4(demandT),
      stockT: st.stock_t,
      lockedT: st.locked_t || 0,
      reservedT: st.reserved_t || 0,
      inboundT: st.inbound_t || 0,
      usableT: st.usable_t,
      limitT,
      shortT: limitT != null && demandT > limitT + 1e-6 ? round4(demandT - limitT) : 0,
      slack_kg: round4(over),
      dual_per_t: null
    });
  }
  position.sort((a, b) => b.demandT - a.demandT);

  const binding = position.filter(p => p.limitT != null && (p.shortT > 0 || Math.abs((p.demandT || 0) - p.limitT) < 0.05));
  return {
    formulas: formulasOut,
    position,
    book: {
      formulas: formulasOut.length,
      tons: round4(bookTons),
      cost: round4(bookCost),
      binding: binding.map(b => b.name)
    },
    infeasible: !solve.ok,
    infeasibility: !solve.ok ? {
      message: solve.message || 'Book is infeasible under current stock and specs.',
      short: position.filter(p => p.shortT > 0 || p.slack_kg > 0.1).map(p => ({
        ingredient: p.name,
        extra_t: round4(Math.max(p.shortT, p.slack_kg / 1000))
      }))
    } : null
  };
}

function estimateDuals(formulas, stockMap, options, baseCost) {
  const duals = [];
  const candidates = [...stockMap.values()].filter(s => num(s.usable_t, 0) > 0).slice(0, 12);
  for (const st of candidates) {
    const bumped = new Map(stockMap);
    bumped.set(st.key, { ...st, usable_t: num(st.usable_t, 0) + 1 });
    const pack = buildAndSolve(formulas, bumped, options);
    if (!pack.solve.ok) continue;
    const extracted = extract(formulas, bumped, pack, options);
    const delta = extracted.book.cost - baseCost;
    if (!Number.isFinite(delta)) continue;
    duals.push({
      name: st.name,
      key: st.key,
      extra_t: 1,
      book_savings: round4(-delta),
      dual_per_t: round4(-delta)
    });
  }
  return duals;
}

async function runAllocate(body = {}) {
  const started = Date.now();
  const mode = String(body.mode || 'least_cost');
  const rawFormulas = Array.isArray(body.formulas) ? body.formulas : [];
  if (!rawFormulas.length) {
    return { ok: false, error: 'formulas[] is required' };
  }
  const formulas = rawFormulas.map((f, i) => normalizeFormula(f, i));
  if (mode !== 'max_return') {
    formulas.push(...mergePremixChildren(formulas));
  }

  const prices = body.prices && typeof body.prices === 'object' ? body.prices : {};
  for (const f of formulas) {
    for (const ing of f.ingredients) {
      const p = num(prices[ing.key] ?? prices[ing.name], null);
      if (p != null && p > 0) ing.cost = p;
    }
  }

  let rhs = { items: [] };
  if (body.resolve_mill_rhs && body.mill_id) {
    rhs = resolveUsableTonnes({
      mill_id: body.mill_id,
      period_start: body.period_start,
      period_end: body.period_end,
      extra_stock: body.stock
    });
  } else {
    rhs = resolveUsableTonnes({ extra_stock: body.stock || [] });
  }
  const stockMap = new Map();
  for (const it of rhs.items || []) stockMap.set(it.key, it);

  for (const lim of body.book_limits || []) {
    const k = keyOf(lim.name, lim.id);
    if (!k) continue;
    const cur = stockMap.get(k) || {
      key: k, name: lim.name || k, id: k,
      stock_t: 0, locked_t: 0, reserved_t: 0, inbound_t: 0, usable_t: null, available_t: null, source: 'limit'
    };
    const action = String(lim.use || lim.action || 'use').toLowerCase();
    if (action === 'block') {
      cur.usable_t = 0;
      cur.unlimited = false;
    }
    if (lim.available_t != null && lim.available_t !== '') {
      cur.usable_t = num(lim.available_t, 0);
      cur.unlimited = false;
    }
    if (lim.unlimited || action === 'unlimited' || action === 'market') cur.unlimited = true;
    if (lim.must_use_t != null && lim.must_use_t !== '') cur.must_use_t = num(lim.must_use_t, 0);
    if (action === 'force' && !(num(cur.must_use_t, 0) > 0)) cur.must_use_t = cur.must_use_t || 0;
    stockMap.set(k, cur);

    for (const f of formulas) {
      for (const ing of f.ingredients) {
        if (ing.key !== k) continue;
        if (action === 'block') { ing.max = 0; ing.min = 0; ing.enabled = false; }
        if (lim.max_pct != null && lim.max_pct !== '') ing.max = Math.min(ing.max, num(lim.max_pct, ing.max));
        if (lim.min_pct != null && lim.min_pct !== '') ing.min = Math.max(ing.min, num(lim.min_pct, 0));
        if (action === 'force' && ing.min <= 0) ing.min = num(lim.min_pct, 0.01);
      }
    }
  }

  const options = {
    mode,
    max_use_ingredient: body.max_use_ingredient,
    min_need_ingredient: body.min_need_ingredient,
    use_inbound: body.use_inbound !== false,
    early_share: num(body.early_share, null)
  };

  let pack = buildAndSolve(formulas, stockMap, { ...options, hard_stock: true });
  if (pack.solve.status === 'solver_not_available') {
    return { ok: false, error: 'javascript-lp-solver is not installed' };
  }
  if (!pack.solve.ok) {
    pack = buildAndSolve(formulas, stockMap, { ...options, hard_stock: false });
  }
  const extracted = extract(formulas, stockMap, pack, options);
  let duals = [];
  if (pack.solve.ok && body.compute_duals !== false && mode === 'least_cost') {
    try { duals = estimateDuals(formulas, stockMap, options, extracted.book.cost); } catch { duals = []; }
  }
  const dualByName = new Map(duals.map(d => [keyOf(d.name), d]));
  for (const p of extracted.position) {
    const d = dualByName.get(keyOf(p.name));
    if (d) p.dual_per_t = d.dual_per_t;
  }

  return {
    ok: true,
    execution_mode: 'joint',
    solver: 'javascript-lp-solver',
    mode,
    rhs,
    ...extracted,
    duals,
    elapsed_ms: Date.now() - started
  };
}

async function runBookParametric(body = {}) {
  const ingredient = String(body.ingredient || body.ingredient_name || '').trim();
  const prices = Array.isArray(body.price_points) ? body.price_points.map(Number).filter(n => Number.isFinite(n)) : [];
  if (!ingredient || !prices.length) {
    return { ok: false, error: 'ingredient and price_points[] are required' };
  }
  const runs = [];
  for (const price of prices) {
    const payload = {
      ...body,
      compute_duals: false,
      prices: { ...(body.prices || {}), [ingredient.toLowerCase()]: price, [ingredient]: price }
    };
    const r = await runAllocate(payload);
    runs.push({
      price,
      ok: !!r.ok && !r.infeasible,
      book_cost: r.book?.cost ?? null,
      tons: r.book?.tons ?? null,
      demand_t: (r.position || []).find(p => keyOf(p.name) === keyOf(ingredient))?.demandT ?? null,
      formulas: (r.formulas || []).map(f => ({
        id: f.id, code: f.code, cost_per_kg: f.cost_per_kg,
        inclusion: (f.batchRows || []).find(b => keyOf(b.ingredient_name) === keyOf(ingredient))?.pct ?? 0
      }))
    });
  }
  return { ok: true, ingredient, runs };
}

module.exports = {
  runAllocate,
  runBookParametric,
  resolveUsableTonnes,
  farmPlanTons
};
