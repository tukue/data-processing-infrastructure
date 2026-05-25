package policy.security

import rego.v1

deny_kms_key_rotation_disabled contains msg if {
    some resource in input.Resources
    resource.Type == "AWS::KMS::Key"
    not resource.Properties.EnableKeyRotation
    msg := sprintf("KMS Key %v does not have key rotation enabled.", [resource.Properties.Description])
}

deny_security_group_public_ingress contains msg if {
    some resource in input.Resources
    resource.Type == "AWS::EC2::SecurityGroup"
    rule := resource.Properties.SecurityGroupIngress[_]
    rule.CidrIp == "0.0.0.0/0"
    msg := sprintf("Security group %v allows public ingress from 0.0.0.0/0.", [resource.Properties.GroupDescription])
}

deny_secrets_manager_no_encryption contains msg if {
    some resource in input.Resources
    resource.Type == "AWS::SecretsManager::Secret"
    not resource.Properties.KmsKeyId
    msg := sprintf("Secrets Manager secret %v does not use a KMS key.", [resource.Properties.Name])
}

deny_ecs_task_definition_no_readonly_root contains msg if {
    some resource in input.Resources
    resource.Type == "AWS::ECS::TaskDefinition"
    def := resource.Properties.ContainerDefinitions[_]
    def.ReadonlyRootFilesystem == false
    msg := sprintf("ECS container %v does not have readonlyRootFilesystem enabled.", [def.Name])
}
