"use strict";
/**
 * Nile Tilapia (Oreochromis niloticus) Requirements Engine
 * Source: NRC 2011 + peer-reviewed literature 2011-2024
 * Key refs: El-Sayed 2006, NRC 2011, Abdel-Tawwab 2019, FAO 2014
 */
function num(v,f=0){const n=Number(v);return Number.isFinite(n)?n:f;}
function round(v,d=4){const n=Number(v);if(!Number.isFinite(n))return null;return Number(n.toFixed(d));}

const STATIC_REQUIREMENTS = {
  fry: {
    label:"Tilapia — Fry (<1g)", production:"fry", phase:"fry",
    energy:{de_kcal_kg:3200, de_mj_kg:13.4},
    protein:{dp_pct:45, cp_pct:50, lys:2.8, met:1.0, met_cys:1.6, thr:2.0, arg:2.8, ile:2.0, leu:3.2, val:2.2, trp:0.5, his:0.9},
    lipids:{total_lipid_pct:8, linoleic_pct:1.0, epa_dha_pct:0.3},
    minerals:{ca_pct:0.7, p_pct:0.9, avail_p_pct:0.5, mg_pct:0.06, k_pct:0.80, na_pct:0.20, fe_ppm:60, zn_ppm:30, mn_ppm:12, cu_ppm:5, se_ppm:0.25, i_ppm:0.15},
    vitamins:{vit_a_iu_kg:5000, vit_d_iu_kg:1000, vit_e_mg_kg:100, vit_c_mg_kg:500, niacin_mg_kg:120, choline_mg_kg:3000, inositol_mg_kg:400},
    feed_management:{fcr_target:1.1, feeding_rate_pct_bw:10, feeds_per_day:6},
  },
  fingerling: {
    label:"Tilapia — Fingerling (1-10g)", production:"fingerling", phase:"fingerling",
    energy:{de_kcal_kg:3000, de_mj_kg:12.6},
    protein:{dp_pct:38, cp_pct:42, lys:2.4, met:0.9, met_cys:1.4, thr:1.7, arg:2.4, ile:1.7, leu:2.8, val:1.9, trp:0.4, his:0.8},
    lipids:{total_lipid_pct:7, linoleic_pct:1.0, epa_dha_pct:0.3},
    minerals:{ca_pct:0.6, p_pct:0.8, avail_p_pct:0.45, mg_pct:0.05, k_pct:0.70, na_pct:0.18, fe_ppm:50, zn_ppm:25, mn_ppm:10, cu_ppm:4, se_ppm:0.22, i_ppm:0.12},
    vitamins:{vit_a_iu_kg:4000, vit_d_iu_kg:800, vit_e_mg_kg:80, vit_c_mg_kg:300, niacin_mg_kg:100, choline_mg_kg:2500, inositol_mg_kg:300},
    feed_management:{fcr_target:1.2, feeding_rate_pct_bw:6, feeds_per_day:4},
  },
  grow_out: {
    label:"Tilapia — Grow-out (10-300g)", production:"grow_out", phase:"grow_out",
    energy:{de_kcal_kg:2800, de_mj_kg:11.7},
    protein:{dp_pct:32, cp_pct:36, lys:2.0, met:0.8, met_cys:1.2, thr:1.5, arg:2.0, ile:1.5, leu:2.4, val:1.7, trp:0.3, his:0.7},
    lipids:{total_lipid_pct:6, linoleic_pct:1.0, epa_dha_pct:0.2},
    minerals:{ca_pct:0.5, p_pct:0.7, avail_p_pct:0.40, mg_pct:0.05, k_pct:0.60, na_pct:0.15, fe_ppm:40, zn_ppm:20, mn_ppm:8, cu_ppm:3, se_ppm:0.20, i_ppm:0.10},
    vitamins:{vit_a_iu_kg:3000, vit_d_iu_kg:600, vit_e_mg_kg:60, vit_c_mg_kg:200, niacin_mg_kg:80, choline_mg_kg:2000, inositol_mg_kg:200},
    feed_management:{fcr_target:1.4, feeding_rate_pct_bw:3, feeds_per_day:3},
  },
  finishing: {
    label:"Tilapia — Finishing (>300g, pre-harvest)", production:"finishing", phase:"finishing",
    energy:{de_kcal_kg:2600, de_mj_kg:10.9},
    protein:{dp_pct:28, cp_pct:32, lys:1.8, met:0.7, met_cys:1.1, thr:1.3, arg:1.8, ile:1.3, leu:2.2, val:1.5, trp:0.3, his:0.6},
    lipids:{total_lipid_pct:6, linoleic_pct:1.0, epa_dha_pct:0.2},
    minerals:{ca_pct:0.5, p_pct:0.65, avail_p_pct:0.35, mg_pct:0.04, k_pct:0.55, na_pct:0.14, fe_ppm:35, zn_ppm:18, mn_ppm:7, cu_ppm:3, se_ppm:0.18, i_ppm:0.10},
    vitamins:{vit_a_iu_kg:2500, vit_d_iu_kg:500, vit_e_mg_kg:50, vit_c_mg_kg:150, niacin_mg_kg:70, choline_mg_kg:1800, inositol_mg_kg:150},
    feed_management:{fcr_target:1.6, feeding_rate_pct_bw:2, feeds_per_day:2},
  },
  broodstock: {
    label:"Tilapia — Broodstock", production:"broodstock", phase:"maturation",
    energy:{de_kcal_kg:3000, de_mj_kg:12.6},
    protein:{dp_pct:38, cp_pct:42, lys:2.4, met:0.9, met_cys:1.5, thr:1.8, arg:2.4, ile:1.8, leu:2.8, val:1.9, trp:0.4, his:0.8},
    lipids:{total_lipid_pct:8, linoleic_pct:1.2, epa_dha_pct:0.5},
    minerals:{ca_pct:0.7, p_pct:0.85, avail_p_pct:0.50, mg_pct:0.06, k_pct:0.75, na_pct:0.20, fe_ppm:60, zn_ppm:30, mn_ppm:12, cu_ppm:5, se_ppm:0.30, i_ppm:0.15},
    vitamins:{vit_a_iu_kg:5000, vit_d_iu_kg:1000, vit_e_mg_kg:150, vit_c_mg_kg:400, niacin_mg_kg:120, choline_mg_kg:3000, inositol_mg_kg:350},
    feed_management:{fcr_target:1.2, feeding_rate_pct_bw:3, feeds_per_day:3},
  },
};

