#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { resolveDeploymentConfig } from '../lib/deployment-config';
import { DataProcessingInfrastructureStack } from '../lib/data-processing-infrastructure-stack';

const app = new cdk.App();

new DataProcessingInfrastructureStack(app, 'DataProcessingInfrastructureStack', {
  ...resolveDeploymentConfig(app),
});

if (process.env.CDK_NAG === '1') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { AwsSolutionsChecks } = require('cdk-nag');
  cdk.Aspects.of(app).add(new AwsSolutionsChecks());
}
