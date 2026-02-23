$ErrorActionPreference = "Stop"

$testsDir = Join-Path $PSScriptRoot "."
$tests = Get-ChildItem -Path $testsDir -Filter "golden.*.ps1" -File | Sort-Object Name

if (-not $tests -or $tests.Count -eq 0) {
  throw "No golden tests found in $testsDir (expected files like golden.duck.starter.ps1)."
}

Write-Host ("Running {0} golden test(s)..." -f $tests.Count) -ForegroundColor Cyan

$passed = 0
$failed = 0
$failures = @()

foreach ($t in $tests) {
  Write-Host ("`n==> {0}" -f $t.Name) -ForegroundColor Yellow
  try {
    & $t.FullName
    $passed++
  } catch {
    $failed++
    $failures += [pscustomobject]@{
      test = $t.Name
      error = $_.Exception.Message
    }
    Write-Host ("FAIL ❌ {0}" -f $t.Name) -ForegroundColor Red
    Write-Host ("  " + $_.Exception.Message) -ForegroundColor DarkRed
    break  # fail-fast (remove this line if you want to run all even after failures)
  }
}

Write-Host ("`nSummary: PASS={0} FAIL={1}" -f $passed, $failed) -ForegroundColor Cyan

if ($failed -gt 0) {
  Write-Host "`nFailures:" -ForegroundColor Red
  $failures | Format-Table -AutoSize | Out-String | Write-Host
  exit 1
}

exit 0