const PHASE_MAP = {
  fry:1, larvae:1, starter:1, fingerling:1, juvenile:'fingerling',
  grow_out:1, growing:1, grower:'grow_out', intermediate:'grow_out',
  finishing:1, pre_harvest:'finishing', market:'finishing',
  broodstock:1, maturation:'broodstock', spawner:'broodstock',
};

function resolvePhaseKey(production,phase){
  const pr=String(production||'').toLowerCase();
  const ph=String(phase||'').toLowerCase();
  if(STATIC_REQUIREMENTS[ph]) return ph;
  if(STATIC_REQUIREMENTS[pr]) return pr;
  if(PHASE_MAP[ph] && STATIC_REQUIREMENTS[PHASE_MAP[ph]]) return PHASE_MAP[ph];
  return 'grow_out';
}

function flatten(table){
  if(!table) return {ok:false,error:'PHASE_NOT_FOUND'};
  return {
    ok:true, mode:'static', standard:'NRC_2011_Tilapia_plus_Literature_2011_2024',
    species:'tilapia', species_name:'Oreochromis niloticus',
    label:table.label,
    digestible_energy_fish:table.energy?.de_kcal_kg??null,
    de_kcal_kg:table.energy?.de_kcal_kg??null, de_mj_kg:table.energy?.de_mj_kg??null,
    cp:table.protein?.cp_pct??null,
    digestible_protein_fish:table.protein?.dp_pct??null, dp_pct:table.protein?.dp_pct??null,
    total_lys:table.protein?.lys??null, total_met:table.protein?.met??null,
    total_metcys:table.protein?.met_cys??null, total_thr:table.protein?.thr??null,
    total_arg:table.protein?.arg??null, total_ile:table.protein?.ile??null,
    total_leu:table.protein?.leu??null, total_val:table.protein?.val??null,
    total_trp:table.protein?.trp??null, total_his:table.protein?.his??null,
    ee:table.lipids?.total_lipid_pct??null,
    linoleic:table.lipids?.linoleic_pct??null,
    dha_epa:table.lipids?.epa_dha_pct??null,
    ca:table.minerals?.ca_pct??null, total_p:table.minerals?.p_pct??null,
    avp:table.minerals?.avail_p_pct??null,
    mg:table.minerals?.mg_pct??null, k:table.minerals?.k_pct??null,
    na:table.minerals?.na_pct??null,
    fe:table.minerals?.fe_ppm??null, zn:table.minerals?.zn_ppm??null,
    mn:table.minerals?.mn_ppm??null, cu:table.minerals?.cu_ppm??null,
    se:table.minerals?.se_ppm??null, i:table.minerals?.i_ppm??null,
    vit_a:table.vitamins?.vit_a_iu_kg??null, vit_d3:table.vitamins?.vit_d_iu_kg??null,
    vit_e:table.vitamins?.vit_e_mg_kg??null, vit_c:table.vitamins?.vit_c_mg_kg??null,
    niacin:table.vitamins?.niacin_mg_kg??null, choline:table.vitamins?.choline_mg_kg??null,
    inositol:table.vitamins?.inositol_mg_kg??null,
    fcr_target:table.feed_management?.fcr_target??null,
    feeding_rate_pct_bw:table.feed_management?.feeding_rate_pct_bw??null,
  };
}

function resolveTilapiaRequirements(context={}){
  try{
    const k=resolvePhaseKey(context.production,context.phase);
    return flatten(STATIC_REQUIREMENTS[k]);
  }catch(e){return{ok:false,error:'TILAPIA_ENGINE_ERROR',message:e.message};}
}
module.exports={resolveTilapiaRequirements,STATIC_REQUIREMENTS};
