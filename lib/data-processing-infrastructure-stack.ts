import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { Construct } from 'constructs';

export class DataProcessingInfrastructureStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const rawUploadsBucket = new s3.Bucket(this, 'RawUploadsBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      eventBridgeEnabled: true,
      lifecycleRules: [
        {
          expiration: cdk.Duration.days(7),
        },
      ],
    });

    const processedFilesBucket = new s3.Bucket(this, 'ProcessedFilesBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
    });

    const failedFilesBucket = new s3.Bucket(this, 'FailedFilesBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
    });

    const databaseCredentials = new secretsmanager.Secret(this, 'DatabaseCredentialsSecret', {
      description: 'Placeholder database credentials for the CSV processor.',
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
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          provider: 'customer-enrichment-api',
        }),
        generateStringKey: 'apiKey',
      },
    });

    // Public subnets keep the demo deployable without NAT Gateway cost. A production
    // version would normally run tasks in private subnets with VPC endpoints/NAT.
    const vpc = new ec2.Vpc(this, 'ProcessingVpc', {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        {
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
      ],
    });

    const cluster = new ecs.Cluster(this, 'ProcessingCluster', {
      vpc,
    });

    const logGroup = new logs.LogGroup(this, 'ProcessorLogGroup', {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const taskDefinition = new ecs.FargateTaskDefinition(this, 'ProcessorTaskDefinition', {
      cpu: 1024,
      memoryLimitMiB: 2048,
    });

    const container = taskDefinition.addContainer('CsvProcessorContainer', {
      // Placeholder only: replace this with the real private ECR processor image.
      image: ecs.ContainerImage.fromRegistry('public.ecr.aws/docker/library/busybox:latest'),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'csv-processor',
        logGroup,
      }),
      command: [
        'sh',
        '-c',
        'echo "Processing $OBJECT_KEY from $RAW_BUCKET for job $JOB_ID"; sleep 300; echo "Done"',
      ],
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
      assignPublicIp: true,
      subnets: {
        subnetType: ec2.SubnetType.PUBLIC,
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

    const markJobStarted = new sfn.Pass(this, 'MarkJobStarted', {
      comment: 'Production hook: persist job status as STARTED in the main database or a job table.',
    });

    const markJobSucceeded = new sfn.Pass(this, 'MarkJobSucceeded', {
      comment: 'Production hook: persist job status as SUCCEEDED and include output metadata.',
    });

    const markJobFailed = new sfn.Pass(this, 'MarkJobFailed', {
      comment: 'Production hook: persist job status as FAILED and include the failure reason.',
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
      timeout: cdk.Duration.minutes(30),
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
      targets: [new targets.SfnStateMachine(stateMachine)],
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
  }
}
