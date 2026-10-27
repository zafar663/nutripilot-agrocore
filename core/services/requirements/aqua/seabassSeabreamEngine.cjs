"use strict";
/**
 * Sea Bass & Sea Bream Requirements Engine (Mediterranean species)
 * Source: NRC 2011 + INRA 2021 + peer-reviewed literature 2011-2024
 * Species: European sea bass (Dicentrarchus labrax), Gilthead sea bream (Sparus aurata)
 */
function num(v,f=0){const n=Number(v);return Number.isFinite(n)?n:f;}

const STATIC_REQUIREMENTS = {
  fry:{
    label:"Sea Bass/Bream — Fry (<5g)", production:"fry", phase:"fry",
    energy:{de_mj_kg:18.0, de_kcal_kg:4303},
    protein:{dp_pct:52, cp_pct:56, lys:3.0, met:1.5, met_cys:2.2, thr:2.1, arg:3.2, ile:2.2, leu:3.5, val:2.4, trp:0.6, his:1.1},
    lipids:{total_lipid_pct:14, epa_dha_pct:2.0, epa_pct:1.0, dha_pct:1.2, linoleic_pct:0.8, n3_n6_ratio:2.5},
    minerals:{ca_pct:0.6, p_pct:1.0, avail_p_pct:0.65, mg_pct:0.06, k_pct:0.85, na_pct:0.35, fe_ppm:60, zn_ppm:30, mn_ppm:10, cu_ppm:5, se_ppm:0.35, i_ppm:1.2},
    vitamins:{vit_a_iu_kg:8000, vit_d_iu_kg:2000, vit_e_mg_kg:300, vit_c_mg_kg:500, niacin_mg_kg:100, choline_mg_kg:3000, inositol_mg_kg:500},
    feed_management:{fcr_target:0.9, feeding_rate_pct_bw:5, feeds_per_day:6},
  },
  juvenile:{
    label:"Sea Bass/Bream — Juvenile (5-50g)", production:"juvenile", phase:"juvenile",
    energy:{de_mj_kg:17.0, de_kcal_kg:4063},
    protein:{dp_pct:46, cp_pct:50, lys:2.6, met:1.3, met_cys:2.0, thr:1.9, arg:2.8, ile:2.0, leu:3.2, val:2.2, trp:0.5, his:1.0},
    lipids:{total_lipid_pct:16, epa_dha_pct:1.6, epa_pct:0.8, dha_pct:1.0, linoleic_pct:1.0, n3_n6_ratio:2.0},
    minerals:{ca_pct:0.5, p_pct:0.85, avail_p_pct:0.55, mg_pct:0.05, k_pct:0.75, na_pct:0.30, fe_ppm:50, zn_ppm:25, mn_ppm:8, cu_ppm:4, se_ppm:0.30, i_ppm:1.0},
    vitamins:{vit_a_iu_kg:6000, vit_d_iu_kg:1600, vit_e_mg_kg:250, vit_c_mg_kg:350, niacin_mg_kg:80, choline_mg_kg:2500, inositol_mg_kg:400},
    feed_management:{fcr_target:1.0, feeding_rate_pct_bw:3, feeds_per_day:4},
  },
  grow_out:{
    label:"Sea Bass/Bream — Grow-out (50-400g)", production:"grow_out", phase:"grow_out",
    energy:{de_mj_kg:16.0, de_kcal_kg:3824},
    protein:{dp_pct:40, cp_pct:44, lys:2.2, met:1.1, met_cys:1.7, thr:1.7, arg:2.4, ile:1.8, leu:2.9, val:2.0, trp:0.4, his:0.9},
    lipids:{total_lipid_pct:18, epa_dha_pct:1.2, epa_pct:0.6, dha_pct:0.8, linoleic_pct:1.2, n3_n6_ratio:1.8},
    minerals:{ca_pct:0.5, p_pct:0.75, avail_p_pct:0.48, mg_pct:0.05, k_pct:0.65, na_pct:0.25, fe_ppm:40, zn_ppm:20, mn_ppm:7, cu_ppm:4, se_ppm:0.28, i_ppm:1.0},
    vitamins:{vit_a_iu_kg:4500, vit_d_iu_kg:1200, vit_e_mg_kg:180, vit_c_mg_kg:250, niacin_mg_kg:65, choline_mg_kg:2000, inositol_mg_kg:300},
    feed_management:{fcr_target:1.2, feeding_rate_pct_bw:2, feeds_per_day:3},
  },
  finishing:{
    label:"Sea Bass/Bream — Finishing/Pre-harvest (>400g)", production:"finishing", phase:"finishing",
    energy:{de_mj_kg:15.0, de_kcal_kg:3585},
    protein:{dp_pct:36, cp_pct:40, lys:2.0, met:1.0, met_cys:1.5, thr:1.5, arg:2.2, ile:1.6, leu:2.6, val:1.8, trp:0.4, his:0.8},
    lipids:{total_lipid_pct:20, epa_dha_pct:1.4, epa_pct:0.7, dha_pct:0.9, linoleic_pct:1.2, n3_n6_ratio:2.0},
    minerals:{ca_pct:0.4, p_pct:0.68, avail_p_pct:0.42, mg_pct:0.04, k_pct:0.60, na_pct:0.22, fe_ppm:35, zn_ppm:18, mn_ppm:6, cu_ppm:3, se_ppm:0.25, i_ppm:1.0},
    vitamins:{vit_a_iu_kg:3500, vit_d_iu_kg:1000, vit_e_mg_kg:150, vit_c_mg_kg:180, niacin_mg_kg:55, choline_mg_kg:1800, inositol_mg_kg:200},
    feed_management:{fcr_target:1.4, feeding_rate_pct_bw:1.5, feeds_per_day:2},
  },
};

