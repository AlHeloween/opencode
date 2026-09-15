Get-Process -Name opencode,bun,node -ErrorAction SilentlyContinue | ForEach-Object {
  '{0} pid={1} mem={2}MB' -f $_.ProcessName, $_.Id, [math]::Round($_.WorkingSet64/1MB,1)
}