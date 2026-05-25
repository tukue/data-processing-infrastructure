package cdk

deny contains msg if {
	msg := deny_iam_policy_star_action[_]
}

deny_iam_policy_star_action contains msg if {
	some name
	resource := input.Resources[name]
	resource.Type == "AWS::IAM::Policy"
	statement := resource.Properties.PolicyDocument.Statement[_]
	action_is_wildcard(statement)
	msg := sprintf("IAM policy %v uses wildcard action '*'. Use scoped actions instead.", [iam_resource_name(name, resource)])
}

action_is_wildcard(statement) if {
	statement.Action == "*"
}

action_is_wildcard(statement) if {
	statement.Action[_] == "*"
}

iam_resource_name(name, resource) := value if {
	value := resource.Properties.PolicyName
}

iam_resource_name(name, resource) := name if {
	not resource.Properties.PolicyName
}
