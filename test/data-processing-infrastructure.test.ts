import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { resolveDeploymentConfig } from '../lib/deployment-config';
import * as DataProcessingInfrastructure from '../lib/data-processing-infrastructure-stack';

const TEST_PROCESSOR_IMAGE = '123456789012.dkr.ecr.eu-north-1.amazonaws.com/csv-processor@sha256:abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
const TEST_PROCESSOR_IMAGE_CONTEXT = '123456789012.dkr.ecr.eu-west-1.amazonaws.com/csv-processor@sha256:0000000000000000000000000000000000000000000000000000000000000000';

test('creates secured buckets, ECS task, and workflow trigger', () => {
  const app = new cdk.App();
  const stack = new DataProcessingInfrastructure.DataProcessingInfrastructureStack(app, 'MyTestStack', {
    processorImage: TEST_PROCESSOR_IMAGE,
    rawFileRetentionDays: 7,
    processedFileRetentionDays: 7,
    failedFileRetentionDays: 7,
    enrichmentApiCidrs: [],
    jobRetentionDays: 30,
  });
  const template = Template.fromStack(stack);

  template.resourceCountIs('AWS::S3::Bucket', 5);
  template.hasResourceProperties('AWS::S3::Bucket', {
    PublicAccessBlockConfiguration: {
      BlockPublicAcls: true,
      BlockPublicPolicy: true,
      IgnorePublicAcls: true,
      RestrictPublicBuckets: true,
    },
    BucketEncryption: Match.objectLike({
      ServerSideEncryptionConfiguration: Match.arrayWith([
        Match.objectLike({
          ServerSideEncryptionByDefault: Match.objectLike({
            SSEAlgorithm: 'aws:kms',
          }),
        }),
      ]),
    }),
    OwnershipControls: {
      Rules: [
        {
          ObjectOwnership: 'BucketOwnerEnforced',
        },
      ],
    },
    VersioningConfiguration: {
      Status: 'Enabled',
    },
  });

  template.hasResourceProperties('AWS::S3::Bucket', {
    LifecycleConfiguration: {
      Rules: Match.arrayWith([
        Match.objectLike({
          AbortIncompleteMultipartUpload: {
            DaysAfterInitiation: 1,
          },
          ExpirationInDays: 7,
          NoncurrentVersionExpiration: {
            NoncurrentDays: 7,
          },
        }),
      ]),
    },
  });

  const lifecycleBuckets = Object.values(template.findResources('AWS::S3::Bucket')).filter(
    (bucket) => bucket.Properties?.LifecycleConfiguration,
  );
  expect(lifecycleBuckets).toHaveLength(4);

  template.hasResourceProperties('AWS::ECS::TaskDefinition', {
    ContainerDefinitions: Match.arrayWith([
      Match.objectLike({
        Image: TEST_PROCESSOR_IMAGE,
      }),
    ]),
    Cpu: '1024',
    Memory: '2048',
    RequiresCompatibilities: ['FARGATE'],
  });

  template.resourceCountIs('AWS::StepFunctions::StateMachine', 1);
  expect(JSON.stringify(template.toJSON())).toContain('states:::ecs:runTask.sync');

  template.hasResourceProperties('AWS::Events::Rule', {
    EventPattern: Match.objectLike({
      source: ['aws.s3'],
      'detail-type': ['Object Created'],
    }),
  });

  template.hasResourceProperties('AWS::Macie::Session', {
    FindingPublishingFrequency: 'FIFTEEN_MINUTES',
    Status: 'ENABLED',
  });

  template.hasResourceProperties('AWS::Events::Rule', {
    EventPattern: Match.objectLike({
      source: ['aws.macie'],
      'detail-type': ['Macie Finding'],
    }),
  });

  template.hasResourceProperties('AWS::DynamoDB::Table', {
    BillingMode: 'PAY_PER_REQUEST',
    KeySchema: [
      {
        AttributeName: 'JobId',
        KeyType: 'HASH',
      },
    ],
    PointInTimeRecoverySpecification: {
      PointInTimeRecoveryEnabled: true,
    },
    SSESpecification: Match.objectLike({
      SSEEnabled: true,
      SSEType: 'KMS',
    }),
  });

  template.hasResourceProperties('AWS::SQS::Queue', {
    KmsMasterKeyId: Match.anyValue(),
    MessageRetentionPeriod: 1209600,
  });

  template.hasResourceProperties('AWS::Events::Rule', {
    Targets: Match.arrayWith([
      Match.objectLike({
        [['De', 'adLetterConfig'].join('')]: Match.objectLike({
          Arn: Match.anyValue(),
        }),
        RetryPolicy: {
          MaximumEventAgeInSeconds: 7200,
          MaximumRetryAttempts: 3,
        },
      }),
    ]),
  });

  const synthesized = JSON.stringify(template.toJSON());
  expect(synthesized).toContain(':states:::dynamodb:putItem');
  expect(synthesized).toContain(':states:::dynamodb:updateItem');
  expect(synthesized).toContain('Status');
});

