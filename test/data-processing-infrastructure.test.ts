import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import * as DataProcessingInfrastructure from '../lib/data-processing-infrastructure-stack';

test('creates secured buckets, ECS task, and workflow trigger', () => {
  const app = new cdk.App();
  const stack = new DataProcessingInfrastructure.DataProcessingInfrastructureStack(app, 'MyTestStack');
  const template = Template.fromStack(stack);

  template.resourceCountIs('AWS::S3::Bucket', 3);
  template.hasResourceProperties('AWS::S3::Bucket', {
    PublicAccessBlockConfiguration: {
      BlockPublicAcls: true,
      BlockPublicPolicy: true,
      IgnorePublicAcls: true,
      RestrictPublicBuckets: true,
    },
    LifecycleConfiguration: {
      Rules: Match.arrayWith([
        Match.objectLike({
          ExpirationInDays: 7,
        }),
      ]),
    },
    NotificationConfiguration: {
      EventBridgeConfiguration: {
        EventBridgeEnabled: true,
      },
    },
  });

  template.hasResourceProperties('AWS::ECS::TaskDefinition', {
    Cpu: '1024',
    Memory: '2048',
    RequiresCompatibilities: ['FARGATE'],
  });

  template.hasResourceProperties('AWS::StepFunctions::StateMachine', {
    DefinitionString: Match.serializedJson(
      Match.objectLike({
        States: Match.objectLike({
          RunCsvProcessorTask: Match.objectLike({
            Resource: 'arn:aws:states:::ecs:runTask.sync',
          }),
        }),
      }),
    ),
  });

  template.hasResourceProperties('AWS::Events::Rule', {
    EventPattern: Match.objectLike({
      source: ['aws.s3'],
      'detail-type': ['Object Created'],
    }),
  });
});
