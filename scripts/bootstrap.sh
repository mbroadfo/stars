#!/usr/bin/env bash
# bootstrap.sh — One-time setup for a new spa-on-aws project.
# Idempotent: safe to re-run at any time.
#
# What this does:
#   1. Creates S3 bucket for Terraform state ({app}-tf-state)
#   2. Creates IAM user: {app}-terraform  (AdministratorAccess)
#   3. Creates IAM user: {app}-ci         (scoped: S3 + CF + Lambda + SSM)
#   4. Sets all required GitHub Secrets via gh CLI
#
# Derived automatically (not prompted):
#   S3 assets bucket: {app}-assets  (provisioned by Terraform on first deploy)
#   TF state bucket:  {app}-tf-state
#   SSM path:         /{app}/{environment}/secrets
#
# Prerequisites:
#   - aws CLI configured with an admin profile
#   - gh CLI authenticated (gh auth login)
#
# Usage (interactive):
#   ./scripts/bootstrap.sh
#
# Usage (flags — omit any to be prompted):
#   ./scripts/bootstrap.sh \
#     --app            my-dashboard \
#     --domain         dashboard.yourdomain.com \
#     --environment    prod \
#     --aws-region     us-west-2 \
#     --aws-account-id 123456789012 \
#     --cf-zone-id     <cloudflare-zone-id> \
#     --cf-token       <cloudflare-api-token> \
#     --app-secrets    '{"DB_URI":"..."}' \
#     --github-repo    org/repo \
#     --gh-token       <github-token>

set -euo pipefail

# ── Argument parsing ──────────────────────────────────────────────────────────

APP=""
DOMAIN=""
ENVIRONMENT="prod"
AWS_REGION="us-west-2"
AWS_ACCOUNT_ID=""
CF_ZONE_ID=""
CF_TOKEN=""
APP_SECRETS=""
GITHUB_REPO=""
GH_TOKEN=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app)            APP="$2";            shift 2 ;;
    --domain)         DOMAIN="$2";         shift 2 ;;
    --environment)    ENVIRONMENT="$2";    shift 2 ;;
    --aws-region)     AWS_REGION="$2";     shift 2 ;;
    --aws-account-id) AWS_ACCOUNT_ID="$2"; shift 2 ;;
    --cf-zone-id)     CF_ZONE_ID="$2";     shift 2 ;;
    --cf-token)       CF_TOKEN="$2";       shift 2 ;;
    --app-secrets)    APP_SECRETS="$2";    shift 2 ;;
    --github-repo)    GITHUB_REPO="$2";    shift 2 ;;
    --gh-token)       GH_TOKEN="$2";       shift 2 ;;
    *) echo "Unknown flag: $1"; exit 1 ;;
  esac
done

# ── Interactive prompts for missing values ────────────────────────────────────

_ask() {
  local var="$1" prompt="$2" default="${3:-}"
  if [[ -z "${!var:-}" ]]; then
    if [[ -n "$default" ]]; then
      read -rp "$prompt [$default]: " val
      printf -v "$var" '%s' "${val:-$default}"
    else
      read -rp "$prompt: " val
      printf -v "$var" '%s' "$val"
    fi
  fi
}

_ask_secret() {
  local var="$1" prompt="$2"
  if [[ -z "${!var:-}" ]]; then
    read -rsp "$prompt: " val; echo
    printf -v "$var" '%s' "$val"
  fi
}

echo ""
echo "=== spa-on-aws bootstrap ==="
echo ""

_ask APP            "App name (kebab-case, used as prefix for all resources)"
_ask DOMAIN         "Custom domain (e.g. dashboard.yourdomain.com)"
_ask ENVIRONMENT    "Environment" "prod"
_ask AWS_REGION     "AWS region" "us-west-2"
_ask AWS_ACCOUNT_ID "AWS account ID"
_ask CF_ZONE_ID     "Cloudflare Zone ID (from your domain's Overview page)"
_ask_secret CF_TOKEN    "Cloudflare API Token (Zone:DNS:Edit permission)"
_ask_secret APP_SECRETS "Runtime secrets JSON (e.g. {\"DB_URI\":\"...\"}) — enter {} for none"
[[ -z "$APP_SECRETS" ]] && APP_SECRETS="{}"
_ask GITHUB_REPO    "GitHub repo (org/repo-name)"
_ask_secret GH_TOKEN    "GitHub token (Secrets:write + Variables:write)"

