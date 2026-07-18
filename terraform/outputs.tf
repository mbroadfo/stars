output "cloudfront_distribution_id" {
  description = "CloudFront distribution ID — set as CLOUDFRONT_DIST_ID GitHub Variable"
  value       = aws_cloudfront_distribution.spa.id
}

output "cloudfront_domain" {
  description = "CloudFront domain name (bare) — used as Cloudflare CNAME target"
  value       = aws_cloudfront_distribution.spa.domain_name
}

output "custom_domain_url" {
  description = "App URL — live once ACM validates and Cloudflare CNAME propagates"
  value       = "https://${var.custom_domain}"
}

output "s3_bucket_name" {
  description = "S3 bucket name for SPA assets — set as S3_BUCKET GitHub Variable"
  value       = aws_s3_bucket.spa.id
}
