param([Parameter(Mandatory=$true)][string]$Config)
$python=$env:CS2_PYTHON
if(!$python){$python=Join-Path (Split-Path $PSScriptRoot -Parent) '..\.venv312\Scripts\python.exe'}
if(!(Test-Path $python)){$python=(Get-Command python.exe).Source}
& $python (Join-Path $PSScriptRoot 'hlae_wrapper.py') $Config
exit $LASTEXITCODE
