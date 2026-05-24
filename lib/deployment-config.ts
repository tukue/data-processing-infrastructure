import * as cdk from 'aws-cdk-lib';

export interface DeploymentConfig {
  env?: cdk.Environment;
  processorImage: string;
  rawFileRetentionDays: number;
  processedFileRetentionDays: number;
  failedFileRetentionDays: number;
  enrichmentApiCidrs: string[];
  jobRetentionDays: number;
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
  const processedFileRetentionDays = Number(
    app.node.tryGetContext('processedFileRetentionDays')
      ?? environment.PROCESSED_FILE_RETENTION_DAYS
      ?? '7',
  );
  const failedFileRetentionDays = Number(
    app.node.tryGetContext('failedFileRetentionDays')
      ?? environment.FAILED_FILE_RETENTION_DAYS
      ?? '7',
  );
  const processorImage = String(
    app.node.tryGetContext('processorImage') ?? environment.PROCESSOR_IMAGE ?? '',
  ).trim();

  const enrichmentApiCidrs: string[] = (() => {
    const ctx = app.node.tryGetContext('enrichmentApiCidrs');
    if (ctx) return String(ctx).split(',').map((s) => s.trim()).filter(Boolean);
    const env = environment.ENRICHMENT_API_CIDRS;
    if (env) return env.split(',').map((s) => s.trim()).filter(Boolean);
    return [];
  })();

  const jobRetentionDays = Number(
    app.node.tryGetContext('jobRetentionDays') ?? environment.JOB_RETENTION_DAYS ?? '30',
  );

  if (!Number.isInteger(rawFileRetentionDays) || rawFileRetentionDays < 1) {
    throw new Error('rawFileRetentionDays must be a positive integer.');
  }

  if (!Number.isInteger(processedFileRetentionDays) || processedFileRetentionDays < 1) {
    throw new Error('processedFileRetentionDays must be a positive integer.');
  }

  if (!Number.isInteger(failedFileRetentionDays) || failedFileRetentionDays < 1) {
    throw new Error('failedFileRetentionDays must be a positive integer.');
  }

  if (!Number.isInteger(jobRetentionDays) || jobRetentionDays < 1) {
    throw new Error('jobRetentionDays must be a positive integer.');
  }

  if (processorImage.length === 0) {
    throw new Error('processorImage must be provided through CDK context or PROCESSOR_IMAGE.');
  }

  if (!/^.*@sha256:[a-f0-9]{64}$/.test(processorImage)) {
    throw new Error(
      'processorImage must be pinned to an image digest using @sha256:<hex> (e.g. account.dkr.ecr.region.amazonaws.com/repo@sha256:abc...). ' +
      'Tags like :latest are not allowed because they can be overwritten silently.',
    );
  }

  return {
    env: account || region ? { account, region } : undefined,
    processorImage,
    rawFileRetentionDays,
    processedFileRetentionDays,
    failedFileRetentionDays,
    enrichmentApiCidrs,
    jobRetentionDays,
  };
}
