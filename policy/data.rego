package policy.data

import rego.v1

deny_dynamodb_no_pitr contains msg if {
    some name
    resource := input.Resources[name]
    resource.Type == "AWS::DynamoDB::Table"
    not pitr_enabled(resource)
    msg := sprintf("DynamoDB table %v does not have PITR enabled.", [resource_name(name, resource)])
}

deny_sqs_no_encryption contains msg if {
    some name
    resource := input.Resources[name]
    resource.Type == "AWS::SQS::Queue"
    not resource.Properties.KmsMasterKeyId
    msg := sprintf("SQS queue %v does not use KMS encryption.", [resource_name(name, resource)])
}

deny_cloudtrail_not_logging contains msg if {
    some name
    resource := input.Resources[name]
    resource.Type == "AWS::CloudTrail::Trail"
    not resource.Properties.IsLogging
    msg := sprintf("CloudTrail %v has logging disabled.", [resource_name(name, resource)])
}

pitr_enabled(resource) if {
    resource.Properties.PointInTimeRecoverySpecification.PointInTimeRecoveryEnabled == true
}

resource_name(name, resource) := value if {
    value := resource.Properties.TableName
}

resource_name(name, resource) := value if {
    value := resource.Properties.QueueName
}

resource_name(name, resource) := value if {
    value := resource.Properties.TrailName
}

resource_name(name, resource) := name if {
    not resource.Properties.TableName
    not resource.Properties.QueueName
    not resource.Properties.TrailName
}
