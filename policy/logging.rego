package policy.logging

import rego.v1

deny_log_group_without_retention contains msg if {
    some name
    resource := input.Resources[name]
    resource.Type == "AWS::Logs::LogGroup"
    not resource.Properties.RetentionInDays
    msg := sprintf("Log group %v does not define retention.", [resource_name(name, resource)])
}

deny_cloudtrail_without_validation contains msg if {
    some name
    resource := input.Resources[name]
    resource.Type == "AWS::CloudTrail::Trail"
    not resource.Properties.EnableLogFileValidation
    msg := sprintf("CloudTrail trail %v does not enable log file validation.", [resource_name(name, resource)])
}

deny_cloudtrail_without_kms contains msg if {
    some name
    resource := input.Resources[name]
    resource.Type == "AWS::CloudTrail::Trail"
    not resource.Properties.KMSKeyId
    msg := sprintf("CloudTrail trail %v does not use a KMS key.", [resource_name(name, resource)])
}

deny_cloudtrail_without_cloudwatch_logs contains msg if {
    some name
    resource := input.Resources[name]
    resource.Type == "AWS::CloudTrail::Trail"
    not resource.Properties.CloudWatchLogsLogGroupArn
    msg := sprintf("CloudTrail trail %v does not publish to CloudWatch Logs.", [resource_name(name, resource)])
}

resource_name(name, resource) := value if {
    value := resource.Properties.TrailName
}

resource_name(name, resource) := value if {
    value := resource.Properties.LogGroupName
}

resource_name(name, resource) := name if {
    not resource.Properties.TrailName
    not resource.Properties.LogGroupName
}
