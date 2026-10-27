"use strict";
/**
 * Rabbit (Oryctolagus cuniculus) Requirements Engine
 * Source: NRC 1977 (Nutrient Requirements of Rabbits) + De Blas & Wiseman 2010
 *         "The Nutrition of the Rabbit" (CABI 2nd ed.) + INRA/AFZ 2004
 * Standard Label: "NRC 1977 + De Blas & Wiseman 2010"
 *
 * Rabbit is a hindgut fermenter — cecotrophy provides B-vitamins in practice.
 * Fiber (ADF, NDF) is critical for gut motility and enteritis prevention.
 * Energy system: Digestible Energy (DE, kcal/kg) per NRC/INRA convention.
 * Phases: growing (weaning to market), gestation, lactation, maintenance.
 */
function num(v,f=0){const n=Number(v);return Number.isFinite(n)?n:f;}
function round(v,d=4){const n=Number(v);if(!Number.isFinite(n))return null;return Number(n.toFixed(d));}

const STATIC_REQUIREMENTS = {
  growing: {
    label:"Rabbit — Growing (weaning–market, 3–12 wk)", production:"growing", phase:"growing",
    energy:{de_kcal_kg:2500, de_mj_kg:10.5},
    protein:{dp_pct:13, cp_pct:16, lys:0.65, met:0.30, met_cys:0.55, thr:0.55, arg:0.90, ile:0.60, leu:1.05, val:0.70, trp:0.18, his:0.35},
    fiber:{crude_fiber_pct:14, adf_pct:16, ndf_pct:32},
    lipids:{total_lipid_pct:2.5},
    minerals:{ca_pct:0.60, p_pct:0.40, avail_p_pct:0.22, mg_pct:0.30, k_pct:0.60, na_pct:0.22, cl_pct:0.35, fe_ppm:50, zn_ppm:50, mn_ppm:8.5, cu_ppm:5, se_ppm:0.05, i_ppm:0.20},
    vitamins:{vit_a_iu_kg:6000, vit_d_iu_kg:900, vit_e_mg_kg:50},
    feed_management:{fcr_target:3.0, feeding_rate_pct_bw:4, feeds_per_day:2},
  },
  gestation: {
    label:"Rabbit — Doe, Gestation", production:"gestation", phase:"gestation",
    energy:{de_kcal_kg:2500, de_mj_kg:10.5},
    protein:{dp_pct:12, cp_pct:15, lys:0.60, met:0.28, met_cys:0.50, thr:0.52, arg:0.85, ile:0.55, leu:1.00, val:0.65, trp:0.16, his:0.32},
    fiber:{crude_fiber_pct:15, adf_pct:17, ndf_pct:34},
    lipids:{total_lipid_pct:2.5},
    minerals:{ca_pct:0.80, p_pct:0.50, avail_p_pct:0.28, mg_pct:0.32, k_pct:0.65, na_pct:0.22, cl_pct:0.35, fe_ppm:50, zn_ppm:50, mn_ppm:8.5, cu_ppm:5, se_ppm:0.05, i_ppm:0.20},
    vitamins:{vit_a_iu_kg:8000, vit_d_iu_kg:1000, vit_e_mg_kg:60},
    feed_management:{fcr_target:null, feeding_rate_pct_bw:3.5, feeds_per_day:2},
  },
  lactation: {
    label:"Rabbit — Doe, Lactation (peak demand)", production:"lactation", phase:"lactation",
    energy:{de_kcal_kg:2700, de_mj_kg:11.3},
    protein:{dp_pct:15, cp_pct:18, lys:0.78, met:0.35, met_cys:0.60, thr:0.63, arg:1.00, ile:0.72, leu:1.20, val:0.80, trp:0.22, his:0.40},
    fiber:{crude_fiber_pct:12, adf_pct:14, ndf_pct:28},
    lipids:{total_lipid_pct:3.0},
    minerals:{ca_pct:1.10, p_pct:0.80, avail_p_pct:0.45, mg_pct:0.35, k_pct:0.80, na_pct:0.25, cl_pct:0.40, fe_ppm:55, zn_ppm:60, mn_ppm:10, cu_ppm:6, se_ppm:0.06, i_ppm:0.22},
    vitamins:{vit_a_iu_kg:8000, vit_d_iu_kg:1100, vit_e_mg_kg:70},
    feed_management:{fcr_target:null, feeding_rate_pct_bw:8, feeds_per_day:2},
  },
  maintenance: {
    label:"Rabbit — Adult Maintenance (non-reproducing)", production:"maintenance", phase:"maintenance",
    energy:{de_kcal_kg:2100, de_mj_kg:8.8},
    protein:{dp_pct:10, cp_pct:13, lys:0.45, met:0.22, met_cys:0.40, thr:0.40, arg:0.60, ile:0.42, leu:0.75, val:0.50, trp:0.12, his:0.24},
    fiber:{crude_fiber_pct:16, adf_pct:18, ndf_pct:36},
    lipids:{total_lipid_pct:2.0},
    minerals:{ca_pct:0.40, p_pct:0.30, avail_p_pct:0.17, mg_pct:0.25, k_pct:0.50, na_pct:0.18, cl_pct:0.30, fe_ppm:40, zn_ppm:40, mn_ppm:7, cu_ppm:4, se_ppm:0.04, i_ppm:0.18},
    vitamins:{vit_a_iu_kg:5000, vit_d_iu_kg:800, vit_e_mg_kg:40},
    feed_management:{fcr_target:null, feeding_rate_pct_bw:3, feeds_per_day:2},
  },
};

