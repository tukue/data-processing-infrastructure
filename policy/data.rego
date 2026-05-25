package cdk

deny contains msg if {
	msg := deny_dynamodb_no_pitr[_]
}

deny_dynamodb_no_pitr contains msg if {
	some name
	resource := input.Resources[name]
	resource.Type == "AWS::DynamoDB::Table"
	not resource.Properties.PointInTimeRecoverySpecification
	msg := sprintf("DynamoDB table %v does not have PITR enabled.", [data_resource_name(name, resource)])
}

data_resource_name(name, resource) := value if {
	value := resource.Properties.TableName
}

data_resource_name(name, resource) := name if {
	not resource.Properties.TableName
}