# Derived values — never prompted
TF_BUCKET="${APP}-tf-state"
TF_USER="${APP}-terraform"
CI_USER="${APP}-ci"
SSM_PATH="/${APP}/${ENVIRONMENT}/secrets"
POLICY_NAME="${APP}-ci-policy"
POLICY_ARN="arn:aws:iam::${AWS_ACCOUNT_ID}:policy/${POLICY_NAME}"

echo ""
echo "--- Config ---"
echo "App:         $APP"
echo "Domain:      $DOMAIN"
echo "Environment: $ENVIRONMENT"
echo "Region:      $AWS_REGION"
echo "TF state:    s3://$TF_BUCKET"
echo "S3 assets:   s3://${APP}-assets  (provisioned by Terraform on first deploy)"
echo "SSM path:    $SSM_PATH"
echo "IAM users:   $TF_USER, $CI_USER"
echo "GitHub repo: $GITHUB_REPO"
echo "--------------"
echo ""
read -rp "Proceed? [y/N]: " confirm
[[ "$confirm" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 0; }

# ── Helper: delete all existing access keys, then create a fresh one ──────────

_rotate_keys() {
  local user="$1" var_key="$2" var_secret="$3"
  local existing
  existing=$(aws iam list-access-keys --user-name "$user" \
    --query 'AccessKeyMetadata[].AccessKeyId' --output text 2>/dev/null || echo "")
  for kid in $existing; do
    aws iam delete-access-key --user-name "$user" --access-key-id "$kid"
    echo "      Deleted key: $kid"
  done
  IFS=$'\t' read -r "$var_key" "$var_secret" < <(
    aws iam create-access-key --user-name "$user" \
      --query 'AccessKey.[AccessKeyId, SecretAccessKey]' --output text
  )
}

# ── 1. Terraform state bucket ─────────────────────────────────────────────────

echo ""
echo "[1/4] Terraform state bucket: $TF_BUCKET"
if aws s3api head-bucket --bucket "$TF_BUCKET" 2>/dev/null; then
  echo "      Already exists"
else
  aws s3 mb "s3://$TF_BUCKET" --region "$AWS_REGION"
  aws s3api put-bucket-versioning \
    --bucket "$TF_BUCKET" \
    --versioning-configuration Status=Enabled
  aws s3api put-public-access-block \
    --bucket "$TF_BUCKET" \
    --public-access-block-configuration \
      "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"
  echo "      Created with versioning + public access block"
fi

# ── 2. Terraform IAM user ─────────────────────────────────────────────────────

echo ""
echo "[2/4] IAM user: $TF_USER (AdministratorAccess)"
if aws iam get-user --user-name "$TF_USER" &>/dev/null; then
  echo "      Already exists"
else
  aws iam create-user --user-name "$TF_USER" \
    --tags Key=Project,Value="$APP" Key=ManagedBy,Value=bootstrap
  echo "      Created"
fi

ADMIN_ARN="arn:aws:iam::aws:policy/AdministratorAccess"
ATTACHED=$(aws iam list-attached-user-policies --user-name "$TF_USER" \
  --query "AttachedPolicies[?PolicyArn=='${ADMIN_ARN}'].PolicyArn" --output text)
if [[ -z "$ATTACHED" ]]; then
  aws iam attach-user-policy --user-name "$TF_USER" --policy-arn "$ADMIN_ARN"
  echo "      AdministratorAccess attached"
fi

_rotate_keys "$TF_USER" TF_KEY_ID TF_SECRET
echo "      New access key: $TF_KEY_ID"

# ── 3. CI IAM user ────────────────────────────────────────────────────────────

echo ""
echo "[3/4] IAM user: $CI_USER (scoped CI policy)"

CI_POLICY=$(cat <<POLICY
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "S3Assets",
      "Effect": "Allow",
      "Action": ["s3:PutObject","s3:GetObject","s3:DeleteObject","s3:ListBucket"],
      "Resource": [
        "arn:aws:s3:::${APP}-assets",
        "arn:aws:s3:::${APP}-assets/*",
        "arn:aws:s3:::${TF_BUCKET}",
        "arn:aws:s3:::${TF_BUCKET}/*"
      ]
    },
    {
      "Sid": "CloudFront",
      "Effect": "Allow",
      "Action": ["cloudfront:CreateInvalidation"],
      "Resource": "*"
    },
    {
      "Sid": "Lambda",
      "Effect": "Allow",
      "Action": [
        "lambda:UpdateFunctionCode",
        "lambda:GetFunction",
        "lambda:GetFunctionConfiguration"
      ],
      "Resource": "arn:aws:lambda:${AWS_REGION}:${AWS_ACCOUNT_ID}:function:${APP}"
    },
    {
      "Sid": "SSM",
      "Effect": "Allow",
      "Action": ["ssm:PutParameter","ssm:GetParameter"],
      "Resource": "arn:aws:ssm:${AWS_REGION}:${AWS_ACCOUNT_ID}:parameter${SSM_PATH}"
    }
  ]
}
POLICY
)

