[CmdletBinding()]
param(
    [Parameter(Position = 0, Mandatory = $false)]
    [string]$Operation
)

$ErrorActionPreference = 'Stop'

if ($args.Count -ne 0 -or ($Operation -ne 'protect' -and $Operation -ne 'unprotect')) {
    exit 64
}

$inputBytes = $null
$outputBytes = $null
$memoryStream = $null

try {
    Add-Type -AssemblyName System.Security
    $standardInput = [Console]::OpenStandardInput()
    $memoryStream = New-Object System.IO.MemoryStream
    $standardInput.CopyTo($memoryStream)
    $inputBytes = $memoryStream.ToArray()

    if ($inputBytes.Length -eq 0) {
        exit 65
    }

    if ($Operation -eq 'protect') {
        $outputBytes = [System.Security.Cryptography.ProtectedData]::Protect(
            $inputBytes,
            $null,
            [System.Security.Cryptography.DataProtectionScope]::CurrentUser
        )
    }
    else {
        $outputBytes = [System.Security.Cryptography.ProtectedData]::Unprotect(
            $inputBytes,
            $null,
            [System.Security.Cryptography.DataProtectionScope]::CurrentUser
        )
    }

    $standardOutput = [Console]::OpenStandardOutput()
    $standardOutput.Write($outputBytes, 0, $outputBytes.Length)
    $standardOutput.Flush()
}
catch {
    exit 1
}
finally {
    if ($null -ne $inputBytes) {
        [Array]::Clear($inputBytes, 0, $inputBytes.Length)
    }
    if ($null -ne $outputBytes) {
        [Array]::Clear($outputBytes, 0, $outputBytes.Length)
    }
    if ($null -ne $memoryStream) {
        $memoryStream.Dispose()
    }
}