test('uses configured raw file retention days in lifecycle policy', () => {
  const app = new cdk.App();
  const stack = new DataProcessingInfrastructure.DataProcessingInfrastructureStack(app, 'RetentionTestStack', {
    processorImage: TEST_PROCESSOR_IMAGE,
    rawFileRetentionDays: 14,
    processedFileRetentionDays: 7,
    failedFileRetentionDays: 7,
    enrichmentApiCidrs: [],
    jobRetentionDays: 30,
  });
  const template = Template.fromStack(stack);

  template.hasResourceProperties('AWS::S3::Bucket', {
    LifecycleConfiguration: {
      Rules: Match.arrayWith([
        Match.objectLike({
          AbortIncompleteMultipartUpload: {
            DaysAfterInitiation: 1,
          },
          ExpirationInDays: 14,
          NoncurrentVersionExpiration: {
            NoncurrentDays: 14,
          },
        }),
      ]),
    },
  });

  const lifecycleBuckets = Object.values(template.findResources('AWS::S3::Bucket')).filter(
    (bucket) => bucket.Properties?.LifecycleConfiguration,
  );
  expect(lifecycleBuckets).toHaveLength(4);
});

test('resolves deployment account, region, and retention from environment', () => {
  const app = new cdk.App();
  const config = resolveDeploymentConfig(app, {
    AWS_ACCOUNT_ID: 'test-account',
    AWS_REGION: 'eu-north-1',
    PROCESSOR_IMAGE: TEST_PROCESSOR_IMAGE,
    RAW_FILE_RETENTION_DAYS: '21',
  });

  expect(config).toEqual({
    env: {
      account: 'test-account',
      region: 'eu-north-1',
    },
    processorImage: TEST_PROCESSOR_IMAGE,
    rawFileRetentionDays: 21,
    processedFileRetentionDays: 7,
    failedFileRetentionDays: 7,
    enrichmentApiCidrs: [],
    jobRetentionDays: 30,
  });
});

test('omits env when neither AWS_ACCOUNT_ID nor AWS_REGION are set', () => {
  const app = new cdk.App();
  const config = resolveDeploymentConfig(app, {
    PROCESSOR_IMAGE: TEST_PROCESSOR_IMAGE,
  });

  expect(config).toEqual({
    env: undefined,
    processorImage: TEST_PROCESSOR_IMAGE,
    rawFileRetentionDays: 7,
    processedFileRetentionDays: 7,
    failedFileRetentionDays: 7,
    enrichmentApiCidrs: [],
    jobRetentionDays: 30,
  });
});

test('allows CDK context to override raw file retention days', () => {
  const app = new cdk.App({
    context: {
      processorImage: TEST_PROCESSOR_IMAGE_CONTEXT,
      rawFileRetentionDays: '30',
    },
  });
  const config = resolveDeploymentConfig(app, {
    AWS_ACCOUNT_ID: 'test-account',
    AWS_REGION: 'eu-west-1',
    PROCESSOR_IMAGE: TEST_PROCESSOR_IMAGE,
    RAW_FILE_RETENTION_DAYS: '21',
  });

  expect(config.processorImage).toBe(TEST_PROCESSOR_IMAGE_CONTEXT);
  expect(config.rawFileRetentionDays).toBe(30);
  expect(config.processedFileRetentionDays).toBe(7);
  expect(config.failedFileRetentionDays).toBe(7);
});

