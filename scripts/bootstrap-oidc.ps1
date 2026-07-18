# bootstrap-oidc.ps1 — One-time OIDC setup for STARS deploys. Idempotent.
#
# Replaces the spa-on-aws bootstrap.sh (long-lived IAM user keys) with GitHub
# Actions OIDC federation: workflows assume short-lived roles; NO AWS
# credentials are stored in GitHub Secrets.
#
# Creates:
#   1. S3 bucket for Terraform state   (stars-tf-state)
#   2. GitHub OIDC identity provider   (token.actions.githubusercontent.com, if absent)
#   3. IAM role  stars-terraform       (scoped: S3 state+assets, CloudFront, ACM)
#   4. IAM role  stars-ci              (scoped: assets bucket sync + invalidation)
#      Both trust ONLY repo mbroadfo/stars on refs/heads/master.
#   5. GitHub Secrets (7 — Cloudflare pair, GH token, TF config; zero AWS keys)
#
# Run with an admin profile:
#   $env:AWS_PROFILE = "admin"
#   ./scripts/bootstrap-oidc.ps1 -CfToken (Get-Clipboard)
#
# Prerequisites: aws CLI (admin profile), gh CLI authenticated.

param(
    [string]$App         = "stars",
    [string]$Domain      = "stars.xaminisalamini.com",
    [string]$Environment = "prod",
    [string]$Region      = "us-west-2",
    [string]$AccountId   = "491696534851",
    [string]$GithubRepo  = "mbroadfo/stars",
    [string]$Branch      = "master",
    [string]$CfZoneId    = "cec0f3ca3468209e2b18e7fc66aa528c",
    [string]$CfToken     = "",
    [string]$GhToken     = "",
    [switch]$Force
)

$ErrorActionPreference = "Stop"

# Probe an aws CLI call that is EXPECTED to fail sometimes (e.g. head-bucket on
# a missing bucket). PS 5.1 turns native stderr into a terminating error under
# EAP=Stop, so relax it for the duration and just report the exit code.
function Test-Aws {
    $eap = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try { & aws @args 2>&1 | Out-Null } catch { }
    $ErrorActionPreference = $eap
    return ($LASTEXITCODE -eq 0)
}

$CfToken = $CfToken.Trim()
if ($CfToken) {
    try {
        $verify = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/user/tokens/verify" `
            -Headers @{ Authorization = "Bearer $CfToken" }
        if (-not $verify.success) { throw "verify returned success=false" }
        Write-Host "Cloudflare token verified (status: $($verify.result.status))"
    } catch {
        throw "Cloudflare token failed verification — copy it again from the dashboard. ($_)"
    }
} else {
    Write-Warning "No Cloudflare token — CLOUDFLARE_API_TOKEN will NOT be set. Re-run with -CfToken later (script is idempotent)."
}
if (-not $GhToken) { $GhToken = (gh auth token).Trim() }
if (-not $GhToken) { throw "No GitHub token — run 'gh auth login' first." }

$TfBucket   = "$App-tf-state"
$OidcArn    = "arn:aws:iam::${AccountId}:oidc-provider/token.actions.githubusercontent.com"
$RepoSub    = "repo:${GithubRepo}:ref:refs/heads/${Branch}"

# Newer repos get IMMUTABLE OIDC subject claims: the sub is prefixed
# repo:owner@id/repo@id instead of repo:owner/repo. Ask GitHub which prefix
# this repo actually uses and trust both forms, branch-pinned.
$env:GH_TOKEN = $GhToken
$subInfo = gh api "repos/$GithubRepo/actions/oidc/customization/sub" 2>$null | ConvertFrom-Json
$RepoSubs = @($RepoSub)
if ($subInfo -and $subInfo.sub_claim_prefix -and $subInfo.sub_claim_prefix -ne "repo:$GithubRepo") {
    $RepoSubs += "$($subInfo.sub_claim_prefix):ref:refs/heads/${Branch}"
}
$RepoSubJson = ($RepoSubs | ForEach-Object { '"' + $_ + '"' }) -join ", "

$identity = aws sts get-caller-identity --output json | ConvertFrom-Json
Write-Host ""
Write-Host "=== stars OIDC bootstrap ===" -ForegroundColor Cyan
Write-Host "Caller:      $($identity.Arn)"
Write-Host "App:         $App"
Write-Host "Domain:      $Domain"
Write-Host "TF state:    s3://$TfBucket"
Write-Host "OIDC trust:  $RepoSub"
Write-Host "Roles:       $App-terraform, $App-ci"
Write-Host "Repo:        $GithubRepo"
Write-Host ""
if ($identity.Account -ne $AccountId) { throw "Profile is in account $($identity.Account), expected $AccountId" }
if (-not $Force) {
    $confirm = Read-Host "Proceed? [y/N]"
    if ($confirm -notmatch "^[Yy]$") { Write-Host "Aborted."; exit 0 }
}

