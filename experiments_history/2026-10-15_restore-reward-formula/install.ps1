$ErrorActionPreference = 'Stop'
python -m prompt_kernel --install
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
python -m prompt_kernel --claude --install
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
python -m prompt_kernel --cursor --install
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
python -m prompt_kernel --codex --install
exit $LASTEXITCODE
