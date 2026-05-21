import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { resolveDeploymentConfig } from '../lib/deployment-config';
import * as DataProcessingInfrastructure from '../lib/data-processing-infrastructure-stack';

test('creates secured buckets, ECS task, and workflow trigger', () => {
  const app = new cdk.App();
  const stack = new DataProcessingInfrastructure.DataProcessingInfrastructureStack(app, 'MyTestStack', {
    rawFileRetentionDays: 7,
  });
  const template = Template.fromStack(stack);

  template.resourceCountIs('AWS::S3::Bucket', 3);
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
  expect(lifecycleBuckets).toHaveLength(2);

  template.hasResourceProperties('AWS::ECS::TaskDefinition', {
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
        DeadLetterConfig: Match.objectLike({
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
  expect(synthesized).toContain('arn:aws:states:::dynamodb:putItem');
  expect(synthesized).toContain('arn:aws:states:::dynamodb:updateItem');
  expect(synthesized).toContain('Status');
});

test('uses configured raw file retention days in lifecycle policy', () => {
  const app = new cdk.App();
  const stack = new DataProcessingInfrastructure.DataProcessingInfrastructureStack(app, 'RetentionTestStack', {
    rawFileRetentionDays: 14,
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
  expect(lifecycleBuckets).toHaveLength(2);
});

test('resolves deployment account, region, and retention from environment', () => {
  const app = new cdk.App();
  const config = resolveDeploymentConfig(app, {
    AWS_ACCOUNT_ID: 'test-account',
    AWS_REGION: 'eu-north-1',
    RAW_FILE_RETENTION_DAYS: '21',
  });

  expect(config).toEqual({
    env: {
      account: 'test-account',
      region: 'eu-north-1',
    },
    rawFileRetentionDays: 21,
  });
});

test('falls back to CDK default account and region from the active AWS profile', () => {
  const app = new cdk.App();
  const config = resolveDeploymentConfig(app, {
    CDK_DEFAULT_ACCOUNT: 'profile-account',
    CDK_DEFAULT_REGION: 'profile-region',
  });

  expect(config).toEqual({
    env: {
      account: 'profile-account',
      region: 'profile-region',
    },
    rawFileRetentionDays: 7,
  });
});

test('allows CDK context to override raw file retention days', () => {
  const app = new cdk.App({
    context: {
      rawFileRetentionDays: '30',
    },
  });
  const config = resolveDeploymentConfig(app, {
    AWS_ACCOUNT_ID: 'test-account',
    AWS_REGION: 'eu-west-1',
    RAW_FILE_RETENTION_DAYS: '21',
  });

  expect(config.rawFileRetentionDays).toBe(30);
});

test('rejects invalid raw file retention days', () => {
  const app = new cdk.App();

  expect(() =>
    resolveDeploymentConfig(app, {
      RAW_FILE_RETENTION_DAYS: '0',
    }),
  ).toThrow('rawFileRetentionDays must be a positive integer.');
});