test('rejects invalid raw file retention days', () => {
  const app = new cdk.App();

  expect(() =>
    resolveDeploymentConfig(app, {
      PROCESSOR_IMAGE: TEST_PROCESSOR_IMAGE,
      RAW_FILE_RETENTION_DAYS: '0',
    }),
  ).toThrow('rawFileRetentionDays must be a positive integer.');
});

test('rejects invalid processed file retention days', () => {
  const app = new cdk.App();

  expect(() =>
    resolveDeploymentConfig(app, {
      PROCESSOR_IMAGE: TEST_PROCESSOR_IMAGE,
      PROCESSED_FILE_RETENTION_DAYS: '0',
    }),
  ).toThrow('processedFileRetentionDays must be a positive integer.');
});

test('rejects invalid failed file retention days', () => {
  const app = new cdk.App();

  expect(() =>
    resolveDeploymentConfig(app, {
      PROCESSOR_IMAGE: TEST_PROCESSOR_IMAGE,
      FAILED_FILE_RETENTION_DAYS: '0',
    }),
  ).toThrow('failedFileRetentionDays must be a positive integer.');
});

test('requires a processor image', () => {
  const app = new cdk.App();

  expect(() => resolveDeploymentConfig(app, {})).toThrow(
    'processorImage must be provided through CDK context or PROCESSOR_IMAGE.',
  );
});

test('DynamoDB table is created without TTL', () => {
  const app = new cdk.App();
  const stack = new DataProcessingInfrastructure.DataProcessingInfrastructureStack(app, 'TtlTestStack', {
    processorImage: TEST_PROCESSOR_IMAGE,
    rawFileRetentionDays: 7,
    processedFileRetentionDays: 7,
    failedFileRetentionDays: 7,
    enrichmentApiCidrs: [],
    jobRetentionDays: 30,
  });
  const template = Template.fromStack(stack);

  template.hasResourceProperties('AWS::DynamoDB::Table', {
    PointInTimeRecoverySpecification: {
      PointInTimeRecoveryEnabled: true,
    },
    BillingMode: 'PAY_PER_REQUEST',
  });
});

test('enables Object Lock on processed and failed buckets with Compliance mode', () => {
  const app = new cdk.App();
  const stack = new DataProcessingInfrastructure.DataProcessingInfrastructureStack(app, 'ObjectLockTestStack', {
    processorImage: TEST_PROCESSOR_IMAGE,
    rawFileRetentionDays: 7,
    processedFileRetentionDays: 14,
    failedFileRetentionDays: 30,
    enrichmentApiCidrs: [],
    jobRetentionDays: 30,
  });
  const template = Template.fromStack(stack);

  const buckets = template.findResources('AWS::S3::Bucket');
  const objectLockBuckets = Object.values(buckets).filter(
    (b: any) => b.Properties?.ObjectLockConfiguration?.ObjectLockEnabled === 'Enabled'
  );
  expect(objectLockBuckets).toHaveLength(2);

  const retentionBuckets = Object.values(buckets).filter(
    (b: any) => b.Properties?.ObjectLockConfiguration?.Rule?.DefaultRetention?.Mode === 'COMPLIANCE'
  );
  expect(retentionBuckets).toHaveLength(2);

  const retentionDays = Object.values(buckets).map(
    (b: any) => b.Properties?.ObjectLockConfiguration?.Rule?.DefaultRetention?.Days
  );
  expect(retentionDays.filter(Boolean)).toEqual(expect.arrayContaining([14, 30]));
});

test('rejects invalid job retention days', () => {
  const app = new cdk.App();

  expect(() =>
    resolveDeploymentConfig(app, {
      PROCESSOR_IMAGE: TEST_PROCESSOR_IMAGE,
      JOB_RETENTION_DAYS: '0',
    }),
  ).toThrow('jobRetentionDays must be a positive integer.');
});
