# Adapted from mbroadfo/spa-on-aws (static-only path: no Lambda/API Gateway,
# so no archive provider).

terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Remote state — scripts/bootstrap.sh creates the bucket before first apply.
  # Partial backend config: bucket/key/region passed at init time by devops-infra.yml.
  # use_lockfile enables native S3 state locking (Terraform >= 1.10, no DynamoDB needed).
  backend "s3" {
    use_lockfile = true
  }
}

provider "aws" {
  region = var.aws_region
}

# ACM certificates for CloudFront must always be in us-east-1
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
}

locals {
  app  = var.app_name
  tags = {
    Project     = var.app_name
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}
