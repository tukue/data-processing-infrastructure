package policy.s3

import rego.v1

deny_s3_no_encryption contains msg if {
    some resource in input.Resources
    resource.Type == "AWS::S3::Bucket"
    not resource.Properties.BucketEncryption
    msg := sprintf("S3 bucket %v does not have encryption enabled.", [resource.Properties.BucketName])
}

deny_s3_no_block_public_access contains msg if {
    some resource in input.Resources
    resource.Type == "AWS::S3::Bucket"
    not resource.Properties.PublicAccessBlockConfiguration
    msg := sprintf("S3 bucket %v does not have PublicAccessBlockConfiguration.", [resource.Properties.BucketName])
}

deny_s3_bucket_acl_not_enforced contains msg if {
    some resource in input.Resources
    resource.Type == "AWS::S3::Bucket"
    resource.Properties.OwnershipControls
    resource.Properties.OwnershipControls.Rules[_].ObjectOwnership == "ObjectWriter"
    msg := sprintf("S3 bucket %v uses ObjectWriter ownership; prefer BucketOwnerEnforced.", [resource.Properties.BucketName])
}

deny_s3_versioning_disabled contains msg if {
    some resource in input.Resources
    resource.Type == "AWS::S3::Bucket"
    not resource.Properties.VersioningConfiguration
    msg := sprintf("S3 bucket %v does not have versioning enabled.", [resource.Properties.BucketName])
}