function resolvePhaseKey(p,ph){
  const k=String(ph||p||'').toLowerCase();
  if(STATIC_REQUIREMENTS[k]) return k;
  if(k.includes('fry')||k.includes('larv')||k.includes('start')) return 'fry';
  if(k.includes('juven')||k.includes('finger')) return 'juvenile';
  if(k.includes('finish')||k.includes('harvest')||k.includes('market')) return 'finishing';
  return 'grow_out';
}

function flatten(t){
  if(!t) return {ok:false,error:'PHASE_NOT_FOUND'};
  return {
    ok:true, mode:'static', standard:'NRC_2011_INRA_2021_MarineFish_plus_Literature_2011_2024',
    species:'marine_fish', label:t.label,
    digestible_energy_fish:t.energy?.de_kcal_kg??null,
    de_mj_kg:t.energy?.de_mj_kg??null, de_kcal_kg:t.energy?.de_kcal_kg??null,
    cp:t.protein?.cp_pct??null,
    digestible_protein_fish:t.protein?.dp_pct??null, dp_pct:t.protein?.dp_pct??null,
    total_lys:t.protein?.lys??null, total_met:t.protein?.met??null,
    total_metcys:t.protein?.met_cys??null, total_thr:t.protein?.thr??null,
    total_arg:t.protein?.arg??null, total_trp:t.protein?.trp??null,
    ee:t.lipids?.total_lipid_pct??null,
    dha_epa:t.lipids?.epa_dha_pct??null, epa:t.lipids?.epa_pct??null,
    dha:t.lipids?.dha_pct??null, linoleic:t.lipids?.linoleic_pct??null,
    n3_n6_ratio:t.lipids?.n3_n6_ratio??null,
    ca:t.minerals?.ca_pct??null, total_p:t.minerals?.p_pct??null,
    avp:t.minerals?.avail_p_pct??null,
    mg:t.minerals?.mg_pct??null, k:t.minerals?.k_pct??null, na:t.minerals?.na_pct??null,
    fe:t.minerals?.fe_ppm??null, zn:t.minerals?.zn_ppm??null,
    mn:t.minerals?.mn_ppm??null, cu:t.minerals?.cu_ppm??null,
    se:t.minerals?.se_ppm??null, i:t.minerals?.i_ppm??null,
    vit_a:t.vitamins?.vit_a_iu_kg??null, vit_d3:t.vitamins?.vit_d_iu_kg??null,
    vit_e:t.vitamins?.vit_e_mg_kg??null, vit_c:t.vitamins?.vit_c_mg_kg??null,
    niacin:t.vitamins?.niacin_mg_kg??null, choline:t.vitamins?.choline_mg_kg??null,
    inositol:t.vitamins?.inositol_mg_kg??null,
    fcr_target:t.feed_management?.fcr_target??null,
    feeding_rate_pct_bw:t.feed_management?.feeding_rate_pct_bw??null,
  };
}

function resolveMarineFishRequirements(context={}){
  try{
    const k=resolvePhaseKey(context.production,context.phase);
    return flatten(STATIC_REQUIREMENTS[k]);
  }catch(e){return{ok:false,error:'MARINE_FISH_ENGINE_ERROR',message:e.message};}
}
module.exports={resolveMarineFishRequirements,STATIC_REQUIREMENTS};
