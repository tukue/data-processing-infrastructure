package policy.compute

import rego.v1

deny_ecs_task_definition_unpinned_image contains msg if {
    some name
    resource := input.Resources[name]
    resource.Type == "AWS::ECS::TaskDefinition"
    def := resource.Properties.ContainerDefinitions[_]
    not contains(def.Image, "@sha256:")
    msg := sprintf("ECS container %v image is not pinned to a digest.", [container_name(def)])
}

deny_ecs_task_definition_privileged_mode contains msg if {
    some name
    resource := input.Resources[name]
    resource.Type == "AWS::ECS::TaskDefinition"
    def := resource.Properties.ContainerDefinitions[_]
    def.Privileged == true
    msg := sprintf("ECS container %v runs in privileged mode.", [container_name(def)])
}

deny_ecs_task_definition_root_user contains msg if {
    some name
    resource := input.Resources[name]
    resource.Type == "AWS::ECS::TaskDefinition"
    def := resource.Properties.ContainerDefinitions[_]
    not non_root_user(def)
    msg := sprintf("ECS container %v does not declare a non-root user.", [container_name(def)])
}

non_root_user(def) if {
    def.User
    def.User != "0"
    def.User != "root"
}

container_name(def) := value if {
    value := def.Name
}

container_name(def) := "unknown" if {
    not def.Name
}