const PHASE_MAP = {
  growing:1, grower:'growing', grow_out:'growing', juvenile:'growing', weaning:'growing', market:'growing', finishing:'growing',
  gestation:1, pregnant:'gestation', breeding:'gestation',
  lactation:1, nursing:'lactation', milking:'lactation',
  maintenance:1, adult:'maintenance', dry:'maintenance',
};

function resolvePhaseKey(production,phase){
  const pr=String(production||'').toLowerCase();
  const ph=String(phase||'').toLowerCase();
  if(STATIC_REQUIREMENTS[ph]) return ph;
  if(STATIC_REQUIREMENTS[pr]) return pr;
  const mapped=PHASE_MAP[ph]||PHASE_MAP[pr];
  if(mapped && mapped!==1 && STATIC_REQUIREMENTS[mapped]) return mapped;
  return 'growing';
}

function flatten(t){
  if(!t) return {ok:false,error:'PHASE_NOT_FOUND'};
  return {
    ok:true, mode:'static', standard:'NRC_1977_DeBlas_Wiseman_2010',
    species:'rabbit', species_name:'Oryctolagus cuniculus', label:t.label,
    // Energy — rabbit uses DE; map to `me` so workspace STD column populates
    me:t.energy?.de_kcal_kg??null,
    de_kcal_kg:t.energy?.de_kcal_kg??null, de_mj_kg:t.energy?.de_mj_kg??null,
    // Protein & digestible protein
    cp:t.protein?.cp_pct??null, dp_pct:t.protein?.dp_pct??null,
    // Amino acids — workspace registry keys (total_*)
    total_lys:t.protein?.lys??null, total_met:t.protein?.met??null,
    total_metcys:t.protein?.met_cys??null, total_thr:t.protein?.thr??null,
    total_arg:t.protein?.arg??null, total_ile:t.protein?.ile??null,
    total_leu:t.protein?.leu??null, total_val:t.protein?.val??null,
    total_trp:t.protein?.trp??null, total_his:t.protein?.his??null,
    // Fat & fiber
    ee:t.lipids?.total_lipid_pct??null,
    cf:t.fiber?.crude_fiber_pct??null,
    adf:t.fiber?.adf_pct??null, ndf:t.fiber?.ndf_pct??null,
    // Macro minerals
    ca:t.minerals?.ca_pct??null, total_p:t.minerals?.p_pct??null,
    avp:t.minerals?.avail_p_pct??null,
    mg:t.minerals?.mg_pct??null, k:t.minerals?.k_pct??null,
    na:t.minerals?.na_pct??null, cl:t.minerals?.cl_pct??null,
    // Trace minerals — workspace registry keys (no _ppm suffix)
    fe:t.minerals?.fe_ppm??null, zn:t.minerals?.zn_ppm??null,
    mn:t.minerals?.mn_ppm??null, cu:t.minerals?.cu_ppm??null,
    se:t.minerals?.se_ppm??null, i:t.minerals?.i_ppm??null,
    // Vitamins
    vit_a:t.vitamins?.vit_a_iu_kg??null,
    vit_d3:t.vitamins?.vit_d_iu_kg??null,
    vit_e:t.vitamins?.vit_e_mg_kg??null,
    fcr_target:t.feed_management?.fcr_target??null,
    feeding_rate_pct_bw:t.feed_management?.feeding_rate_pct_bw??null,
  };
}

function resolveRabbitRequirements(context={}){
  try{
    const k=resolvePhaseKey(context.production,context.phase);
    return flatten(STATIC_REQUIREMENTS[k]);
  }catch(e){return{ok:false,error:'RABBIT_ENGINE_ERROR',message:e.message};}
}
module.exports={resolveRabbitRequirements,STATIC_REQUIREMENTS};
