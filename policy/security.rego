package cdk

deny contains msg if {
	msg := deny_security_group_public_ingress[_]
}

deny contains msg if {
	msg := deny_security_group_public_egress[_]
}

deny contains msg if {
	msg := deny_ecs_task_definition_no_readonly_root[_]
}

deny_security_group_public_ingress contains msg if {
	some name
	resource := input.Resources[name]
	resource.Type == "AWS::EC2::SecurityGroup"
	resource.Properties.SecurityGroupIngress
	rule := resource.Properties.SecurityGroupIngress[_]
	rule.CidrIp == "0.0.0.0/0"
	msg := sprintf("Security group %v allows public ingress from 0.0.0.0/0.", [security_resource_name(name, resource)])
}

deny_security_group_public_egress contains msg if {
	some name
	resource := input.Resources[name]
	resource.Type == "AWS::EC2::SecurityGroup"
	resource.Properties.SecurityGroupEgress
	rule := resource.Properties.SecurityGroupEgress[_]
	rule.CidrIp == "0.0.0.0/0"
	msg := sprintf("Security group %v allows public egress to 0.0.0.0/0.", [security_resource_name(name, resource)])
}

deny_ecs_task_definition_no_readonly_root contains msg if {
	some name
	resource := input.Resources[name]
	resource.Type == "AWS::ECS::TaskDefinition"
	def := resource.Properties.ContainerDefinitions[_]
	not def.ReadonlyRootFilesystem
	msg := sprintf("ECS container %v does not have readonlyRootFilesystem enabled.", [container_name(def)])
}

container_name(def) := value if {
	value := def.Name
}

container_name(def) := "unknown" if {
	not def.Name
}

security_resource_name(name, resource) := value if {
	value := resource.Properties.GroupDescription
}

security_resource_name(name, resource) := name if {
	not resource.Properties.GroupDescription
}
