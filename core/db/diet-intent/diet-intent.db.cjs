'use strict';

// ============================================================
// NutriPilot Diet Intent Knowledge Base
// Covers all major livestock/aquaculture species, breeds, phases.
// Used by diet-parser.service.cjs to resolve natural-language
// chat requests into structured { species, type, breed, phase }.
// ============================================================

const DIET_INTENT_DB = {

  // ─────────────────────────────────────────────────────────
  // POULTRY — BROILER
  // ─────────────────────────────────────────────────────────
  poultry_broiler: {
    key: 'poultry_broiler',
    species: 'poultry',
    species_label: 'Poultry',
    type: 'broiler',
    type_label: 'Broiler',
    nutrix_key: 'poultry/broiler',
    aliases: [
      'broiler','broilers','meat chicken','meat bird','meat birds',
      'fryer','fryers','roaster','roasters','grower chicken','commercial chicken',
      'chicken broiler','broiler chicken','poultry meat','meat poultry',
      'دجاج لحم','دجاج تسمين','تسمين','دجاج','chicken'
    ],
    breeds: [
      { key: 'ross_308',    label: 'Ross 308',    nutrix_breed: 'ross_308',    aliases: ['ross308','ross 308','r308','ross308ap','ross 308 ap','ross 308ap','ross308 ap','ross308ff','ross 308 ff','ross','aviagen ross','ross conventional','308'] },
      { key: 'ross_708',    label: 'Ross 708',    nutrix_breed: 'ross_308',    aliases: ['ross708','ross 708','r708','ross 708 ap','708'] },
      { key: 'cobb_500',    label: 'Cobb 500',    nutrix_breed: 'cobb_500',    aliases: ['cobb500','cobb 500','c500','cob500','cob 500','cobb conventional'] },
      { key: 'cobb_700',    label: 'Cobb 700',    nutrix_breed: 'cobb_500',    aliases: ['cobb700','cobb 700','c700','cob700','cob 700','cobb 700','cobb700 mv','cobb mv','cobb700mv'] },
      { key: 'cobb_800',    label: 'Cobb 800',    nutrix_breed: 'cobb_800',    aliases: ['cobb800','cobb 800','c800'] },
      { key: 'cobb_avian48',label: 'Cobb Avian48',nutrix_breed: 'cobb_500',   aliases: ['avian48','avian 48','cobb avian','cobb a48'] },
      { key: 'arbor_acres', label: 'Arbor Acres', nutrix_breed: 'arbor_acres_plus', aliases: ['arbor acres','arbor','aa plus','aa+','aaplus','arbor acres plus','aaplus','aa','aviagen aa','indian river','ir'] },
      { key: 'hubbard',     label: 'Hubbard',     nutrix_breed: 'hubbard_efficiency_plus', aliases: ['hubbard','hubbard f15','hubbard flex','hubbard classic','hubbard efficiency','hubbard ep','hubbard efficiency plus','hub'] },
      { key: 'isa_257',     label: 'ISA 257',     nutrix_breed: null,          aliases: ['isa257','isa 257','isa broiler','isa meat','isa'] },
      { key: 'sasso',       label: 'Sasso',        nutrix_breed: null,         aliases: ['sasso','sasso c44','colored broiler','couleur broiler','label rouge','sasso t44','sasso x44'] },
      { key: 'vencobb_400', label: 'Vencobb 400',  nutrix_breed: 'cobb_500',   aliases: ['vencobb','vencobb400','vencobb 400','ven cobb'] },
      { key: 'hybro',       label: 'Hybro',        nutrix_breed: null,         aliases: ['hybro','hybro g+','hybro gplus','hybro g plus','hyb'] },
      { key: 'marshall',    label: 'Marshall BV',  nutrix_breed: null,         aliases: ['marshall','bv300','bv 300','marshall bv300','marshall bv 300'] },
      { key: 'generic_broiler', label: 'Generic Broiler', nutrix_breed: null,  aliases: ['generic','standard','nrc','generic broiler','standard broiler'] },
    ],
    fallback_breed: 'generic_broiler',
    phases: [
      { key: 'pre_starter', label: 'Pre-Starter', day_range: [0,7],   week_range: [0,1],  aliases: ['pre starter','prestarter','pre-starter','day 0','day 1','hatch','d0','d1','phase 0','p0','crumb','mash day 1','hatchling'] },
      { key: 'starter',     label: 'Starter',     day_range: [1,14],  week_range: [1,2],  aliases: ['starter','start','chick','early','p1','phase 1','phase1','day 8','d8','1-14','0-14','week 1','week 2','w1','w2'] },
      { key: 'grower',      label: 'Grower',      day_range: [15,28], week_range: [3,4],  aliases: ['grower','grow','growing','mid','p2','phase 2','phase2','day 15','d15','2-4 weeks','14-28','week 3','week 4','w3','w4'] },
      { key: 'finisher',    label: 'Finisher',    day_range: [29,42], week_range: [5,6],  aliases: ['finisher','finish','finishing','final','late','p3','phase 3','phase3','day 28','day 29','d28','d29','28-42','week 5','week 6','w5','w6'] },
      { key: 'withdrawal',  label: 'Withdrawal',  day_range: [35,42], week_range: [5,6],  aliases: ['withdrawal','drug free','antibiotic free','ab free','drug-free','pre slaughter','pre-slaughter','last phase'] },
    ],
  },

  // ─────────────────────────────────────────────────────────
  // POULTRY — LAYER
  // ─────────────────────────────────────────────────────────
  poultry_layer: {
    key: 'poultry_layer',
    species: 'poultry',
    species_label: 'Poultry',
    type: 'layer',
    type_label: 'Layer',
    nutrix_key: 'poultry/layer',
    aliases: [
      'layer','layers','laying hen','laying hens','egg layer','egg layers','egg production',
      'table egg','commercial egg','egg chicken','hen','hens','egg bird','egg birds',
      'دجاج بياض','بياض','دجاج بيض'
    ],
    breeds: [
      { key: 'hyline_brown',        label: 'Hy-Line Brown',         nutrix_breed: 'hyline_brown',       aliases: ['hyline brown','hy-line brown','hy line brown','hyline br','hylinebrown','hl brown','hlb','hyline'] },
      { key: 'hyline_w36',          label: 'Hy-Line W-36',          nutrix_breed: null,                  aliases: ['hyline w36','hy-line w36','hyline w 36','hl w36','w-36','w36','hyline white'] },
      { key: 'hyline_w80',          label: 'Hy-Line W-80',          nutrix_breed: null,                  aliases: ['hyline w80','hy-line w80','hyline w 80','w-80','w80'] },
      { key: 'hyline_w98',          label: 'Hy-Line W-98',          nutrix_breed: null,                  aliases: ['hyline w98','hy-line w98','hyline w 98','w-98','w98'] },
      { key: 'hyline_silver_brown', label: 'Hy-Line Silver Brown',  nutrix_breed: 'hyline_silver_brown', aliases: ['hyline silver brown','hy-line silver brown','silver brown','hlsb','hy-line sb','hyline sb'] },
      { key: 'lohmann_brown',       label: 'Lohmann Brown Classic', nutrix_breed: 'lohmann_brown',       aliases: ['lohmann brown','lohmann','lhb','lhm','lohmann brown classic','lbc','lb classic'] },
      { key: 'lohmann_brown_plus',  label: 'Lohmann Brown Plus',    nutrix_breed: 'lohmann_brown',       aliases: ['lohmann brown plus','lhb plus','lb plus','lbp'] },
      { key: 'lohmann_lsl',         label: 'Lohmann LSL',           nutrix_breed: null,                  aliases: ['lohmann lsl','lsl classic','lsl lite','lsl','lohmann white','lohmann lsl classic'] },
      { key: 'isa_brown',           label: 'ISA Brown',             nutrix_breed: null,                  aliases: ['isa brown','isa','isa layer','isabrown'] },
      { key: 'isa_white',           label: 'ISA White',             nutrix_breed: null,                  aliases: ['isa white','isawhite','isa w'] },
      { key: 'babcock_b380',        label: 'Babcock B-380',         nutrix_breed: null,                  aliases: ['babcock','babcock b380','babcock b 380','b380','b-380'] },
      { key: 'dekalb_white',        label: 'Dekalb White',          nutrix_breed: 'dekalb_white',        aliases: ['dekalb white','dekalb','dekalb w','dk white','dw'] },
      { key: 'dekalb_brown',        label: 'Dekalb Brown',          nutrix_breed: null,                  aliases: ['dekalb brown','dekalb br','dk brown','db'] },
      { key: 'bovans_brown',        label: 'Bovans Brown',          nutrix_breed: null,                  aliases: ['bovans brown','bovans','bovans br','bovans goldline'] },
      { key: 'bovans_white',        label: 'Bovans White',          nutrix_breed: null,                  aliases: ['bovans white','bovans w'] },
      { key: 'bovans_nera',         label: 'Bovans Nera',           nutrix_breed: null,                  aliases: ['bovans nera','nera','bovans black'] },
      { key: 'novogen',             label: 'Novogen Brown',         nutrix_breed: null,                  aliases: ['novogen','novogen brown','novo brown','novogen white','novo'] },
      { key: 'shaver',              label: 'Shaver Brown',          nutrix_breed: null,                  aliases: ['shaver','shaver brown','shaver white'] },
      { key: 'nick_chick',          label: 'Nick Chick',            nutrix_breed: null,                  aliases: ['nick chick','nick','nick brown','nickchick'] },
      { key: 'hn_brown',            label: 'H&N Brown Nick',        nutrix_breed: null,                  aliases: ['h&n','hn','h n brown','h&n brown','hn brown nick','h&n nick'] },
      { key: 'generic_layer',       label: 'Generic Layer',         nutrix_breed: null,                  aliases: ['generic layer','standard layer','nrc layer','generic hen','generic'] },
    ],
    fallback_breed: 'generic_layer',
    phases: [
      { key: 'pullet_starter',  label: 'Pullet Starter',   day_range: [0,28],    week_range: [0,4],   aliases: ['pullet starter','chick starter','early pullet','d0','day 0','day 1','week 1','week 2','w1','w2','0-4 weeks'] },
      { key: 'pullet_grower',   label: 'Pullet Grower',    day_range: [29,84],   week_range: [5,12],  aliases: ['pullet grower','growing pullet','pullet grow','pullet grower','week 5','week 8','w5','w8','4-12 weeks','grower pullet'] },
      { key: 'pullet_developer',label: 'Pullet Developer', day_range: [85,112],  week_range: [13,16], aliases: ['developer','pre-lay developer','pullet dev','pullet developer','pullet finisher','12-16 weeks','week 13','week 16','development'] },
      { key: 'pre_lay',         label: 'Pre-Lay',          day_range: [112,126], week_range: [16,18], aliases: ['pre lay','pre-lay','prelay','pre production','pre-production','transition','pre-peak','week 16','week 17','w16','w17'] },
      { key: 'early_lay',       label: 'Early Lay (Peak)', day_range: [126,210], week_range: [18,30], aliases: ['early lay','early peak','peak lay','peak production','peak','laying','early production','early laying','week 18','week 20','week 24','w18','w20','w24','phase 1 lay'] },
      { key: 'mid_lay',         label: 'Mid Lay',          day_range: [210,315], week_range: [30,45], aliases: ['mid lay','mid production','mid-lay','middle lay','late peak','post peak','post-peak','after peak','week 30','week 35','week 40','w30','w35','w40','phase 2 lay'] },
      { key: 'late_lay',        label: 'Late Lay',         day_range: [315,490], week_range: [45,70], aliases: ['late lay','late production','late-lay','end lay','end of lay','week 45','week 50','week 60','w45','w50','w60','phase 3 lay','final lay'] },
    ],
  },

  // ─────────────────────────────────────────────────────────
  // POULTRY — BROILER BREEDER / PARENT STOCK
  // ─────────────────────────────────────────────────────────
  poultry_broiler_breeder: {
    key: 'poultry_broiler_breeder',
    species: 'poultry',
    species_label: 'Poultry',
    type: 'broiler_breeder',
    type_label: 'Broiler Breeder',
    nutrix_key: 'poultry/broiler_breeder',
    aliases: [
      'broiler breeder','broiler breeders','parent stock','ps','ps bird','breeder flock',
      'grandparent','gp','gps','great grandparent','ggp',
      'breeder chicken','broiler parent','parent bird','ross ps','cobb ps','ps flock',
      'مورد دجاج','أمهات','قطيع أمهات'
    ],
    breeds: [
      { key: 'ross_308_ps',    label: 'Ross 308 PS',     nutrix_breed: 'ross_308_ps',   aliases: ['ross ps','ross 308 ps','ross308ps','r308 ps','ross parent','ross breeder'] },
      { key: 'cobb_500_ff',    label: 'Cobb 500 FF',     nutrix_breed: 'cobb_500_ff',   aliases: ['cobb ff','cobb 500 ff','cobb500ff','cobb feather female','cobb ps feather'] },
      { key: 'cobb_500_sf',    label: 'Cobb 500 SF',     nutrix_breed: 'cobb_500_sf',   aliases: ['cobb sf','cobb 500 sf','cobb500sf','cobb slow feather','cobb ps slow'] },
      { key: 'arbor_acres_ps', label: 'Arbor Acres PS',  nutrix_breed: null,             aliases: ['arbor acres ps','aa ps','arbor breeder','arbor ps'] },
      { key: 'hubbard_ps',     label: 'Hubbard PS',      nutrix_breed: null,             aliases: ['hubbard ps','hubbard breeder','hub ps'] },
      { key: 'generic_ps',     label: 'Generic PS',      nutrix_breed: null,             aliases: ['generic ps','generic breeder','standard ps'] },
    ],
    fallback_breed: 'generic_ps',
    phases: [
      { key: 'ps_rearing',       label: 'PS Rearing',       day_range: [0,140],   week_range: [0,20],  aliases: ['rearing','pullet rearing','chick','starter','grower','ps rearing','week 1','week 10','week 15','w1','w10','w15','0-20 weeks'] },
      { key: 'ps_pre_production',label: 'PS Pre-Production', day_range: [140,168], week_range: [20,24], aliases: ['pre production','transition','pre-production','breeding start','pre breed','week 20','week 21','w20','w21'] },
      { key: 'ps_peak',          label: 'PS Peak',           day_range: [168,280], week_range: [24,40], aliases: ['peak','peak production','ps peak','high production','early production','week 24','week 30','w24','w30'] },
      { key: 'ps_mid',           label: 'PS Mid',            day_range: [280,350], week_range: [40,50], aliases: ['mid production','ps mid','week 40','week 45','w40','w45'] },
      { key: 'ps_late',          label: 'PS Late',           day_range: [350,420], week_range: [50,60], aliases: ['late production','late lay','ps late','week 50','week 55','w50','w55'] },
    ],
  },

  // ─────────────────────────────────────────────────────────
  // POULTRY — TURKEY
  // ─────────────────────────────────────────────────────────
  poultry_turkey: {
    key: 'poultry_turkey',
    species: 'poultry',
    species_label: 'Poultry',
    type: 'turkey',
    type_label: 'Turkey',
    nutrix_key: 'poultry/turkey_commercial',
    aliases: [
      'turkey','turkeys','tom','hen turkey','turkey bird','turkey poultry',
      'commercial turkey','turkey meat','ديك رومي','ديك الرومي'
    ],
    breeds: [
      { key: 'but_10',     label: 'BUT 10',       nutrix_breed: 'but',    aliases: ['but10','but 10','but','aviagen turkey','b.u.t.','british united turkeys'] },
      { key: 'nicholas_700',label:'Nicholas 700', nutrix_breed: null,     aliases: ['nicholas','nicholas 700','nick 700','n700','nicholas700'] },
      { key: 'hybrid',     label: 'Hybrid Converter', nutrix_breed: 'hybrid', aliases: ['hybrid','converter','hybrid converter','grade maker','hybrid turkey','hybrid commercial'] },
      { key: 'big_6',      label: 'Big 6',        nutrix_breed: null,     aliases: ['big6','big 6','b6','large white turkey'] },
      { key: 'bronze',     label: 'Bronze',        nutrix_breed: null,    aliases: ['bronze','kelly bronze','heritage bronze','traditional bronze'] },
      { key: 'generic_turkey', label: 'Generic Turkey', nutrix_breed: null, aliases: ['generic turkey','turkey generic','standard turkey'] },
    ],
    fallback_breed: 'generic_turkey',
    phases: [
      { key: 'turkey_starter',  label: 'Turkey Starter',  day_range: [0,28],  week_range: [0,4],  aliases: ['turkey starter','starter','chick','poult starter','day 1','week 1','w1','week 2','w2','0-4 weeks','early turkey'] },
      { key: 'turkey_grower1',  label: 'Turkey Grower 1', day_range: [28,56], week_range: [4,8],  aliases: ['grower 1','grower1','turkey grower','grow 1','week 4','week 5','week 6','week 7','week 8','w4','w5','w6','w7','w8'] },
      { key: 'turkey_grower2',  label: 'Turkey Grower 2', day_range: [56,84], week_range: [8,12], aliases: ['grower 2','grower2','grow 2','week 9','week 10','week 11','week 12','w9','w10','w11','w12'] },
      { key: 'turkey_finisher1',label: 'Turkey Finisher 1',day_range: [84,112], week_range:[12,16],aliases: ['finisher 1','finisher1','finish 1','week 12','week 13','week 14','week 15','week 16','w12','w13','w14','w15'] },
      { key: 'turkey_finisher2',label: 'Turkey Finisher 2',day_range: [112,147],week_range:[16,21],aliases: ['finisher 2','finisher2','finish 2','week 16','week 17','week 18','week 19','week 20','w16','w17','w18','w19','w20','final'] },
    ],
  },

  // ─────────────────────────────────────────────────────────
  // POULTRY — DUCK
  // ─────────────────────────────────────────────────────────
  poultry_duck: {
    key: 'poultry_duck',
    species: 'poultry',
    species_label: 'Poultry',
    type: 'duck',
    type_label: 'Duck',
    nutrix_key: 'poultry/duck_commercial',
    aliases: [
      'duck','ducks','pekin duck','muscovy duck','mule duck','duck meat','table duck',
      'commercial duck','bata','batik','بطة','بط'
    ],
    breeds: [
      { key: 'cherry_valley',  label: 'Cherry Valley',  nutrix_breed: 'cherry_valley', aliases: ['cherry valley','cherry','cv','cherry valley pekin','cv pekin'] },
      { key: 'pekin',          label: 'Pekin',           nutrix_breed: 'cherry_valley', aliases: ['pekin','white pekin','beijing duck','beijing','pekin duck'] },
      { key: 'muscovy',        label: 'Muscovy',         nutrix_breed: null,            aliases: ['muscovy','muscovy duck','barbarie','barbary','muscovi'] },
      { key: 'mule',           label: 'Mule Duck',       nutrix_breed: null,            aliases: ['mule','mule duck','mulard','mulard duck','hybrid duck'] },
      { key: 'khaki_campbell', label: 'Khaki Campbell',  nutrix_breed: null,            aliases: ['khaki campbell','campbell','khaki','egg duck','layer duck'] },
      { key: 'generic_duck',   label: 'Generic Duck',    nutrix_breed: null,            aliases: ['generic duck','duck generic','standard duck'] },
    ],
    fallback_breed: 'generic_duck',
    phases: [
      { key: 'duck_starter',  label: 'Duck Starter',  day_range: [0,14],  week_range: [0,2],  aliases: ['duck starter','starter','duckling','early','day 1','week 1','w1','w2','0-2 weeks'] },
      { key: 'duck_grower',   label: 'Duck Grower',   day_range: [14,28], week_range: [2,4],  aliases: ['duck grower','grower','grow','week 2','week 3','week 4','w2','w3','w4','2-4 weeks'] },
      { key: 'duck_finisher', label: 'Duck Finisher', day_range: [28,49], week_range: [4,7],  aliases: ['duck finisher','finisher','finish','final','week 4','week 5','week 6','week 7','w4','w5','w6','w7','4-7 weeks'] },
    ],
  },

  // ─────────────────────────────────────────────────────────
  // POULTRY — QUAIL
  // ─────────────────────────────────────────────────────────
  poultry_quail: {
    key: 'poultry_quail',
    species: 'poultry',
    species_label: 'Poultry',
    type: 'quail',
    type_label: 'Quail',
    nutrix_key: 'poultry/quail',
    aliases: [
      'quail','quails','coturnix','japanese quail','bobwhite','button quail',
      'سمان','طائر السمان'
    ],
    breeds: [
      { key: 'japanese',   label: 'Japanese Coturnix', nutrix_breed: null, aliases: ['japanese','coturnix','japanese coturnix','coturnix japonica','coturnix quail','meat quail'] },
      { key: 'bobwhite',   label: 'Bobwhite',          nutrix_breed: null, aliases: ['bobwhite','bob white','northern bobwhite','colinus virginianus'] },
      { key: 'button',     label: 'Button Quail',      nutrix_breed: null, aliases: ['button','button quail','chinese painted quail','painted quail','mini quail'] },
      { key: 'generic_quail', label: 'Generic Quail',  nutrix_breed: null, aliases: ['generic quail','quail generic'] },
    ],
    fallback_breed: 'generic_quail',
    phases: [
      { key: 'quail_starter',  label: 'Quail Starter',  day_range: [0,14],  week_range: [0,2],  aliases: ['quail starter','starter','chick','early','day 1','week 1','w1','w2'] },
      { key: 'quail_grower',   label: 'Quail Grower',   day_range: [14,35], week_range: [2,5],  aliases: ['quail grower','grower','grow','week 2','week 3','week 4','w2','w3','w4'] },
      { key: 'quail_layer',    label: 'Quail Laying',   day_range: [35,365],week_range: [5,52], aliases: ['quail layer','layer','laying','laying quail','production','week 5','week 6','w5','w6'] },
    ],
  },

  // ─────────────────────────────────────────────────────────
  // POULTRY — GOOSE
  // ─────────────────────────────────────────────────────────
  poultry_goose: {
    key: 'poultry_goose',
    species: 'poultry',
    species_label: 'Poultry',
    type: 'goose',
    type_label: 'Goose',
    nutrix_key: 'poultry/goose',
    aliases: ['goose','geese','toulouse','embden','chinese goose','foie gras'],
    breeds: [
      { key: 'embden',  label: 'Embden',      nutrix_breed: null, aliases: ['embden','embden goose','white goose'] },
      { key: 'toulouse',label: 'Toulouse',    nutrix_breed: null, aliases: ['toulouse','toulouse goose','gray goose'] },
      { key: 'chinese', label: 'Chinese',     nutrix_breed: null, aliases: ['chinese','chinese goose','african goose'] },
      { key: 'generic_goose', label: 'Generic Goose', nutrix_breed: null, aliases: ['generic goose','goose generic'] },
    ],
    fallback_breed: 'generic_goose',
    phases: [
      { key: 'goose_starter',  label: 'Goose Starter',  day_range: [0,28],  week_range: [0,4],  aliases: ['starter','gosling','early','week 1','w1','w2','w3','w4'] },
      { key: 'goose_grower',   label: 'Goose Grower',   day_range: [28,56], week_range: [4,8],  aliases: ['grower','grow','week 4','week 5','week 6','week 7','week 8','w4','w5'] },
      { key: 'goose_finisher', label: 'Goose Finisher', day_range: [56,84], week_range: [8,12], aliases: ['finisher','finish','final','foie gras','week 8','week 9','week 10','w8','w9','w10'] },
    ],
  },

  // ─────────────────────────────────────────────────────────
  // SWINE — COMMERCIAL PIG
  // ─────────────────────────────────────────────────────────
  swine: {
    key: 'swine',
    species: 'swine',
    species_label: 'Swine',
    type: 'pig',
    type_label: 'Pig',
    nutrix_key: 'swine/pig',
    aliases: [
      'pig','pigs','swine','hog','hogs','pork','pork pig','commercial pig',
      'خنزير','خنازير','porcine','sus scrofa'
    ],
    breeds: [
      { key: 'landrace',    label: 'Landrace',       nutrix_breed: null, aliases: ['landrace','danish landrace','american landrace','british landrace','ld'] },
      { key: 'yorkshire',   label: 'Yorkshire',      nutrix_breed: null, aliases: ['yorkshire','large white','large white pig','yorkshire pig','yw','lw','large white yorkshire'] },
      { key: 'duroc',       label: 'Duroc',          nutrix_breed: null, aliases: ['duroc','duroc pig','american duroc','jersey red'] },
      { key: 'berkshire',   label: 'Berkshire',      nutrix_breed: null, aliases: ['berkshire','berkshire pig','black pig','berk'] },
      { key: 'hampshire',   label: 'Hampshire',      nutrix_breed: null, aliases: ['hampshire','hampshire pig','belted pig','hamp'] },
      { key: 'pietrain',    label: 'Pietrain',       nutrix_breed: null, aliases: ['pietrain','pietrain pig','pie','double muscled pig'] },
      { key: 'poland_china',label: 'Poland China',   nutrix_breed: null, aliases: ['poland china','poland','pc pig','poland china pig'] },
      { key: 'pic_380',     label: 'PIC 380',        nutrix_breed: null, aliases: ['pic380','pic 380','pic boar 380','pic terminal 380'] },
      { key: 'pic_337',     label: 'PIC 337',        nutrix_breed: null, aliases: ['pic337','pic 337','pic sow 337','pic f337'] },
      { key: 'topigs_20',   label: 'Topigs 20',      nutrix_breed: null, aliases: ['topigs20','topigs 20','topigs norsvin 20','tn20'] },
      { key: 'topigs_norsvin',label:'Topigs Norsvin',nutrix_breed: null, aliases: ['topigs norsvin','norsvin','tnt','topigs','norsvin landrace'] },
      { key: 'hypor_magnus',label: 'Hypor Magnus',   nutrix_breed: null, aliases: ['hypor magnus','magnus','hypor','hypor pig','hypor boar'] },
      { key: 'hypor_libra', label: 'Hypor Libra',    nutrix_breed: null, aliases: ['hypor libra','libra','hypor sow','libra sow'] },
      { key: 'genesus',     label: 'Genesus',        nutrix_breed: null, aliases: ['genesus','genesus pig','genesus boar','genesus sow'] },
      { key: 'duroc_landrace_yorkshire', label: 'DLY Cross',nutrix_breed: null, aliases: ['dly','duroc landrace yorkshire','commercial cross','f1 pig','terminal cross'] },
      { key: 'generic_pig', label: 'Generic Pig',    nutrix_breed: null, aliases: ['generic pig','standard pig','nrc pig','generic swine'] },
    ],
    fallback_breed: 'generic_pig',
    phases: [
      { key: 'suckling',    label: 'Suckling Piglet', day_range: [0,21],  week_range: [0,3],  aliases: ['suckling','suckling pig','newborn pig','piglet','baby pig','day 1','day 5','w1','week 1','d0','d1'] },
      { key: 'nursery',     label: 'Nursery / Weaner',day_range: [21,63], week_range: [3,9],  aliases: ['nursery','weaner','weanling','post weaning','week 3','week 4','week 5','week 6','week 7','week 8','week 9','w3','w4','w5','w6','7-25kg','7 kg','25 kg','3-9 weeks','early grower','phase 1'] },
      { key: 'grower',      label: 'Grower',          day_range: [63,112],week_range: [9,16], aliases: ['grower','growing pig','grow','week 9','week 10','week 12','w9','w10','w12','25-60kg','25 kg','60 kg','25kg','60kg','phase 2','grower pig'] },
      { key: 'finisher',    label: 'Finisher',        day_range: [112,168],week_range:[16,24],aliases: ['finisher','finishing','fattener','finishing pig','week 16','week 18','week 20','w16','w18','w20','60-110kg','60 kg','100 kg','110 kg','60kg','100kg','phase 3','market'] },
      { key: 'gilt_developer',label:'Gilt Developer', day_range: [112,210],week_range:[16,30],aliases: ['gilt','gilt developer','replacement gilt','gilt development','future sow','bred gilt'] },
      { key: 'gestation',   label: 'Gestation Sow',   day_range: [0,114], week_range: [0,16], aliases: ['gestation','pregnant sow','dry sow','in-pig sow','bred sow','gestation sow','gestating','mid gestation','late gestation'] },
      { key: 'lactation',   label: 'Lactating Sow',   day_range: [114,135],week_range:[0,3],  aliases: ['lactation','lactating sow','nursing sow','milking sow','farrowing','post farrowing','lactating'] },
      { key: 'boar',        label: 'Boar',            day_range: [365,730],week_range:[52,104],aliases: ['boar','breeding boar','stud boar','male pig','mature boar'] },
    ],
  },

  // ─────────────────────────────────────────────────────────
  // DAIRY CATTLE
  // ─────────────────────────────────────────────────────────
  dairy: {
    key: 'dairy',
    species: 'cattle',
    species_label: 'Cattle',
    type: 'dairy',
    type_label: 'Dairy Cow',
    nutrix_key: 'ruminant/dairy',
    aliases: [
      'dairy','dairy cow','dairy cattle','milk cow','milking cow','lactating cow',
      'holstein','jersey cow','dairy herd','milk production','milch cow',
      'بقرة حلوب','أبقار حلوب','حلوب','بقرة حليب'
    ],
    breeds: [
      { key: 'holstein',       label: 'Holstein-Friesian', nutrix_breed: null, aliases: ['holstein','friesian','hf','hf cow','black and white','holstein friesian','holstein cow','holsteins','black white cow'] },
      { key: 'jersey',         label: 'Jersey',             nutrix_breed: null, aliases: ['jersey','jersey cow','jersey breed','small dairy'] },
      { key: 'brown_swiss',    label: 'Brown Swiss',        nutrix_breed: null, aliases: ['brown swiss','swiss','bs cow','braunvieh','swiss brown'] },
      { key: 'ayrshire',       label: 'Ayrshire',           nutrix_breed: null, aliases: ['ayrshire','ayr','ayrshire cow'] },
      { key: 'guernsey',       label: 'Guernsey',           nutrix_breed: null, aliases: ['guernsey','guernsey cow'] },
      { key: 'milking_shorthorn',label:'Milking Shorthorn', nutrix_breed: null, aliases: ['milking shorthorn','shorthorn dairy','shorthorn milk'] },
      { key: 'simmental_dairy',label: 'Simmental Dairy',    nutrix_breed: null, aliases: ['simmental','simmental dairy','simmental dual','fleckvieh','dual purpose simmental'] },
      { key: 'normande',       label: 'Normande',           nutrix_breed: null, aliases: ['normande','norman cow'] },
      { key: 'montbeliarde',   label: 'Montbéliarde',       nutrix_breed: null, aliases: ['montbeliarde','montbéliarde','mbe','montbeliard'] },
      { key: 'sahiwal',        label: 'Sahiwal',            nutrix_breed: null, aliases: ['sahiwal','sahiwal cow','zebu dairy','desi dairy'] },
      { key: 'gir_dairy',      label: 'Gir Dairy',          nutrix_breed: null, aliases: ['gir','gyr','gir dairy','gir cow','zebu milk'] },
      { key: 'generic_dairy',  label: 'Generic Dairy',      nutrix_breed: null, aliases: ['generic dairy','generic cow','standard dairy','nrc dairy'] },
    ],
    fallback_breed: 'generic_dairy',
    phases: [
      { key: 'heifer_calf',     label: 'Heifer Calf',      day_range: [0,90],   week_range: [0,13],  aliases: ['calf','heifer calf','baby calf','young calf','0-3 months','month 1','month 2','month 3','pre-weaned calf','dairy calf'] },
      { key: 'weaned_heifer',   label: 'Weaned Heifer',    day_range: [90,180], week_range: [13,26], aliases: ['weaned heifer','post weaning heifer','3-6 months','month 3','month 4','month 5','month 6','young heifer'] },
      { key: 'growing_heifer',  label: 'Growing Heifer',   day_range: [180,450],week_range: [26,64], aliases: ['growing heifer','heifer grower','heifer grow','6-15 months','month 7','month 8','month 9','month 10','month 12','yearling heifer','heifer'] },
      { key: 'breeding_heifer', label: 'Pre-Breeding Heifer',day_range:[450,660],week_range:[64,94], aliases: ['breeding heifer','pre breeding','bred heifer','springing heifer','pre calving heifer','15-23 months'] },
      { key: 'far_off_dry',     label: 'Far-Off Dry Cow',  day_range: [0,42],   week_range: [0,6],   aliases: ['far off','far off dry','far-off dry','early dry','early dry period','dry cow','dry period','>21 days dry'] },
      { key: 'close_up',        label: 'Close-Up / Transition', day_range: [0,21], week_range: [0,3], aliases: ['close up','close-up','transition','transition cow','pre calving','pre-calving','late dry','21 days pre','3 weeks pre','pre partum'] },
      { key: 'fresh_cow',       label: 'Fresh Cow (Early)',day_range: [0,21],   week_range: [0,3],   aliases: ['fresh cow','early fresh','post calving','post-calving','fresh','transition post','week 1 lactation','week 2 lactation','<21 dim'] },
      { key: 'early_lactation', label: 'Early Lactation',  day_range: [22,100], week_range: [3,14],  aliases: ['early lactation','early milk','peak milk','peak lactation','peak yield','22-100 dim','dim 30','dim 60','dim 22','month 1','month 2','month 3 milk','high milk'] },
      { key: 'mid_lactation',   label: 'Mid Lactation',    day_range: [100,200],week_range: [14,29], aliases: ['mid lactation','mid milk','100-200 dim','dim 100','dim 150','month 4','month 5','month 6 milk','mid production'] },
      { key: 'late_lactation',  label: 'Late Lactation',   day_range: [200,305],week_range: [29,44], aliases: ['late lactation','late milk','>200 dim','200-305 dim','dim 200','dim 250','dim 280','month 7','month 8','month 9 milk','late production'] },
    ],
  },

  // ─────────────────────────────────────────────────────────
  // BEEF CATTLE
  // ─────────────────────────────────────────────────────────
  beef: {
    key: 'beef',
    species: 'cattle',
    species_label: 'Cattle',
    type: 'beef',
    type_label: 'Beef Cattle',
    nutrix_key: 'ruminant/beef',
    aliases: [
      'beef','beef cattle','beef cow','beef steer','feedlot','steer','heifer beef',
      'beef production','fattening cattle','cattle fattening','finisher cattle',
      'أبقار لحم','عجالة','تسمين بقر','ماشية'
    ],
    breeds: [
      { key: 'angus',          label: 'Black Angus',       nutrix_breed: null, aliases: ['angus','black angus','aberdeen angus','ab angus','black cattle'] },
      { key: 'red_angus',      label: 'Red Angus',         nutrix_breed: null, aliases: ['red angus','red cattle','angus red'] },
      { key: 'hereford',       label: 'Hereford',          nutrix_breed: null, aliases: ['hereford','polled hereford','white face','hereford cow'] },
      { key: 'charolais',      label: 'Charolais',         nutrix_breed: null, aliases: ['charolais','charolais beef','char','charolaise'] },
      { key: 'simmental',      label: 'Simmental',         nutrix_breed: null, aliases: ['simmental','simmental beef','simmental cattle','fleckvieh beef'] },
      { key: 'limousin',       label: 'Limousin',          nutrix_breed: null, aliases: ['limousin','lim','limousine','limousin beef'] },
      { key: 'brahman',        label: 'Brahman',           nutrix_breed: null, aliases: ['brahman','zebu','bos indicus','brahmin','brahman cattle'] },
      { key: 'brangus',        label: 'Brangus',           nutrix_breed: null, aliases: ['brangus','brangus beef','3/8 brahman','brahman cross'] },
      { key: 'santa_gertrudis',label: 'Santa Gertrudis',   nutrix_breed: null, aliases: ['santa gertrudis','santa gert','sg beef'] },
      { key: 'wagyu',          label: 'Wagyu',             nutrix_breed: null, aliases: ['wagyu','wagyū','kobe','kobe beef','japanese beef','wa gyu','marbled beef'] },
      { key: 'murray_grey',    label: 'Murray Grey',       nutrix_breed: null, aliases: ['murray grey','murray gray','mg cattle'] },
      { key: 'shorthorn',      label: 'Shorthorn',         nutrix_breed: null, aliases: ['shorthorn','beef shorthorn','durham cattle'] },
      { key: 'piedmontese',    label: 'Piedmontese',       nutrix_breed: null, aliases: ['piedmontese','piemontese','double muscled beef','italian beef'] },
      { key: 'belgian_blue',   label: 'Belgian Blue',      nutrix_breed: null, aliases: ['belgian blue','blue belgian','bb cattle','double muscled','blanc bleu belge','bbb'] },
      { key: 'romagnola',      label: 'Romagnola',         nutrix_breed: null, aliases: ['romagnola','romagnola beef','romagnole','italian white cattle'] },
      { key: 'generic_beef',   label: 'Generic Beef',      nutrix_breed: null, aliases: ['generic beef','standard beef','nrc beef','commercial beef'] },
    ],
    fallback_breed: 'generic_beef',
    phases: [
      { key: 'beef_calf',      label: 'Beef Calf',          day_range: [0,90],  week_range: [0,13], aliases: ['calf','beef calf','baby calf','suckling calf','0-3 months','nursing calf','preweaned calf'] },
      { key: 'stocker',        label: 'Stocker / Backgrounder', day_range:[90,270],week_range:[13,38],aliases: ['stocker','backgrounder','stocker cattle','stock cattle','grass fed','pasture','3-9 months','yearling'] },
      { key: 'receiving',      label: 'Receiving / Transition',day_range:[0,28], week_range:[0,4],  aliases: ['receiving','transition','fresh off truck','induction','receiving cattle','new arrival','0-28 days feedlot'] },
      { key: 'starter',        label: 'Feedlot Starter',   day_range: [0,56],  week_range: [0,8],  aliases: ['starter','feedlot starter','early feedlot','step up','day 0','day 1','start feedlot','early adaptation'] },
      { key: 'grower',         label: 'Feedlot Grower',    day_range: [56,112],week_range: [8,16], aliases: ['feedlot grower','grower','grow','intermediate','step 2','month 2','month 3 feedlot'] },
      { key: 'finisher',       label: 'Feedlot Finisher',  day_range: [112,168],week_range:[16,24],aliases: ['finisher','finish','finishing','feedlot finisher','slaughter','market','final feedlot','step 3','full feed','month 4','month 5'] },
      { key: 'cow_maintenance',label: 'Cow Maintenance',   day_range: [0,210], week_range: [0,30], aliases: ['cow maintenance','dry cow beef','maintenance','non-pregnant cow','open cow'] },
      { key: 'cow_gestation',  label: 'Cow Gestation',     day_range: [0,283], week_range: [0,40], aliases: ['gestation','pregnant beef cow','in-calf','mid gestation cow','cow gestation'] },
      { key: 'cow_late_gestation',label:'Cow Late Gestation',day_range:[222,283],week_range:[32,40],aliases: ['late gestation','late pregnant','pre calving beef','last 2 months','flushing beef cow'] },
      { key: 'cow_lactation',  label: 'Cow Lactation',     day_range: [0,210], week_range: [0,30], aliases: ['lactation beef','beef cow lactation','nursing cow','cow with calf','cow lactating'] },
    ],
  },

  // ─────────────────────────────────────────────────────────
  // SHEEP
  // ─────────────────────────────────────────────────────────
  sheep: {
    key: 'sheep',
    species: 'sheep',
    species_label: 'Sheep',
    type: 'sheep',
    type_label: 'Sheep',
    nutrix_key: 'ruminant/sheep',
    aliases: [
      'sheep','lamb','ewe','ram','ovine','ovis','mutton','ovine animal',
      'خروف','غنم','ضأن','خروف','كبش','نعجة'
    ],
    breeds: [
      { key: 'dorper',       label: 'Dorper',          nutrix_breed: null, aliases: ['dorper','dorper sheep','south african sheep','meat sheep'] },
      { key: 'white_dorper', label: 'White Dorper',    nutrix_breed: null, aliases: ['white dorper','white dorp','wdorper'] },
      { key: 'merino',       label: 'Merino',          nutrix_breed: null, aliases: ['merino','merino sheep','wool sheep','spanish merino','australian merino'] },
      { key: 'suffolk',      label: 'Suffolk',         nutrix_breed: null, aliases: ['suffolk','suffolk sheep','black face','black-faced sheep'] },
      { key: 'texel',        label: 'Texel',           nutrix_breed: null, aliases: ['texel','texel sheep'] },
      { key: 'romney',       label: 'Romney',          nutrix_breed: null, aliases: ['romney','kent sheep','romney marsh'] },
      { key: 'corriedale',   label: 'Corriedale',      nutrix_breed: null, aliases: ['corriedale','corriedale sheep','dual purpose sheep'] },
      { key: 'rambouillet',  label: 'Rambouillet',     nutrix_breed: null, aliases: ['rambouillet','french merino','rambouillet merino'] },
      { key: 'karakul',      label: 'Karakul',         nutrix_breed: null, aliases: ['karakul','astrakhan','karakul sheep'] },
      { key: 'awassi',       label: 'Awassi',          nutrix_breed: null, aliases: ['awassi','fat tail sheep','middle east sheep','levant sheep','عواسي'] },
      { key: 'barbari',      label: 'Barbari',         nutrix_breed: null, aliases: ['barbari','barbari sheep','indian sheep','بربري'] },
      { key: 'lacaune',      label: 'Lacaune Dairy',   nutrix_breed: null, aliases: ['lacaune','lacaune dairy','milk sheep','lacaune ewe'] },
      { key: 'east_friesian',label: 'East Friesian',   nutrix_breed: null, aliases: ['east friesian','ef sheep','east friesian dairy','friesian sheep'] },
      { key: 'generic_sheep',label: 'Generic Sheep',   nutrix_breed: null, aliases: ['generic sheep','sheep generic','standard sheep','nrc sheep'] },
    ],
    fallback_breed: 'generic_sheep',
    phases: [
      { key: 'lamb_creep',    label: 'Lamb Pre-Weaning', day_range: [0,42],  week_range: [0,6],  aliases: ['creep','lamb creep','nursing lamb','suckling lamb','pre-weaned lamb','day 0','day 1','week 1','week 2','w1','w2','baby lamb'] },
      { key: 'lamb_starter',  label: 'Lamb Starter',     day_range: [42,70], week_range: [6,10], aliases: ['lamb starter','weaned lamb','starter lamb','week 6','week 7','week 8','week 9','week 10','w6','w7','w8'] },
      { key: 'lamb_grower',   label: 'Lamb Grower',      day_range: [70,140],week_range: [10,20],aliases: ['lamb grower','growing lamb','grower lamb','week 10','week 12','week 15','week 16','w10','w12','w15'] },
      { key: 'lamb_finisher', label: 'Lamb Finisher',    day_range: [140,210],week_range:[20,30],aliases: ['lamb finisher','finishing lamb','market lamb','fat lamb','lamb finish','week 20','week 24','week 26','w20','w24','w26'] },
      { key: 'ewe_maintenance',label:'Ewe Maintenance',  day_range: [0,365], week_range: [0,52], aliases: ['ewe','ewe maintenance','dry ewe','non-pregnant ewe','open ewe','maintenance ewe'] },
      { key: 'ewe_flushing',  label: 'Ewe Flushing',     day_range: [0,42],  week_range: [0,6],  aliases: ['flushing','ewe flushing','pre-mating','pre mating','flushing ewe','pre breed','mating prep'] },
      { key: 'ewe_early_gestation',label:'Ewe Early Gestation',day_range:[0,84],week_range:[0,12],aliases: ['early gestation','mid gestation','early pregnancy ewe','ewe early gestation','pregnant ewe early'] },
      { key: 'ewe_late_gestation',label:'Ewe Late Gestation', day_range:[84,147],week_range:[12,21],aliases: ['late gestation','late pregnancy','pre lambing','last 6 weeks','ewe late gestation','pregnant ewe late','last trimester'] },
      { key: 'ewe_early_lactation',label:'Ewe Early Lactation',day_range:[0,56],week_range:[0,8], aliases: ['ewe lactation','nursing ewe','lactating ewe','milking ewe','early lactation ewe','suckling ewe'] },
      { key: 'ram',           label: 'Ram',              day_range: [365,730],week_range:[52,104],aliases: ['ram','breeding ram','stud ram','mature ram','male sheep','tup'] },
    ],
  },

  // ─────────────────────────────────────────────────────────
  // GOAT
  // ─────────────────────────────────────────────────────────
  goat: {
    key: 'goat',
    species: 'goat',
    species_label: 'Goat',
    type: 'goat',
    type_label: 'Goat',
    nutrix_key: 'ruminant/goat',
    aliases: [
      'goat','goats','caprine','capra','doe','buck goat','wether',
      'dairy goat','meat goat','kid goat',
      'ماعز','ماعزة','عنز','جدي'
    ],
    breeds: [
      { key: 'boer',       label: 'Boer',          nutrix_breed: null, aliases: ['boer','boer goat','south african boer','meat goat','white boer','boer doe','boer buck'] },
      { key: 'saanen',     label: 'Saanen',        nutrix_breed: null, aliases: ['saanen','saanen goat','white dairy goat','swiss saanen'] },
      { key: 'alpine',     label: 'Alpine',        nutrix_breed: null, aliases: ['alpine','alpine goat','french alpine','alpine dairy'] },
      { key: 'nubian',     label: 'Nubian',        nutrix_breed: null, aliases: ['nubian','nubian goat','anglo nubian','long eared goat'] },
      { key: 'toggenburg', label: 'Toggenburg',    nutrix_breed: null, aliases: ['toggenburg','toggenburg goat','toggi','swiss toggenburg'] },
      { key: 'lamancha',   label: 'LaMancha',      nutrix_breed: null, aliases: ['lamancha','la mancha','gopher eared','lamancha goat'] },
      { key: 'angora',     label: 'Angora',        nutrix_breed: null, aliases: ['angora','angora goat','mohair goat','fiber goat'] },
      { key: 'kiko',       label: 'Kiko',          nutrix_breed: null, aliases: ['kiko','kiko goat','new zealand kiko','kiko meat'] },
      { key: 'spanish',    label: 'Spanish',       nutrix_breed: null, aliases: ['spanish','spanish goat','brush goat','texas spanish'] },
      { key: 'cashmere',   label: 'Cashmere',      nutrix_breed: null, aliases: ['cashmere','cashmere goat','fiber','kashmir goat'] },
      { key: 'generic_goat',label:'Generic Goat',  nutrix_breed: null, aliases: ['generic goat','goat generic','standard goat','nrc goat'] },
    ],
    fallback_breed: 'generic_goat',
    phases: [
      { key: 'kid_preweaning', label: 'Kid Pre-Weaning',  day_range: [0,42],  week_range: [0,6],  aliases: ['kid','baby kid','nursing kid','suckling kid','pre-weaned kid','day 0','day 1','week 1','week 2','w1','w2'] },
      { key: 'kid_starter',    label: 'Kid Starter',      day_range: [42,70], week_range: [6,10], aliases: ['kid starter','weaned kid','starter kid','week 6','week 7','week 8','w6','w7','w8'] },
      { key: 'kid_grower',     label: 'Kid Grower',       day_range: [70,140],week_range: [10,20],aliases: ['kid grower','growing kid','grower kid','week 10','week 12','week 15','w10','w12','w15'] },
      { key: 'kid_finisher',   label: 'Kid Finisher',     day_range: [140,210],week_range:[20,30],aliases: ['kid finisher','finishing kid','market kid','chevon','kid finish','week 20','week 24','w20','w24'] },
      { key: 'doe_maintenance',label: 'Doe Maintenance',  day_range: [0,365], week_range: [0,52], aliases: ['doe','doe maintenance','dry doe','non-pregnant doe','open doe','maintenance doe','dry goat'] },
      { key: 'doe_flushing',   label: 'Doe Flushing',     day_range: [0,42],  week_range: [0,6],  aliases: ['flushing','doe flushing','pre-mating goat','goat flushing','pre breed goat'] },
      { key: 'doe_gestation',  label: 'Doe Gestation',    day_range: [0,150], week_range: [0,21], aliases: ['doe gestation','pregnant doe','goat gestation','goat pregnancy','in-kid','mid gestation goat'] },
      { key: 'doe_late_gestation',label:'Doe Late Gestation',day_range:[105,150],week_range:[15,21],aliases: ['late gestation goat','late pregnancy goat','pre kidding','last month goat','doe late gestation'] },
      { key: 'doe_lactation',  label: 'Doe Lactation',    day_range: [0,180], week_range: [0,26], aliases: ['doe lactation','lactating doe','milking doe','goat milk','dairy doe','suckling doe','lactating goat'] },
      { key: 'buck',           label: 'Buck',             day_range: [365,730],week_range:[52,104],aliases: ['buck','breeding buck','stud buck','male goat','mature buck'] },
    ],
  },

  // ─────────────────────────────────────────────────────────
  // AQUACULTURE — TILAPIA
  // ─────────────────────────────────────────────────────────
  fish_tilapia: {
    key: 'fish_tilapia',
    species: 'fish',
    species_label: 'Fish / Aquaculture',
    type: 'tilapia',
    type_label: 'Tilapia',
    nutrix_key: 'aquaculture/tilapia',
    aliases: [
      'tilapia','tilapia fish','بلطي','سمك بلطي','tilapia farming','fresh water tilapia'
    ],
    breeds: [
      { key: 'nile_tilapia',       label: 'Nile Tilapia',       nutrix_breed: null, aliases: ['nile tilapia','oreochromis niloticus','nilotica','nile','blt','بلطي نيل'] },
      { key: 'mozambique_tilapia', label: 'Mozambique Tilapia',  nutrix_breed: null, aliases: ['mozambique','mozambique tilapia','oreochromis mossambicus'] },
      { key: 'red_tilapia',        label: 'Red Tilapia',         nutrix_breed: null, aliases: ['red tilapia','tilapia red','oreochromis spp red','red hybrid tilapia'] },
      { key: 'gift',               label: 'GIFT Tilapia',        nutrix_breed: null, aliases: ['gift','gift tilapia','genetically improved tilapia'] },
      { key: 'generic_tilapia',    label: 'Generic Tilapia',     nutrix_breed: null, aliases: ['generic tilapia','tilapia generic'] },
    ],
    fallback_breed: 'generic_tilapia',
    phases: [
      { key: 'fry',      label: 'Fry',          day_range: [0,30],   week_range: [0,4],  aliases: ['fry','fry stage','tilapia fry','larval','early fry','<1g','0.1g','0.5g'] },
      { key: 'fingerling',label:'Fingerling',    day_range: [30,90],  week_range: [4,13], aliases: ['fingerling','juvenile','tilapia fingerling','small fish','1-10g','5g','10g'] },
      { key: 'grow_out', label: 'Grow-Out',      day_range: [90,210], week_range: [13,30],aliases: ['grow out','grow-out','grower','growing fish','market fish','50-200g','100g','150g','200g'] },
      { key: 'adult',    label: 'Adult / Market',day_range: [210,365],week_range: [30,52],aliases: ['adult','market size','harvest','>200g','300g','400g','500g','tilapia adult','broodstock'] },
    ],
  },

  // ─────────────────────────────────────────────────────────
  // AQUACULTURE — SALMON
  // ─────────────────────────────────────────────────────────
  fish_salmon: {
    key: 'fish_salmon',
    species: 'fish',
    species_label: 'Fish / Aquaculture',
    type: 'salmon',
    type_label: 'Salmon',
    nutrix_key: 'aquaculture/salmon',
    aliases: [
      'salmon','salmon fish','salmon farming','salmonid salmon','farmed salmon'
    ],
    breeds: [
      { key: 'atlantic_salmon', label: 'Atlantic Salmon', nutrix_breed: null, aliases: ['atlantic salmon','salmo salar','atlantic','salmon atlantic','norwegian salmon','farmed salmon'] },
      { key: 'coho_salmon',     label: 'Coho Salmon',     nutrix_breed: null, aliases: ['coho','coho salmon','silver salmon','oncorhynchus kisutch'] },
      { key: 'chinook',         label: 'Chinook Salmon',  nutrix_breed: null, aliases: ['chinook','king salmon','spring salmon','oncorhynchus tshawytscha'] },
      { key: 'generic_salmon',  label: 'Generic Salmon',  nutrix_breed: null, aliases: ['generic salmon','salmon generic'] },
    ],
    fallback_breed: 'generic_salmon',
    phases: [
      { key: 'salmon_fry',         label: 'Salmon Fry / Parr',   day_range: [0,90],  week_range: [0,13],  aliases: ['fry','salmon fry','parr','alevins','0.1g','1g','small salmon'] },
      { key: 'salmon_smolt',       label: 'Smolt',                day_range: [90,365],week_range: [13,52], aliases: ['smolt','smoltification','pre-smolt','salmon smolt','sea water adaptation'] },
      { key: 'salmon_post_smolt',  label: 'Post-Smolt (Sea)',     day_range: [365,547],week_range:[52,78], aliases: ['post smolt','sea water','post-smolt','early sea','<1kg salmon','300g-1kg'] },
      { key: 'salmon_grow_out',    label: 'Salmon Grow-Out',      day_range: [547,730],week_range:[78,104],aliases: ['grow out salmon','salmon grow','grower salmon','1-3kg salmon','harvest salmon','market salmon'] },
    ],
  },

  // ─────────────────────────────────────────────────────────
  // AQUACULTURE — TROUT
  // ─────────────────────────────────────────────────────────
  fish_trout: {
    key: 'fish_trout',
    species: 'fish',
    species_label: 'Fish / Aquaculture',
    type: 'trout',
    type_label: 'Trout',
    nutrix_key: 'aquaculture/trout',
    aliases: [
      'trout','salmonid trout','steel head','trout fish','trout farming'
    ],
    breeds: [
      { key: 'rainbow_trout', label: 'Rainbow Trout', nutrix_breed: null, aliases: ['rainbow trout','rainbow','oncorhynchus mykiss','steelhead','trout rainbow'] },
      { key: 'brown_trout',   label: 'Brown Trout',   nutrix_breed: null, aliases: ['brown trout','salmo trutta','trout brown'] },
      { key: 'brook_trout',   label: 'Brook Trout',   nutrix_breed: null, aliases: ['brook trout','brook','salvelinus fontinalis','char trout'] },
      { key: 'generic_trout', label: 'Generic Trout', nutrix_breed: null, aliases: ['generic trout','trout generic'] },
    ],
    fallback_breed: 'generic_trout',
    phases: [
      { key: 'trout_fry',     label: 'Trout Fry',      day_range: [0,60],  week_range: [0,9],  aliases: ['fry','trout fry','alevins','sac fry','early trout','<5g trout'] },
      { key: 'trout_fingerling',label:'Trout Fingerling',day_range:[60,120],week_range:[9,17], aliases: ['fingerling trout','juvenile trout','5-50g trout','small trout'] },
      { key: 'trout_grow_out',label: 'Trout Grow-Out', day_range: [120,365],week_range:[17,52],aliases: ['grow out trout','trout grow','market trout','100-500g trout','harvest trout'] },
    ],
  },

  // ─────────────────────────────────────────────────────────
  // AQUACULTURE — CATFISH
  // ─────────────────────────────────────────────────────────
  fish_catfish: {
    key: 'fish_catfish',
    species: 'fish',
    species_label: 'Fish / Aquaculture',
    type: 'catfish',
    type_label: 'Catfish',
    nutrix_key: 'aquaculture/catfish',
    aliases: [
      'catfish','pangasius','basa','tra fish','كاتفيش','سمك القرموط','catfish farming'
    ],
    breeds: [
      { key: 'channel_catfish', label: 'Channel Catfish',  nutrix_breed: null, aliases: ['channel catfish','channel','ictalurus punctatus','american catfish'] },
      { key: 'pangasius',       label: 'Pangasius / Basa', nutrix_breed: null, aliases: ['pangasius','basa','pangasionodon hypophthalmus','tra','striped catfish','swai','siamese catfish'] },
      { key: 'walking_catfish', label: 'Walking Catfish',  nutrix_breed: null, aliases: ['walking catfish','clarias','clarias gariepinus','african catfish'] },
      { key: 'generic_catfish', label: 'Generic Catfish',  nutrix_breed: null, aliases: ['generic catfish','catfish generic'] },
    ],
    fallback_breed: 'generic_catfish',
    phases: [
      { key: 'catfish_fry',     label: 'Catfish Fry',      day_range: [0,30],  week_range: [0,4],  aliases: ['fry','catfish fry','catfish larval','0.1g catfish','small catfish'] },
      { key: 'catfish_fingerling',label:'Catfish Fingerling',day_range:[30,90],week_range:[4,13], aliases: ['fingerling catfish','juvenile catfish','5-50g catfish'] },
      { key: 'catfish_grow_out',label: 'Catfish Grow-Out', day_range: [90,270],week_range:[13,38],aliases: ['grow out catfish','catfish grow','market catfish','100-500g catfish','harvest catfish'] },
    ],
  },

  // ─────────────────────────────────────────────────────────
  // AQUACULTURE — CARP
  // ─────────────────────────────────────────────────────────
  fish_carp: {
    key: 'fish_carp',
    species: 'fish',
    species_label: 'Fish / Aquaculture',
    type: 'carp',
    type_label: 'Carp',
    nutrix_key: 'aquaculture/carp',
    aliases: [
      'carp','common carp','grass carp','silver carp','bighead carp','koi',
      'cyprinus carpio','ctenopharyngodon idella','شبوط','مشط'
    ],
    breeds: [
      { key: 'common_carp',  label: 'Common Carp',   nutrix_breed: null, aliases: ['common carp','cyprinus carpio','mirror carp','leather carp','koi','koi carp'] },
      { key: 'grass_carp',   label: 'Grass Carp',    nutrix_breed: null, aliases: ['grass carp','ctenopharyngodon','white amur','grass fish'] },
      { key: 'silver_carp',  label: 'Silver Carp',   nutrix_breed: null, aliases: ['silver carp','hypophthalmichthys molitrix','filter feeder carp'] },
      { key: 'bighead_carp', label: 'Bighead Carp',  nutrix_breed: null, aliases: ['bighead','bighead carp','hypophthalmichthys nobilis'] },
      { key: 'rohu',         label: 'Rohu',          nutrix_breed: null, aliases: ['rohu','labeo rohita','rui','rohita'] },
      { key: 'catla',        label: 'Catla',         nutrix_breed: null, aliases: ['catla','catla catla','major carp'] },
      { key: 'generic_carp', label: 'Generic Carp',  nutrix_breed: null, aliases: ['generic carp','carp generic','indian carp'] },
    ],
    fallback_breed: 'generic_carp',
    phases: [
      { key: 'carp_fry',     label: 'Carp Fry',      day_range: [0,30],  week_range: [0,4],  aliases: ['fry','carp fry','larval carp'] },
      { key: 'carp_fingerling',label:'Carp Fingerling',day_range:[30,90], week_range:[4,13],  aliases: ['fingerling carp','juvenile carp','small carp'] },
      { key: 'carp_grow_out',label: 'Carp Grow-Out', day_range: [90,365],week_range:[13,52], aliases: ['grow out carp','carp grow','market carp','table carp'] },
    ],
  },

  // ─────────────────────────────────────────────────────────
  // AQUACULTURE — SHRIMP
  // ─────────────────────────────────────────────────────────
  shrimp: {
    key: 'shrimp',
    species: 'crustacean',
    species_label: 'Shrimp / Crustacean',
    type: 'shrimp',
    type_label: 'Shrimp',
    nutrix_key: 'aquaculture/shrimp',
    aliases: [
      'shrimp','prawns','vannamei','vannamei shrimp','black tiger','monodon','litopenaeus',
      'penaeus','pacific white shrimp','giant freshwater prawn',
      'روبيان','جمبري','كريفيت'
    ],
    breeds: [
      { key: 'vannamei',    label: 'Pacific White (Vannamei)', nutrix_breed: null, aliases: ['vannamei','litopenaeus vannamei','pacific white','white shrimp','penaeus vannamei','whiteleg shrimp','spr shrimp','wssv tolerant'] },
      { key: 'monodon',     label: 'Black Tiger (Monodon)',    nutrix_breed: null, aliases: ['monodon','black tiger','penaeus monodon','tiger shrimp','giant tiger','tiger prawn'] },
      { key: 'freshwater_prawn',label:'Giant Freshwater Prawn',nutrix_breed: null, aliases: ['freshwater prawn','giant freshwater','macrobrachium','prawn','giant prawn','freshwater shrimp'] },
      { key: 'generic_shrimp',label:'Generic Shrimp',          nutrix_breed: null, aliases: ['generic shrimp','shrimp generic','prawn generic'] },
    ],
    fallback_breed: 'generic_shrimp',
    phases: [
      { key: 'shrimp_nauplius',label: 'Nauplius / Larvae',   day_range: [0,10],  week_range: [0,2],  aliases: ['nauplius','larvae','larval shrimp','early shrimp','zoea','mysis'] },
      { key: 'shrimp_pl',     label: 'Post-Larvae (PL)',      day_range: [10,30], week_range: [2,4],  aliases: ['pl','post larvae','post-larvae','pl shrimp','pl5','pl10','pl15','pl20'] },
      { key: 'shrimp_juvenile',label:'Juvenile Shrimp',       day_range: [30,60], week_range: [4,9],  aliases: ['juvenile shrimp','juvenile','young shrimp','<2g shrimp','1g shrimp'] },
      { key: 'shrimp_grow_out',label:'Shrimp Grow-Out',       day_range: [60,120],week_range: [9,17], aliases: ['grow out shrimp','shrimp grow','grower shrimp','market shrimp','2-20g shrimp','harvest shrimp'] },
    ],
  },

  // ─────────────────────────────────────────────────────────
  // AQUACULTURE — SEA BASS / BARRAMUNDI
  // ─────────────────────────────────────────────────────────
  fish_seabass: {
    key: 'fish_seabass',
    species: 'fish',
    species_label: 'Fish / Aquaculture',
    type: 'seabass',
    type_label: 'Sea Bass / Barramundi',
    nutrix_key: 'aquaculture/seabass',
    aliases: [
      'sea bass','seabass','barramundi','lates calcarifer','european sea bass','dicentrarchus',
      'asian sea bass','barramundi fish','snook','قاروص'
    ],
    breeds: [
      { key: 'barramundi',    label: 'Asian Sea Bass (Barramundi)', nutrix_breed: null, aliases: ['barramundi','lates calcarifer','asian sea bass','asian seabass','barra'] },
      { key: 'european_seabass',label:'European Sea Bass',          nutrix_breed: null, aliases: ['european sea bass','dicentrarchus labrax','mediterranean sea bass','european seabass','loup de mer'] },
      { key: 'generic_seabass',label:'Generic Sea Bass',            nutrix_breed: null, aliases: ['generic sea bass','seabass generic'] },
    ],
    fallback_breed: 'generic_seabass',
    phases: [
      { key: 'seabass_juvenile',label:'Juvenile',    day_range: [0,90],  week_range: [0,13], aliases: ['juvenile sea bass','small sea bass','<50g sea bass','fry seabass','fingerling seabass'] },
      { key: 'seabass_grow_out',label:'Grow-Out',    day_range: [90,365],week_range:[13,52], aliases: ['grow out sea bass','sea bass grow','grower sea bass','market sea bass','200-500g sea bass'] },
    ],
  },

  // ─────────────────────────────────────────────────────────
  // AQUACULTURE — MILKFISH
  // ─────────────────────────────────────────────────────────
  fish_milkfish: {
    key: 'fish_milkfish',
    species: 'fish',
    species_label: 'Fish / Aquaculture',
    type: 'milkfish',
    type_label: 'Milkfish',
    nutrix_key: 'aquaculture/milkfish',
    aliases: ['milkfish','bangus','chanos chanos','milkfish farming','bangus fish'],
    breeds: [
      { key: 'generic_milkfish', label: 'Milkfish (Bangus)', nutrix_breed: null, aliases: ['milkfish','bangus','chanos','bangus fry','milkfish fry'] },
    ],
    fallback_breed: 'generic_milkfish',
    phases: [
      { key: 'milkfish_fry',     label: 'Fry / Fingerling', day_range: [0,60],  week_range: [0,9],  aliases: ['fry','fingerling','milkfish fry','bangus fry','small bangus'] },
      { key: 'milkfish_grow_out',label: 'Grow-Out',          day_range: [60,180],week_range:[9,26],  aliases: ['grow out','milkfish grow','bangus grow','market bangus','300-500g'] },
    ],
  },

  // ─────────────────────────────────────────────────────────
  // RABBIT
  // ─────────────────────────────────────────────────────────
  rabbit: {
    key: 'rabbit',
    species: 'rabbit',
    species_label: 'Rabbit',
    type: 'rabbit',
    type_label: 'Rabbit',
    nutrix_key: 'rabbit/rabbit',
    aliases: [
      'rabbit','rabbits','bunny','bunnies','oryctolagus','commercial rabbit','meat rabbit',
      'angora rabbit','rex rabbit',
      'أرنب','أرانب'
    ],
    breeds: [
      { key: 'nz_white',     label: 'New Zealand White', nutrix_breed: null, aliases: ['new zealand white','nz white','nzw','nzw rabbit','white rabbit','nz rabbit'] },
      { key: 'california',   label: 'California',        nutrix_breed: null, aliases: ['california','californian','california rabbit','cal rabbit'] },
      { key: 'rex',          label: 'Rex',               nutrix_breed: null, aliases: ['rex','rex rabbit','mini rex','velveteen rex'] },
      { key: 'flemish_giant',label: 'Flemish Giant',     nutrix_breed: null, aliases: ['flemish giant','flemish','giant rabbit','flemish giant rabbit','big rabbit'] },
      { key: 'dutch',        label: 'Dutch',             nutrix_breed: null, aliases: ['dutch','dutch rabbit','dutch breed'] },
      { key: 'angora',       label: 'Angora',            nutrix_breed: null, aliases: ['angora rabbit','english angora','french angora','fiber rabbit'] },
      { key: 'chinchilla',   label: 'Chinchilla',        nutrix_breed: null, aliases: ['chinchilla rabbit','standard chinchilla','giant chinchilla'] },
      { key: 'generic_rabbit',label:'Generic Rabbit',    nutrix_breed: null, aliases: ['generic rabbit','rabbit generic','standard rabbit','nrc rabbit'] },
    ],
    fallback_breed: 'generic_rabbit',
    phases: [
      { key: 'kit',          label: 'Kit / Suckling',     day_range: [0,28],  week_range: [0,4],  aliases: ['kit','kits','suckling rabbit','nursing rabbit','baby rabbit','newborn rabbit','day 0','day 1','week 1','week 2','w1','w2'] },
      { key: 'weaner',       label: 'Weaner',             day_range: [28,56], week_range: [4,8],  aliases: ['weaner','weaned rabbit','post weaning rabbit','week 4','week 5','week 6','week 7','week 8','w4','w5','w6','w7','w8'] },
      { key: 'grower',       label: 'Grower',             day_range: [56,84], week_range: [8,12], aliases: ['grower','growing rabbit','grow rabbit','week 8','week 9','week 10','week 11','week 12','w8','w9','w10','w11'] },
      { key: 'finisher',     label: 'Finisher',           day_range: [84,120],week_range: [12,17],aliases: ['finisher','finishing rabbit','market rabbit','meat rabbit','final rabbit','week 12','week 13','week 14','week 16','w12','w13','w14','w16'] },
      { key: 'doe_gestation',label: 'Doe Gestation',      day_range: [0,31],  week_range: [0,4],  aliases: ['doe gestation','pregnant doe','rabbit gestation','pregnant rabbit','gestation rabbit'] },
      { key: 'doe_lactation',label: 'Doe Lactation',      day_range: [0,28],  week_range: [0,4],  aliases: ['doe lactation','nursing doe','lactating rabbit','suckling doe','doe nursing','rabbit lactation'] },
      { key: 'buck',         label: 'Buck',               day_range: [120,365],week_range:[17,52],aliases: ['buck rabbit','breeding buck','stud rabbit','male rabbit','rabbit buck'] },
    ],
  },

  // ─────────────────────────────────────────────────────────
  // HORSE / EQUINE
  // ─────────────────────────────────────────────────────────
  horse: {
    key: 'horse',
    species: 'equine',
    species_label: 'Equine',
    type: 'horse',
    type_label: 'Horse',
    nutrix_key: 'equine/horse',
    aliases: [
      'horse','horses','equine','equines','pony','ponies','stallion','mare','gelding',
      'thoroughbred horse','warmblood','draft horse','arabian horse',
      'حصان','فرس','خيل','فرس'
    ],
    breeds: [
      { key: 'thoroughbred',  label: 'Thoroughbred',  nutrix_breed: null, aliases: ['thoroughbred','tb horse','racing horse','race horse','thoroughbred horse','blood horse'] },
      { key: 'warmblood',     label: 'Warmblood',     nutrix_breed: null, aliases: ['warmblood','warmblood horse','sport horse','hanoverian','holsteiner','dutch warmblood','kwpn'] },
      { key: 'quarter_horse', label: 'Quarter Horse', nutrix_breed: null, aliases: ['quarter horse','quarter','qh','american quarter horse','western horse'] },
      { key: 'arabian',       label: 'Arabian',       nutrix_breed: null, aliases: ['arabian','arab horse','arabian horse','arabic horse','pure arabian','pa'] },
      { key: 'draft',         label: 'Draft Horse',   nutrix_breed: null, aliases: ['draft horse','draught horse','heavy horse','cold blood','percheron','clydesdale','shire','belgian draft'] },
      { key: 'standardbred',  label: 'Standardbred',  nutrix_breed: null, aliases: ['standardbred','harness horse','trotter','pacer'] },
      { key: 'pony',          label: 'Pony',          nutrix_breed: null, aliases: ['pony','ponies','shetland','shetland pony','welsh pony','connemara','pony breed'] },
      { key: 'generic_horse', label: 'Generic Horse', nutrix_breed: null, aliases: ['generic horse','horse generic','standard horse','nrc horse'] },
    ],
    fallback_breed: 'generic_horse',
    phases: [
      { key: 'foal_suckling',  label: 'Foal (Suckling)',    day_range: [0,150], week_range: [0,21], aliases: ['foal','suckling foal','nursing foal','newborn foal','baby horse','foal suckling','0-5 months'] },
      { key: 'weanling',       label: 'Weanling',           day_range: [150,365],week_range:[21,52],aliases: ['weanling','weaned foal','weanling horse','6-12 months horse','yearling prep'] },
      { key: 'yearling',       label: 'Yearling',           day_range: [365,547],week_range:[52,78],aliases: ['yearling','1 year old horse','yearling horse','12-18 months horse'] },
      { key: 'two_year_old',   label: '2-Year-Old in Training',day_range:[547,730],week_range:[78,104],aliases: ['2 year old','2yo','two year','two year old horse','breaking horse','training horse'] },
      { key: 'performance',    label: 'Performance / Racing',day_range: [730,3650],week_range:[104,520],aliases: ['performance','racing','race horse performance','sport horse performance','competition horse','working horse','heavy work'] },
      { key: 'maintenance',    label: 'Maintenance / Idle', day_range: [730,3650],week_range:[104,520],aliases: ['maintenance','idle horse','rest horse','easy work','light work','pasture horse','retired horse','paddock horse'] },
      { key: 'broodmare_gestation',label:'Broodmare Gestation',day_range:[0,340],week_range:[0,49], aliases: ['broodmare','broodmare gestation','pregnant mare','in-foal mare','mare gestation','late gestation mare'] },
      { key: 'broodmare_lactation',label:'Broodmare Lactation',day_range:[0,150],week_range:[0,21], aliases: ['broodmare lactation','lactating mare','nursing mare','mare lactation','suckling mare'] },
      { key: 'stallion',       label: 'Breeding Stallion',  day_range: [730,3650],week_range:[104,520],aliases: ['stallion','breeding stallion','stud horse','stud stallion','male horse breeding'] },
    ],
  },

};

