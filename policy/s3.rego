package cdk

deny contains msg if {
	msg := deny_s3_bucket_without_encryption[_]
}

deny contains msg if {
	msg := deny_s3_bucket_public_access_not_blocked[_]
}

deny contains msg if {
	msg := deny_s3_bucket_acl_not_enforced[_]
}

deny_s3_bucket_without_encryption contains msg if {
	some name
	resource := input.Resources[name]
	resource.Type == "AWS::S3::Bucket"
	not resource.Properties.BucketEncryption
	msg := sprintf("S3 bucket %v does not have default encryption configured.", [s3_resource_name(name, resource)])
}

deny_s3_bucket_public_access_not_blocked contains msg if {
	some name
	resource := input.Resources[name]
	resource.Type == "AWS::S3::Bucket"
	not public_access_blocked(resource)
	msg := sprintf("S3 bucket %v does not block all public access.", [s3_resource_name(name, resource)])
}

deny_s3_bucket_acl_not_enforced contains msg if {
	some name
	resource := input.Resources[name]
	resource.Type == "AWS::S3::Bucket"
	not is_access_log_bucket(name)
	resource.Properties.OwnershipControls
	resource.Properties.OwnershipControls.Rules[_].ObjectOwnership == "ObjectWriter"
	msg := sprintf("S3 bucket %v uses ObjectWriter ownership; prefer BucketOwnerEnforced.", [s3_resource_name(name, resource)])
}

public_access_blocked(resource) if {
	config := resource.Properties.PublicAccessBlockConfiguration
	config.BlockPublicAcls
	config.BlockPublicPolicy
	config.IgnorePublicAcls
	config.RestrictPublicBuckets
}

is_access_log_bucket(name) if {
	startswith(name, "AccessLogBucket")
}

s3_resource_name(name, resource) := value if {
	value := resource.Properties.BucketName
}

s3_resource_name(name, resource) := name if {
	not resource.Properties.BucketName
}
