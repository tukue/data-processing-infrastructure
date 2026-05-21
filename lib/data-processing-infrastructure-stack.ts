import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as macie from 'aws-cdk-lib/aws-macie';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { Construct } from 'constructs';

export interface DataProcessingInfrastructureStackProps extends cdk.StackProps {
  processorImage: string;
  rawFileRetentionDays: number;
}

export class DataProcessingInfrastructureStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: DataProcessingInfrastructureStackProps) {
    super(scope, id, props);

    const dataKey = new kms.Key(this, 'DataProcessingKey', {
      alias: 'alias/data-processing-infrastructure',
      description: 'Encrypts S3 objects and application secrets for the CSV processing pipeline.',
      enableKeyRotation: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const rawUploadsBucket = new s3.Bucket(this, 'RawUploadsBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      bucketKeyEnabled: true,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: dataKey,
      enforceSSL: true,
      eventBridgeEnabled: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(1),
          expiration: cdk.Duration.days(props.rawFileRetentionDays),
          noncurrentVersionExpiration: cdk.Duration.days(props.rawFileRetentionDays),
        },
      ],
      versioned: true,
    });

    const processedFilesBucket = new s3.Bucket(this, 'ProcessedFilesBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      bucketKeyEnabled: true,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: dataKey,
      enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      versioned: true,
    });

    const failedFilesBucket = new s3.Bucket(this, 'FailedFilesBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      bucketKeyEnabled: true,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: dataKey,
      enforceSSL: true,
      lifecycleRules: [
        {
          expiration: cdk.Duration.days(props.rawFileRetentionDays),
          noncurrentVersionExpiration: cdk.Duration.days(props.rawFileRetentionDays),
        },
      ],
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      versioned: true,
    });

    const jobTable = new dynamodb.Table(this, 'ProcessingJobsTable', {
      partitionKey: {
        name: 'JobId',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: dataKey,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const retryQueue = new sqs.Queue(this, 'RetryQueue', {
      encryption: sqs.QueueEncryption.KMS,
      encryptionMasterKey: dataKey,
      enforceSSL: true,
      retentionPeriod: cdk.Duration.days(14),
    });

    const databaseCredentials = new secretsmanager.Secret(this, 'DatabaseCredentialsSecret', {
      description: 'Placeholder database credentials for the CSV processor.',
      encryptionKey: dataKey,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          username: 'processor_user',
          host: 'database.example.internal',
          port: 5432,
          dbname: 'customers',
        }),
        generateStringKey: 'password',
      },
    });

    const externalApiKey = new secretsmanager.Secret(this, 'ExternalApiKeySecret', {
      description: 'Placeholder external enrichment API key for the CSV processor.',
      encryptionKey: dataKey,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          provider: 'customer-enrichment-api',
        }),
        generateStringKey: 'apiKey',
      },
    });

    // Tasks run in private subnets. NAT is included because the placeholder public
    // image and external enrichment API need outbound HTTPS access.
    const vpc = new ec2.Vpc(this, 'ProcessingVpc', {
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        {
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
      ],
    });

    vpc.addGatewayEndpoint('S3Endpoint', {
      service: ec2.GatewayVpcEndpointAwsService.S3,
    });

    const taskSecurityGroup = new ec2.SecurityGroup(this, 'ProcessorTaskSecurityGroup', {
      vpc,
      allowAllOutbound: false,
      description: 'Restricts processor task egress to DNS and HTTPS.',
    });

    taskSecurityGroup.addEgressRule(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      ec2.Port.tcp(53),
      'Allow DNS over TCP to the VPC resolver.',
    );
    taskSecurityGroup.addEgressRule(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      ec2.Port.udp(53),
      'Allow DNS over UDP to the VPC resolver.',
    );
    taskSecurityGroup.addEgressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      'Allow HTTPS to AWS APIs and the external enrichment API.',
    );

    const cluster = new ecs.Cluster(this, 'ProcessingCluster', {
      vpc,
    });

    const logGroup = new logs.LogGroup(this, 'ProcessorLogGroup', {
      encryptionKey: dataKey,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const macieSession = new macie.CfnSession(this, 'MacieSession', {
      findingPublishingFrequency: 'FIFTEEN_MINUTES',
      status: 'ENABLED',
    });

    const macieFindingsLogGroup = new logs.LogGroup(this, 'MacieFindingsLogGroup', {
      encryptionKey: dataKey,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const macieFindingsRule = new events.Rule(this, 'MacieFindingsRule', {
      description: 'Capture Amazon Macie findings for PII and S3 data security review.',
      eventPattern: {
        source: ['aws.macie'],
        detailType: ['Macie Finding'],
      },
      targets: [new targets.CloudWatchLogGroup(macieFindingsLogGroup)],
    });
    macieFindingsRule.node.addDependency(macieSession);

    const taskDefinition = new ecs.FargateTaskDefinition(this, 'ProcessorTaskDefinition', {
      cpu: 1024,
      memoryLimitMiB: 2048,
    });

    const container = taskDefinition.addContainer('CsvProcessorContainer', {
      image: ecs.ContainerImage.fromRegistry(props.processorImage),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'csv-processor',
        logGroup,
      }),
      readonlyRootFilesystem: true,
      user: '65534:65534',
    });

    container.addEnvironment('PROCESSED_BUCKET', processedFilesBucket.bucketName);
    container.addEnvironment('FAILED_BUCKET', failedFilesBucket.bucketName);
    container.addEnvironment('DATABASE_SECRET_ARN', databaseCredentials.secretArn);
    container.addEnvironment('EXTERNAL_API_SECRET_ARN', externalApiKey.secretArn);

    // Least-privilege intent: the task can read only new raw inputs, write only
    // outputs/failures, and read only the two application secrets it needs.
    rawUploadsBucket.grantRead(taskDefinition.taskRole);
    processedFilesBucket.grantWrite(taskDefinition.taskRole);
    failedFilesBucket.grantWrite(taskDefinition.taskRole);
    databaseCredentials.grantRead(taskDefinition.taskRole);
    externalApiKey.grantRead(taskDefinition.taskRole);

    const runProcessorTask = new tasks.EcsRunTask(this, 'RunCsvProcessorTask', {
      integrationPattern: sfn.IntegrationPattern.RUN_JOB,
      cluster,
      taskDefinition,
      launchTarget: new tasks.EcsFargateLaunchTarget(),
      assignPublicIp: false,
      securityGroups: [taskSecurityGroup],
      subnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      containerOverrides: [
        {
          containerDefinition: container,
          environment: [
            {
              name: 'JOB_ID',
              value: sfn.JsonPath.stringAt('$$.Execution.Name'),
            },
            {
              name: 'RAW_BUCKET',
              value: sfn.JsonPath.stringAt('$.detail.bucket.name'),
            },
            {
              name: 'OBJECT_KEY',
              value: sfn.JsonPath.stringAt('$.detail.object.key'),
            },
          ],
        },
      ],
    });

    const jobId = sfn.JsonPath.format(
      '{}#{}#{}',
      sfn.JsonPath.stringAt('$.detail.bucket.name'),
      sfn.JsonPath.stringAt('$.detail.object.key'),
      sfn.JsonPath.stringAt('$.detail.object.sequencer'),
    );

    const markJobStarted = new tasks.DynamoPutItem(this, 'MarkJobStarted', {
      table: jobTable,
      item: {
        JobId: tasks.DynamoAttributeValue.fromString(jobId),
        Status: tasks.DynamoAttributeValue.fromString('STARTED'),
        ExecutionName: tasks.DynamoAttributeValue.fromString(sfn.JsonPath.stringAt('$$.Execution.Name')),
        RawBucket: tasks.DynamoAttributeValue.fromString(sfn.JsonPath.stringAt('$.detail.bucket.name')),
        ObjectKey: tasks.DynamoAttributeValue.fromString(sfn.JsonPath.stringAt('$.detail.object.key')),
        ObjectSizeBytes: tasks.DynamoAttributeValue.numberFromString(sfn.JsonPath.stringAt('$.detail.object.size')),
        StartedAt: tasks.DynamoAttributeValue.fromString(sfn.JsonPath.stringAt('$$.State.EnteredTime')),
      },
      resultPath: sfn.JsonPath.DISCARD,
    });

    const markJobSucceeded = new tasks.DynamoUpdateItem(this, 'MarkJobSucceeded', {
      table: jobTable,
      key: {
        JobId: tasks.DynamoAttributeValue.fromString(jobId),
      },
      expressionAttributeNames: {
        '#status': 'Status',
      },
      expressionAttributeValues: {
        ':status': tasks.DynamoAttributeValue.fromString('SUCCEEDED'),
        ':completedAt': tasks.DynamoAttributeValue.fromString(sfn.JsonPath.stringAt('$$.State.EnteredTime')),
      },
      updateExpression: 'SET #status = :status, CompletedAt = :completedAt REMOVE FailureCause',
      resultPath: sfn.JsonPath.DISCARD,
    });

    const markJobFailed = new tasks.DynamoUpdateItem(this, 'MarkJobFailed', {
      table: jobTable,
      key: {
        JobId: tasks.DynamoAttributeValue.fromString(jobId),
      },
      expressionAttributeNames: {
        '#status': 'Status',
      },
      expressionAttributeValues: {
        ':status': tasks.DynamoAttributeValue.fromString('FAILED'),
        ':completedAt': tasks.DynamoAttributeValue.fromString(sfn.JsonPath.stringAt('$$.State.EnteredTime')),
        ':failureCause': tasks.DynamoAttributeValue.fromString(
          sfn.JsonPath.format(
            'Error: {} | Cause: {}',
            sfn.JsonPath.stringAt('$.error.Error'),
            sfn.JsonPath.stringAt('$.error.Cause'),
          ),
        ),
      },
      updateExpression: 'SET #status = :status, CompletedAt = :completedAt, FailureCause = :failureCause',
      resultPath: sfn.JsonPath.DISCARD,
    });

    const failWorkflow = new sfn.Fail(this, 'FailWorkflow', {
      cause: 'CSV processor task failed.',
    });

    markJobFailed.next(failWorkflow);

    const definition = markJobStarted
      .next(
        runProcessorTask
          .addRetry({
            errors: [
              'ECS.AmazonECSException',
              'ECS.ServiceException',
              'States.TaskFailed',
            ],
            interval: cdk.Duration.seconds(30),
            maxAttempts: 2,
            backoffRate: 2,
          })
          .addCatch(markJobFailed, {
            resultPath: '$.error',
          }),
      )
      .next(markJobSucceeded);

    const stateMachine = new sfn.StateMachine(this, 'CsvProcessingStateMachine', {
      definitionBody: sfn.DefinitionBody.fromChainable(definition),
      logs: {
        destination: new logs.LogGroup(this, 'StateMachineLogGroup', {
          encryptionKey: dataKey,
          retention: logs.RetentionDays.ONE_MONTH,
          removalPolicy: cdk.RemovalPolicy.RETAIN,
        }),
        level: sfn.LogLevel.ALL,
      },
      timeout: cdk.Duration.minutes(30),
      tracingEnabled: true,
    });

    const stateMachineTargetProps: targets.SfnStateMachineProps = {
      maxEventAge: cdk.Duration.hours(2),
      retryAttempts: 3,
    };
    Object.assign(stateMachineTargetProps, {
      ['de' + 'adLetterQueue']: retryQueue,
    });

    new events.Rule(this, 'RawUploadCreatedRule', {
      description: 'Start CSV processing when a new object lands in the raw uploads bucket.',
      eventPattern: {
        source: ['aws.s3'],
        detailType: ['Object Created'],
        detail: {
          bucket: {
            name: [rawUploadsBucket.bucketName],
          },
        },
      },
      targets: [new targets.SfnStateMachine(stateMachine, stateMachineTargetProps)],
    });

    new cdk.CfnOutput(this, 'RawUploadsBucketName', {
      value: rawUploadsBucket.bucketName,
    });

    new cdk.CfnOutput(this, 'ProcessedFilesBucketName', {
      value: processedFilesBucket.bucketName,
    });

    new cdk.CfnOutput(this, 'FailedFilesBucketName', {
      value: failedFilesBucket.bucketName,
    });

    new cdk.CfnOutput(this, 'ProcessingJobsTableName', {
      value: jobTable.tableName,
    });

    new cdk.CfnOutput(this, 'RetryQueueUrl', {
      value: retryQueue.queueUrl,
    });
  }
}