// ─────────────────────────────────────────────────────────
// SPECIES-LEVEL QUICK ALIASES (top-level species grouping)
// ─────────────────────────────────────────────────────────
const SPECIES_ALIASES = {
  poultry: {
    label: 'Poultry',
    keys: ['poultry_broiler','poultry_layer','poultry_broiler_breeder','poultry_turkey','poultry_duck','poultry_quail','poultry_goose'],
    aliases: ['poultry','bird','birds','fowl','avian','chicken','hen','rooster','cock','دجاج'],
  },
  cattle: {
    label: 'Cattle',
    keys: ['dairy','beef'],
    aliases: ['cattle','cow','cows','bovine','bos taurus','ruminant','بقر','أبقار'],
  },
  ruminant: {
    label: 'Ruminant',
    keys: ['dairy','beef','sheep','goat'],
    aliases: ['ruminant','ruminants','small ruminant','livestock','حيوانات مجترة'],
  },
  swine: {
    label: 'Swine / Pig',
    keys: ['swine'],
    aliases: ['pig','swine','pork','hog','خنزير'],
  },
  fish: {
    label: 'Fish / Aquaculture',
    keys: ['fish_tilapia','fish_salmon','fish_trout','fish_catfish','fish_carp','fish_seabass','fish_milkfish'],
    aliases: ['fish','aquaculture','aqua','سمك','water animals','marine','freshwater fish'],
  },
  crustacean: {
    label: 'Shrimp / Crustacean',
    keys: ['shrimp'],
    aliases: ['shrimp','prawn','crustacean','seafood shrimp','روبيان'],
  },
  rabbit: {
    label: 'Rabbit',
    keys: ['rabbit'],
    aliases: ['rabbit','bunny','أرنب'],
  },
  equine: {
    label: 'Equine / Horse',
    keys: ['horse'],
    aliases: ['horse','equine','pony','mare','stallion','حصان'],
  },
};

module.exports = { DIET_INTENT_DB, SPECIES_ALIASES };