if aws iam get-user --user-name "$CI_USER" &>/dev/null; then
  echo "      User already exists"
else
  aws iam create-user --user-name "$CI_USER" \
    --tags Key=Project,Value="$APP" Key=ManagedBy,Value=bootstrap
  echo "      Created"
fi

if ! aws iam get-policy --policy-arn "$POLICY_ARN" &>/dev/null; then
  aws iam create-policy \
    --policy-name "$POLICY_NAME" \
    --policy-document "$CI_POLICY" \
    --query 'Policy.Arn' --output text > /dev/null
  echo "      Policy created: $POLICY_NAME"
else
  echo "      Policy already exists: $POLICY_NAME"
fi

ATTACHED=$(aws iam list-attached-user-policies --user-name "$CI_USER" \
  --query "AttachedPolicies[?PolicyArn=='${POLICY_ARN}'].PolicyArn" --output text)
if [[ -z "$ATTACHED" ]]; then
  aws iam attach-user-policy --user-name "$CI_USER" --policy-arn "$POLICY_ARN"
  echo "      Policy attached"
fi

_rotate_keys "$CI_USER" CI_KEY_ID CI_SECRET
echo "      New access key: $CI_KEY_ID"

# ── 4. GitHub Secrets ─────────────────────────────────────────────────────────

echo ""
echo "[4/4] Setting GitHub Secrets on $GITHUB_REPO..."

_secret() {
  printf "      %s\n" "$1"
  echo -n "$2" | GH_TOKEN="$GH_TOKEN" gh secret set "$1" --repo "$GITHUB_REPO"
}

_secret "TERRAFORM_AWS_ACCESS_KEY_ID"     "$TF_KEY_ID"
_secret "TERRAFORM_AWS_SECRET_ACCESS_KEY" "$TF_SECRET"
_secret "DEPLOY_AWS_ACCESS_KEY_ID"        "$CI_KEY_ID"
_secret "DEPLOY_AWS_SECRET_ACCESS_KEY"    "$CI_SECRET"
_secret "TF_STATE_BUCKET"                 "$TF_BUCKET"
_secret "TF_VAR_APP_NAME"                 "$APP"
_secret "TF_VAR_ENVIRONMENT"              "$ENVIRONMENT"
_secret "TF_VAR_CUSTOM_DOMAIN"            "$DOMAIN"
_secret "TF_VAR_SSM_SECRET_PATH"          "$SSM_PATH"
_secret "APP_SECRETS"                     "$APP_SECRETS"
_secret "CLOUDFLARE_ZONE_ID"              "$CF_ZONE_ID"
_secret "CLOUDFLARE_API_TOKEN"            "$CF_TOKEN"
_secret "GH_TOKEN"                        "$GH_TOKEN"

# ── Done ──────────────────────────────────────────────────────────────────────

echo ""
echo "=== Bootstrap complete ==="
echo ""
echo "All 13 secrets are set on $GITHUB_REPO."
echo ""
echo "Next steps:"
echo "  1. Push terraform/ first to provision infrastructure:"
echo "       git add terraform/ && git commit -m 'Provision infrastructure' && git push"
echo "     Wait for devops-infra.yml to complete (~5 min for ACM validation)."
echo ""
echo "  2. Then push your app code:"
echo "       git add frontend/ backend/ && git commit -m 'Deploy app' && git push"
echo ""
echo "Your app will be live at: https://$DOMAIN"
echo ""
echo "This script is idempotent — safe to re-run at any time."
