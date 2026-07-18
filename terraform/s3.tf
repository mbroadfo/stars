resource "aws_s3_bucket" "spa" {
  bucket = "${var.app_name}-assets"
  tags   = local.tags
}

# Block all public access — CloudFront OAC handles all delivery
resource "aws_s3_bucket_public_access_block" "spa" {
  bucket                  = aws_s3_bucket.spa.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "spa" {
  bucket = aws_s3_bucket.spa.id
  versioning_configuration { status = "Enabled" }
}

# Origin Access Control — CloudFront signs requests to S3 with SigV4
resource "aws_cloudfront_origin_access_control" "spa" {
  name                              = "${local.app}-oac"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# Bucket policy — allow GetObject only from this CloudFront distribution
resource "aws_s3_bucket_policy" "spa" {
  bucket = aws_s3_bucket.spa.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AllowCloudFront"
      Effect    = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.spa.arn}/*"
      Condition = {
        StringEquals = {
          "AWS:SourceArn" = aws_cloudfront_distribution.spa.arn
        }
      }
    }]
  })
  depends_on = [aws_s3_bucket_public_access_block.spa]
}

# ── CloudFront distribution ───────────────────────────────────────────────────

resource "aws_cloudfront_distribution" "spa" {
  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"
  price_class         = var.price_class
  comment             = "${local.app} SPA"

  origin {
    domain_name              = aws_s3_bucket.spa.bucket_regional_domain_name
    origin_id                = "S3-${aws_s3_bucket.spa.bucket}"
    origin_access_control_id = aws_cloudfront_origin_access_control.spa.id
  }

  # HTML — short cache so deploys are visible within 5 minutes
  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "S3-${aws_s3_bucket.spa.bucket}"
    compress               = true
    viewer_protocol_policy = "redirect-to-https"
    cache_policy_id        = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad" # AWS managed: CachingDisabled
  }

  # Vite-hashed assets — 1-year immutable cache
  ordered_cache_behavior {
    path_pattern           = "/assets/*"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "S3-${aws_s3_bucket.spa.bucket}"
    compress               = true
    viewer_protocol_policy = "redirect-to-https"
    cache_policy_id        = aws_cloudfront_cache_policy.assets.id
  }

  # Star catalog buffers — 1-day edge cache; devops-data.yml invalidates /data/*
  # after each sync, so a refresh is visible within minutes
  ordered_cache_behavior {
    path_pattern           = "/data/*"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "S3-${aws_s3_bucket.spa.bucket}"
    compress               = true
    viewer_protocol_policy = "redirect-to-https"
    cache_policy_id        = aws_cloudfront_cache_policy.data.id
  }

  # SPA client-side routing — S3 403/404 → index.html
  custom_error_response {
    error_code            = 403
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }
  custom_error_response {
    error_code            = 404
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }

  restrictions {
    geo_restriction { restriction_type = "none" }
  }

  aliases = [var.custom_domain]

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.spa.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  tags = local.tags
}

# ── ACM Certificate (must be in us-east-1 for CloudFront) ────────────────────

resource "aws_acm_certificate" "spa" {
  provider          = aws.us_east_1
  domain_name       = var.custom_domain
  validation_method = "DNS"
  lifecycle { create_before_destroy = true }
  tags = local.tags
}

resource "aws_acm_certificate_validation" "spa" {
  provider                = aws.us_east_1
  certificate_arn         = aws_acm_certificate.spa.arn
  validation_record_fqdns = [for r in cloudflare_record.acm_validation : r.hostname]
}

# ── CloudFront cache policy for star catalog data ────────────────────────────
# Not content-hashed (tier1.bin keeps its name across rebuilds), so cache one
# day at the edge and rely on invalidation from devops-data.yml on refresh.

resource "aws_cloudfront_cache_policy" "data" {
  name        = "${local.app}-data-1d"
  default_ttl = 86400
  max_ttl     = 604800
  min_ttl     = 0

  parameters_in_cache_key_and_forwarded_to_origin {
    enable_accept_encoding_brotli = true
    enable_accept_encoding_gzip   = true
    cookies_config       { cookie_behavior        = "none" }
    headers_config       { header_behavior        = "none" }
    query_strings_config { query_string_behavior  = "none" }
  }
}

# ── CloudFront cache policy for hashed assets ─────────────────────────────────

resource "aws_cloudfront_cache_policy" "assets" {
  name        = "${local.app}-assets-1yr"
  default_ttl = 31536000
  max_ttl     = 31536000
  min_ttl     = 31536000

  parameters_in_cache_key_and_forwarded_to_origin {
    enable_accept_encoding_brotli = true
    enable_accept_encoding_gzip   = true
    cookies_config       { cookie_behavior        = "none" }
    headers_config       { header_behavior        = "none" }
    query_strings_config { query_string_behavior  = "none" }
  }
}
