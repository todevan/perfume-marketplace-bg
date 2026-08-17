param(
  [Parameter(Mandatory=$true)][ValidateSet('migration-self-test','hosted-self-test','hosted-preflight','hosted-execute','hosted-cleanup')][string]$Mode,
  [string]$CandidateSha
)
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $MyInvocation.MyCommand.Path
$private=Join-Path $root 'private'
New-Item -ItemType Directory -Force -Path $private | Out-Null
$sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User
$entries=@((Get-Acl -LiteralPath $private).Access)
if($entries.Count -ne 1 -or $entries[0].IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value -ne $sid.Value -or $entries[0].AccessControlType -ne 'Allow' -or $entries[0].IsInherited){
  $identity=[System.Security.Principal.WindowsIdentity]::GetCurrent().Name
  & icacls.exe $private /inheritance:r /grant:r "${identity}:(OI)(CI)F" | Out-Null
  if($LASTEXITCODE -ne 0){throw 'Could not enforce the private operator ACL.'}
  $entries=@((Get-Acl -LiteralPath $private).Access)
}
if($entries.Count -ne 1 -or $entries[0].IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value -ne $sid.Value -or $entries[0].AccessControlType -ne 'Allow' -or $entries[0].IsInherited -or -not (($entries[0].FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::FullControl) -eq [System.Security.AccessControl.FileSystemRights]::FullControl)){throw 'Private operator ACL is not user-only FullControl.'}
git check-ignore -q $private
if($LASTEXITCODE -ne 0){throw 'Private operator path is not ignored by Git.'}

Add-Type @'
using System; using System.Runtime.InteropServices; using System.Text;
public static class Issue22CredentialReader {
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct C { public UInt32 Flags,Type; public IntPtr TargetName,Comment; public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten; public UInt32 CredentialBlobSize; public IntPtr CredentialBlob; public UInt32 Persist,AttributeCount; public IntPtr Attributes,TargetAlias,UserName; }
 [DllImport("advapi32.dll",EntryPoint="CredReadW",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool Read(string t,int y,int r,out IntPtr p);
 [DllImport("advapi32.dll")] static extern void CredFree(IntPtr p);
 public static string Get(string target){IntPtr p;if(!Read(target,1,0,out p))throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());try{var c=(C)Marshal.PtrToStructure(p,typeof(C));var b=new byte[c.CredentialBlobSize];Marshal.Copy(c.CredentialBlob,b,0,b.Length);return Encoding.UTF8.GetString(b);}finally{CredFree(p);}}
}
'@
$token=[Issue22CredentialReader]::Get('Supabase CLI:supabase')
if($token -notmatch '^sbp_(oauth_)?[a-f0-9]{40}$'){throw 'Supabase CLI credential shape mismatch.'}
if($Mode -match 'execute|cleanup' -and -not $CandidateSha){throw 'CandidateSha is mandatory for provider operations.'}
if(-not $CandidateSha){$CandidateSha=(git rev-parse HEAD).Trim()}
if($CandidateSha -notmatch '^[0-9a-f]{40}$'){throw 'Candidate SHA is invalid.'}
$head=(git rev-parse HEAD).Trim()
if($LASTEXITCODE -ne 0 -or $head -ne $CandidateSha){throw 'CandidateSha does not match tracked HEAD.'}
$env:SUPABASE_ACCESS_TOKEN=$token
$env:ISSUE22_CANDIDATE_SHA=$CandidateSha
try {
  switch($Mode){
    'migration-self-test' { node (Join-Path $root 'migration-runner.mjs') --self-test }
    'hosted-self-test' { node (Join-Path $root 'hosted-operator.mjs') --self-test }
    'hosted-preflight' {
      & (Join-Path $root 'preflight.ps1')
      if(-not $?){throw 'Issue-22 preflight failed.'}
      $LASTEXITCODE=0 # discard the intentional unused-Worker probe exit
    }
    'hosted-execute' {
      & (Join-Path $root 'preflight.ps1')
      if(-not $?){throw 'Issue-22 preflight failed.'}
      node (Join-Path $root 'hosted-operator.mjs') --execute
    }
    'hosted-cleanup' { node (Join-Path $root 'hosted-operator.mjs') --cleanup }
  }
  if($LASTEXITCODE -ne 0){throw 'Issue-22 operator failed.'}
} finally {
  Remove-Item Env:SUPABASE_ACCESS_TOKEN -ErrorAction SilentlyContinue
  Remove-Item Env:ISSUE22_CANDIDATE_SHA -ErrorAction SilentlyContinue
  $token=$null
}
