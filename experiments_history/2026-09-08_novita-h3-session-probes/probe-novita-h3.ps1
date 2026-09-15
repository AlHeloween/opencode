# HTTP/3 (QUIC) client probe — differential design:
#   control: cloudflare-quic.com  (known-good public HTTP/3 endpoint)
#   target : api.novita.ai        (advertises alt-svc: h3=":443" on every response)
#
# Requires PowerShell 7+ (.NET 7/8) and Windows 11 22H2+ / Server 2022+ for
# OS-bundled MsQuic. On Windows 10 .NET throws PlatformNotSupportedException —
# that is itself a decisive answer about the CLIENT, not the server.
#
# Run: pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/probe-novita-h3.ps1

$ErrorActionPreference = "Continue"

Write-Host "OS   : $([Environment]::OSVersion.VersionString)"
Write-Host ".NET : $([Environment]::Version)"
Write-Host ""

function Probe-H3([string]$url) {
    Write-Host "--- GET $url ---"
    $req = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Get, $url)
    $req.Version = [version]"3.0"
    $req.VersionPolicy = [System.Net.Http.HttpVersionPolicy]::RequestVersionOrHigher
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $client = [System.Net.Http.HttpClient]::new()
        $client.Timeout = [TimeSpan]::FromSeconds(15)
        $resp = $client.SendAsync($req).GetAwaiter().GetResult()
        $sw.Stop()
        Write-Host ("status: {0} | negotiated: HTTP/{1} | {2}ms" -f [int]$resp.StatusCode, $resp.Version, $sw.ElapsedMilliseconds)
        $altsvc = $null
        if ($resp.Headers.TryGetValues("alt-svc", [ref]$altsvc)) {
            Write-Host "alt-svc: $($altsvc -join '; ')"
        }
        return ($resp.Version.Major -eq 3)
    }
    catch {
        $sw.Stop()
        Write-Host "FAILED after $($sw.ElapsedMilliseconds)ms: $($_.Exception.Message)"
        if ($_.Exception.InnerException) { Write-Host "inner: $($_.Exception.InnerException.Message)" }
        return $false
    }
}

Write-Host "=== control (known-good h3) ==="
$controlOk = Probe-H3 "https://cloudflare-quic.com/"

Write-Host ""
Write-Host "=== target (api.novita.ai) ==="
$targetOk = Probe-H3 "https://api.novita.ai/v3/openai/models"

Write-Host ""
Write-Host "=== Verdict ==="
if ($controlOk -and $targetOk) {
    Write-Host "HTTP/3 WORKS on api.novita.ai (not just advertised)."
} elseif ($controlOk -and -not $targetOk) {
    Write-Host "Client can do h3, but api.novita.ai does NOT serve h3 -> alt-svc is advertisement-only."
} elseif (-not $controlOk) {
    Write-Host "Client/OS cannot do h3 at all (control failed) -> probe inconclusive about Novita."
}
