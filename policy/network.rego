package policy.network

import rego.v1

deny_security_group_open_ingress contains msg if {
    some name
    resource := input.Resources[name]
    resource.Type == "AWS::EC2::SecurityGroup"
    resource.Properties.SecurityGroupIngress
    rule := resource.Properties.SecurityGroupIngress[_]
    cidr_is_public(rule.CidrIp)
    msg := sprintf("Security group %v allows public ingress from %v.", [resource_name(name, resource), rule.CidrIp])
}

deny_security_group_open_egress contains msg if {
    some name
    resource := input.Resources[name]
    resource.Type == "AWS::EC2::SecurityGroup"
    resource.Properties.SecurityGroupEgress
    rule := resource.Properties.SecurityGroupEgress[_]
    cidr_is_public(rule.CidrIp)
    msg := sprintf("Security group %v allows public egress to %v.", [resource_name(name, resource), rule.CidrIp])
}

cidr_is_public(cidr) if {
    cidr == "0.0.0.0/0"
}

cidr_is_public(cidr) if {
    cidr == "::/0"
}

resource_name(name, resource) := value if {
    value := resource.Properties.GroupDescription
}

resource_name(name, resource) := name if {
    not resource.Properties.GroupDescription
}
