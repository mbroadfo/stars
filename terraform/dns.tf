# Cloudflare DNS managed by Terraform so the ACM validation record exists
# BEFORE aws_acm_certificate_validation waits on it — the template's separate
# post-apply dns job deadlocks on a first run (validation waits for a record
# that only gets created after apply finishes).

# ACM DNS validation record(s)
resource "cloudflare_record" "acm_validation" {
  for_each = {
    for dvo in aws_acm_certificate.spa.domain_validation_options : dvo.domain_name => {
      name  = dvo.resource_record_name
      type  = dvo.resource_record_type
      value = dvo.resource_record_value
    }
  }

  zone_id         = var.cloudflare_zone_id
  name            = trimsuffix(each.value.name, ".")
  type            = each.value.type
  content         = trimsuffix(each.value.value, ".")
  ttl             = 60
  proxied         = false
  allow_overwrite = true
  comment         = "ACM validation — ${var.app_name}"
}

# App CNAME → CloudFront (DNS-only/unproxied: double-proxying breaks ACM)
resource "cloudflare_record" "app" {
  zone_id         = var.cloudflare_zone_id
  name            = var.custom_domain
  type            = "CNAME"
  content         = aws_cloudfront_distribution.spa.domain_name
  ttl             = 1 # auto
  proxied         = false
  allow_overwrite = true
  comment         = "${var.app_name} — spa-on-aws"
}
