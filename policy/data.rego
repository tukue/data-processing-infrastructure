package policy.data

import rego.v1

deny_dynamodb_no_pitr contains msg if {
    some resource in input.Resources
    resource.Type == "AWS::DynamoDB::Table"
    not resource.Properties.PointInTimeRecoverySpecification
    resource.Properties.TableName
    msg := sprintf("DynamoDB table %v does not have PITR enabled.", [resource.Properties.TableName])
}

deny_sqs_no_encryption contains msg if {
    some resource in input.Resources
    resource.Type == "AWS::SQS::Queue"
    not resource.Properties.KmsMasterKeyId
    msg := sprintf("SQS queue %v does not use KMS encryption.", [resource.Properties.QueueName])
}

deny_cloudtrail_not_logging contains msg if {
    some resource in input.Resources
    resource.Type == "AWS::CloudTrail::Trail"
    resource.Properties.IsLogging == false
    msg := sprintf("CloudTrail %v has logging disabled.", [resource.Properties.TrailName])
}
