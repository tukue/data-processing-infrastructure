#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { resolveDeploymentConfig } from '../lib/deployment-config';
import { DataProcessingInfrastructureStack } from '../lib/data-processing-infrastructure-stack';

const app = new cdk.App();

new DataProcessingInfrastructureStack(app, 'DataProcessingInfrastructureStack', {
  ...resolveDeploymentConfig(app),
});
