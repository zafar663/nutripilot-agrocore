$body = @{
  locale="US"; species="poultry"; type="duck"; production="meat"; breed="pekin_generic";
  phase="starter"; region="us"; version="v1"; normalize=$true;
  formula_text=@"
Corn 47.89
SBM 48 34
Oil 8
Limestone 1.6
DCP 2.56
Salt 0.45
DL-Met 0.40
L-Lys HCl 0.15
"@
} | ConvertTo-Json

$r = Invoke-RestMethod "http://localhost:3001/v1/analyze" -Method Post -ContentType "application/json" -Body $body

if ($r.meta.ingredients_mode -ne "structured") { throw "FAIL: ingredients_mode not structured" }
if ($r.meta.reqKey -ne "poultry_duck_meat_generic_starter_v1") { throw "FAIL: reqKey mismatch: $($r.meta.reqKey)" }

$missing = @($r.meta.resolution_map | Where-Object { -not $_.found_in_db })
if ($missing.Count -gt 0) { throw ("FAIL: missing DB hits") }

$bad = @($r.evaluation.findings | Where-Object { $_.status -ne "OK" })
if ($bad.Count -gt 0) { throw ("FAIL: evaluation not OK") }

Write-Host "PASS ✅ Duck Starter Golden Test" -ForegroundColor Green
