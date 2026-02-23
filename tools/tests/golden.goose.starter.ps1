$body = @{
  locale="US"; species="poultry"; type="goose"; production="meat"; breed="generic";
  phase="starter"; region="us"; version="v1"; normalize=$true;
  formula_text=@"
Corn 54
SBM 48 30
Oil 6
Limestone 1.5
DCP 2.2
Salt 0.35
DL-Met 0.25
L-Lys HCl 0.15
"@
} | ConvertTo-Json

$r = Invoke-RestMethod "http://localhost:3001/v1/analyze" -Method Post -ContentType "application/json" -Body $body

if ($r.meta.ingredients_mode -ne "structured") { throw "FAIL: ingredients_mode not structured" }
if ($r.meta.reqKey -notlike "poultry_goose_*_starter_v1") { throw "FAIL: reqKey unexpected: $($r.meta.reqKey)" }

$missing = @($r.meta.resolution_map | Where-Object { -not $_.found_in_db })
if ($missing.Count -gt 0) { throw ("FAIL: missing DB hits: " + ($missing | ConvertTo-Json -Depth 6)) }

if (-not $r.evaluation -or -not $r.evaluation.findings -or $r.evaluation.findings.Count -eq 0) {
  throw "FAIL: no evaluation findings returned"
}
if ($r.overall -eq "NO_REQUIREMENTS") {
  throw "FAIL: NO_REQUIREMENTS"
}

Write-Host "PASS ✅ Goose Starter SMOKE Test (requirements may be placeholder)" -ForegroundColor Green
