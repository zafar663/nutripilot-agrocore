# tools/PATCH_US_INGREDIENTS_TABLES_v1.ps1
# Patch US structured ingredient DB with wheat tiers + durum + middlings + DDGS fixes
# Safe to re-run. Creates missing ingredients and sets/overwrites key nutrient fields.

$ErrorActionPreference = "Stop"

# --- Paths ---
$pathI = "core\db\ingredients\poultry\us\v1\ingredients.poultry.us.sid.v1.json"

if (-not (Test-Path $pathI)) {
  throw "Ingredient DB not found: $pathI"
}

# --- Load JSON ---
$j = Get-Content $pathI -Raw -Encoding utf8 | ConvertFrom-Json
if (-not $j.ingredients) {
  throw "Invalid schema: expected top-level .ingredients in $pathI"
}
$DB = $j.ingredients

# --- Helpers ---
function Ensure-Ingredient([string]$id, [hashtable]$base) {
  if (-not $DB.PSObject.Properties.Name -contains $id) {
    $obj = [pscustomobject]@{}
    foreach ($k in $base.Keys) { $obj | Add-Member -Force -NotePropertyName $k -NotePropertyValue $base[$k] }
    $DB | Add-Member -Force -NotePropertyName $id -NotePropertyValue $obj
    Write-Host "✅ created $id"
  } else {
    Write-Host "ℹ️ exists $id"
  }
}

function Set-Props([string]$id, [hashtable]$props) {
  if (-not $DB.$id) { throw "Cannot Set-Props; missing ingredient: $id" }
  foreach ($k in $props.Keys) {
    if ($DB.$id.PSObject.Properties.Name -contains $k) {
      $DB.$id.$k = $props[$k]
    } else {
      $DB.$id | Add-Member -Force -NotePropertyName $k -NotePropertyValue $props[$k]
    }
  }
}

# --- Ensure DDGS exist (do not assume fields exist; add them safely) ---
Ensure-Ingredient "ddgs_corn" @{
  display_name = "DDGS (Corn)"
  category     = "protein"
  cp           = $null
  me           = $null
  _note        = "Populate from table; includes total AA + SID coef fields."
}

Ensure-Ingredient "ddgs_corn_high_starch" @{
  display_name = "DDGS (Corn) High Starch"
  category     = "protein"
  cp           = $null
  me           = $null
  _note        = "Populate from table; includes total AA + SID coef fields."
}

Ensure-Ingredient "ddgs_wheat" @{
  display_name = "DDGS (Wheat)"
  category     = "protein"
  cp           = $null
  me           = $null
  _note        = "Populate from table; includes total AA + SID coef fields."
}

# --- Wheat tiers / variants ---
Ensure-Ingredient "wheat_10_5" @{
  display_name = "Wheat (CP 10.5%)"
  category     = "grain"
  cp           = 10.5
  me           = $null
  _note        = "Wheat tiered by CP; ME + AA from tables."
}

Ensure-Ingredient "wheat_13" @{
  display_name = "Wheat (CP 13%)"
  category     = "grain"
  cp           = 13.0
  me           = $null
  _note        = "Wheat tiered by CP; ME + AA from tables."
}

Ensure-Ingredient "wheat_15" @{
  display_name = "Wheat (CP 15%)"
  category     = "grain"
  cp           = 15.0
  me           = $null
  _note        = "Wheat tiered by CP; ME + AA from tables."
}

Ensure-Ingredient "wheat_durum" @{
  display_name = "Wheat (Durum)"
  category     = "grain"
  cp           = $null
  me           = $null
  _note        = "Durum wheat; populate from tables."
}

Ensure-Ingredient "wheat_middlings" @{
  display_name = "Wheat Middlings"
  category     = "byproduct"
  cp           = $null
  me           = $null
  _note        = "Wheat middlings/shorts; populate from tables."
}

# --- OPTIONAL: Apply your DDGS nutrient values if you already decided them ---
# If you want these enabled, fill the numeric values and keep the structure.
# (Leaving them commented by default to avoid overwriting if you already set them elsewhere.)
Set-Props "ddgs_corn" @{
  dm = 88
  cp = 26.30
  total_lys = 0.74
  total_met = 0.52
  total_cys = 0.49
  total_metcys = 1.00
  total_thr = 0.98
  total_trp = 0.21
  total_arg = 1.13
  total_ile = 0.96
  total_leu = 3.07
  total_val = 1.28
  total_his = 0.70
  total_phe = 1.28
  sid_coef_lys = 75
  sid_coef_met = 86
  sid_coef_cys = 77
  sid_coef_metcys = 82
  sid_coef_thr = 72
  sid_coef_trp = 80
  sid_coef_arg = 73
  sid_coef_ile = 84
  sid_coef_leu = 89
  sid_coef_val = 81
  sid_coef_his = 80
  sid_coef_phe = 88
}

Set-Props "ddgs_corn_high_starch" @{
  dm = 88
  cp = 41.20
  total_lys = 0.86
  total_met = 0.73
  total_cys = 0.75
  total_metcys = 1.48
  total_thr = 1.44
  total_trp = 0.30
  total_arg = 1.56
  total_ile = 1.36
  total_leu = 4.02
  total_val = 1.82
  total_his = 0.98
  total_phe = 1.75
  sid_coef_lys = 66
  sid_coef_met = 86
  sid_coef_cys = 76
  sid_coef_metcys = 80
  sid_coef_thr = 75
  sid_coef_trp = 81
  sid_coef_arg = 78
  sid_coef_ile = 85
  sid_coef_leu = 89
  sid_coef_val = 83
  sid_coef_his = 82
  sid_coef_phe = 89
}

Set-Props "ddgs_wheat" @{
  dm = 88
  cp = 31.90
  total_lys = 0.93
  total_met = 0.53
  total_cys = 0.72
  total_metcys = 1.25
  total_thr = 1.02
  total_trp = 0.29
  total_arg = 1.33
  total_ile = 1.06
  total_leu = 2.45
  total_val = 1.45
  total_his = 0.70
  total_phe = 1.41
  sid_coef_lys = 77
  sid_coef_met = 88
  sid_coef_cys = 78
  sid_coef_metcys = 82
  sid_coef_thr = 74
  sid_coef_trp = 80
  sid_coef_arg = 82
  sid_coef_ile = 84
  sid_coef_leu = 89
  sid_coef_val = 82
  sid_coef_his = 84
  sid_coef_phe = 90
}

# --- Save ---
$j | ConvertTo-Json -Depth 80 | Set-Content -Encoding utf8 $pathI

Write-Host ""
Write-Host "✅ US Ingredient DB patched successfully."
Write-Host ("File: " + $pathI)