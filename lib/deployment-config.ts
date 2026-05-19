import * as cdk from 'aws-cdk-lib';

export interface DeploymentConfig {
  env?: cdk.Environment;
  rawFileRetentionDays: number;
}

export function resolveDeploymentConfig(
  app: cdk.App,
  environment: NodeJS.ProcessEnv = process.env,
): DeploymentConfig {
  const account = environment.AWS_ACCOUNT_ID ?? environment.CDK_DEFAULT_ACCOUNT;
  const region = environment.AWS_REGION ?? environment.CDK_DEFAULT_REGION;
  const rawFileRetentionDays = Number(
    app.node.tryGetContext('rawFileRetentionDays') ?? environment.RAW_FILE_RETENTION_DAYS ?? '7',
  );

  if (!Number.isInteger(rawFileRetentionDays) || rawFileRetentionDays < 1) {
    throw new Error('rawFileRetentionDays must be a positive integer.');
  }

  return {
    env: account || region ? { account, region } : undefined,
    rawFileRetentionDays,
  };
}
