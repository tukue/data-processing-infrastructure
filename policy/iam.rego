package policy.iam

import rego.v1

deny_iam_policy_star_action contains msg if {
    some resource in input.Resources
    resource.Type == "AWS::IAM::Policy"
    statement := resource.Properties.PolicyDocument.Statement[_]
    statement.Action[_] == "*"
    msg := sprintf("IAM policy %v uses wildcard action '*'. Use scoped actions instead.", [resource.Properties.PolicyName])
}

deny_iam_role_managed_policy_admin contains msg if {
    some resource in input.Resources
    resource.Type == "AWS::IAM::Role"
    some arn in resource.Properties.ManagedPolicyArns
    contains(arn, "AdministratorAccess")
    msg := sprintf("IAM role %v is attached to AdministratorAccess managed policy.", [resource.Properties.RoleName])
}

deny_iam_role_star_assume contains msg if {
    some resource in input.Resources
    resource.Type == "AWS::IAM::Role"
    principal := resource.Properties.AssumeRolePolicyDocument.Statement[_].Principal
    principal.AWS == "*"
    msg := sprintf("IAM role %v allows wildcard principal ('*') in AssumeRole.", [resource.Properties.RoleName])
}