# ── 1. Terraform state bucket ────────────────────────────────────────────────
Write-Host "`n[1/5] Terraform state bucket: $TfBucket"
if (Test-Aws s3api head-bucket --bucket $TfBucket) {
    Write-Host "      Already exists"
} else {
    aws s3 mb "s3://$TfBucket" --region $Region | Out-Null
    aws s3api put-bucket-versioning --bucket $TfBucket --versioning-configuration Status=Enabled
    aws s3api put-public-access-block --bucket $TfBucket --public-access-block-configuration `
        "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"
    Write-Host "      Created with versioning + public access block"
}

# ── 2. GitHub OIDC provider ──────────────────────────────────────────────────
Write-Host "`n[2/5] OIDC provider: token.actions.githubusercontent.com"
$providers = aws iam list-open-id-connect-providers --output json | ConvertFrom-Json
if ($providers.OpenIDConnectProviderList.Arn -contains $OidcArn) {
    Write-Host "      Already exists"
} else {
    aws iam create-open-id-connect-provider `
        --url "https://token.actions.githubusercontent.com" `
        --client-id-list "sts.amazonaws.com" `
        --thumbprint-list "6938fd4d98bab03faadb97b34396831e3780aea1" | Out-Null
    Write-Host "      Created"
}

# ── Shared trust policy ──────────────────────────────────────────────────────
$trust = @"
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Federated": "$OidcArn" },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
      "StringLike":   { "token.actions.githubusercontent.com:sub": [$RepoSubJson] }
    }
  }]
}
"@
$trustFile = New-TemporaryFile
Set-Content -Path $trustFile -Value $trust -Encoding ascii

function Ensure-Role([string]$Name, [string]$PolicyJson) {
    if (Test-Aws iam get-role --role-name $Name) {
        aws iam update-assume-role-policy --role-name $Name --policy-document "file://$trustFile"
        Write-Host "      Role exists — trust policy refreshed"
    } else {
        aws iam create-role --role-name $Name `
            --assume-role-policy-document "file://$trustFile" `
            --tags Key=Project,Value=$App Key=ManagedBy,Value=bootstrap | Out-Null
        Write-Host "      Created"
    }
    $polFile = New-TemporaryFile
    Set-Content -Path $polFile -Value $PolicyJson -Encoding ascii
    aws iam put-role-policy --role-name $Name --policy-name "$Name-policy" --policy-document "file://$polFile"
    Remove-Item $polFile
    Write-Host "      Inline policy set: $Name-policy"
}

# ── 3. Terraform role — scoped to this stack (no AdministratorAccess) ────────
Write-Host "`n[3/5] IAM role: $App-terraform"
$tfPolicy = @"
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "TfStateAndAssets",
      "Effect": "Allow",
      "Action": "s3:*",
      "Resource": [
        "arn:aws:s3:::$TfBucket", "arn:aws:s3:::$TfBucket/*",
        "arn:aws:s3:::$App-assets", "arn:aws:s3:::$App-assets/*"
      ]
    },
    { "Sid": "CloudFront", "Effect": "Allow", "Action": "cloudfront:*", "Resource": "*" },
    { "Sid": "Acm",        "Effect": "Allow", "Action": "acm:*",        "Resource": "*" }
  ]
}
"@
Ensure-Role "$App-terraform" $tfPolicy

# ── 4. CI role — assets sync + invalidation only ─────────────────────────────
Write-Host "`n[4/5] IAM role: $App-ci"
$ciPolicy = @"
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AssetsSync",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject", "s3:ListBucket"],
      "Resource": ["arn:aws:s3:::$App-assets", "arn:aws:s3:::$App-assets/*"]
    },
    { "Sid": "Invalidate", "Effect": "Allow", "Action": "cloudfront:CreateInvalidation", "Resource": "*" }
  ]
}
"@
Ensure-Role "$App-ci" $ciPolicy
Remove-Item $trustFile

# ── 5. GitHub config ─────────────────────────────────────────────────────────
# Non-secret config goes to VARIABLES, not Secrets: GitHub masks any workflow
# output containing a secret's value, so storing e.g. the app name as a secret
# silently breaks job outputs like "s3_bucket=stars-assets".
Write-Host "`n[5/5] GitHub config on $GithubRepo"
$env:GH_TOKEN = $GhToken
$variables = [ordered]@{
    "TF_STATE_BUCKET"      = $TfBucket
    "TF_VAR_APP_NAME"      = $App
    "TF_VAR_ENVIRONMENT"   = $Environment
    "TF_VAR_CUSTOM_DOMAIN" = $Domain
    "CLOUDFLARE_ZONE_ID"   = $CfZoneId
}
foreach ($k in $variables.Keys) {
    Write-Host "      var:    $k"
    gh variable set $k --repo $GithubRepo --body $variables[$k]
}
$secrets = [ordered]@{ "GH_TOKEN" = $GhToken }
if ($CfToken) { $secrets["CLOUDFLARE_API_TOKEN"] = $CfToken }
foreach ($k in $secrets.Keys) {
    Write-Host "      secret: $k"
    $secrets[$k] | gh secret set $k --repo $GithubRepo
}

Write-Host ""
Write-Host "=== Bootstrap complete ===" -ForegroundColor Green
Write-Host "Roles trust only ${RepoSub} via OIDC — no AWS keys stored anywhere."
Write-Host "You can now deactivate the admin access key used for this run."
