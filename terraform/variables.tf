variable "environment" {
  description = "Deployment environment — used in resource tags"
  default     = "prod"
}

variable "aws_region" {
  description = "AWS region for all resources (except ACM, which is always us-east-1)"
  default     = "us-west-2"
}

variable "app_name" {
  description = "Short kebab-case name used as a prefix for all AWS resources"
  type        = string
  # S3 assets bucket is derived as {app_name}-assets
}

variable "custom_domain" {
  description = "Custom domain to serve the SPA from (must be in your Cloudflare zone)"
  type        = string
}

variable "price_class" {
  description = "CloudFront price class — PriceClass_100 (US+EU), PriceClass_200 (+Asia), PriceClass_All"
  default     = "PriceClass_100"
}
