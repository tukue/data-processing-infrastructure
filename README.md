# Data Processing Infrastructure

AWS CDK v2 TypeScript solution for a small CSV processing pipeline. Users upload large customer CSV files to S3, an EventBridge rule starts a Step Functions workflow, and the workflow runs a one-off ECS Fargate task in private subnets that represents the black-box processor.

The processor application itself is intentionally not implemented. The current container uses `public.ecr.aws/docker/library/busybox:latest` as a placeholder and should be replaced by the real image in production.

## Architecture

```mermaid
flowchart LR
    user[User or upstream system] --> raw[(Raw uploads S3 bucket)]
    raw -->|Object Created via EventBridge notifications| rule[EventBridge rule]
    rule --> sfn[Step Functions state machine]
    sfn -->|RunTask sync integration| ecs[ECS Fargate task]
    ecs --> raw
    ecs --> processed[(Processed files S3 bucket)]
    ecs --> failed[(Failed files S3 bucket)]
    ecs --> secrets[Secrets Manager]
    ecs --> logs[CloudWatch Logs]
    ecs --> kms[KMS key]
    ecs -. status update hook .-> db[(Main database)]
```

## Flow

1. A CSV file is uploaded to the raw uploads bucket.
2. The raw bucket emits S3 Object Created events to EventBridge.
3. EventBridge starts the Step Functions state machine with the original S3 event payload.
4. Step Functions runs a Fargate task using the native ECS integration.
5. The workflow passes `JOB_ID`, `RAW_BUCKET`, and `OBJECT_KEY` to the container as environment overrides.
6. The task reads the raw object, writes successful output to the processed bucket, and writes failed artifacts to the failed bucket.
7. Placeholder Step Functions `Pass` states mark where job status updates to a database or job table would happen.

## Design Decisions

- One CDK stack keeps the assignment easy to review and avoids unnecessary module structure.
- S3 buckets block public access, enforce SSL, use bucket-owner-enforced object ownership, versioning, and customer-managed KMS encryption.
- Raw uploads expire after 7 days because the canonical result should live in the processed output and main database.
- EventBridge notifications are enabled on the raw bucket so object creation can start the workflow without Lambda glue code.
- Step Functions uses `ecs:runTask.sync`, which is a good fit for 5-10 minute file processing jobs and gives workflow-level retry/failure handling.
- Fargate CPU and memory are set to `1024` CPU units and `2048` MiB for a demo-sized task. Real sizing should be based on processor profiling and CSV memory behavior.
- Fargate tasks run in private subnets with no public IP. A NAT gateway is included for the placeholder public image and external API access.
- The stack uses the account and region from the active AWS CLI/CDK environment instead of hardcoding an account ID.

## Security Considerations

- Public S3 access is blocked on all buckets.
- Buckets enforce TLS using `enforceSSL`.
- S3, Secrets Manager, and CloudWatch Logs use a customer-managed KMS key with key rotation enabled.
- ECS tasks run in private subnets and use a security group that allows DNS plus outbound HTTPS only.
- The placeholder container runs as a non-root user with a read-only root filesystem.
- The ECS task role is granted read access only to the raw bucket, write access only to the processed and failed buckets, and read access only to the two placeholder secrets.
- Secrets Manager stores placeholder database credentials and an external API key. The stack passes secret ARNs to the task; the application would retrieve values at runtime.
- IAM permissions are intentionally resource-scoped through CDK grants where possible.
- Production systems should still consider malware scanning, stricter API egress allowlists, centralized audit retention, and organization-level guardrails.

## Trade-offs

- No Lambda preprocessor is included; Step Functions receives the S3 event directly from EventBridge to keep the design small.
- No database, RDS proxy, or job table is deployed because the prompt treats the processor and main database as external concerns.
- The placeholder processor command only logs and sleeps. It demonstrates orchestration without pretending to scrub or enrich CSV data.
- A NAT gateway improves the private-subnet posture but adds cost. A production version could reduce NAT dependency with VPC endpoints and a private ECR image.
- Fargate is simpler than a persistent ECS service or AWS Batch for this assignment. AWS Batch could be attractive for heavier scheduling, queues, or very high concurrency.

## Future Improvements

- Replace the BusyBox image with the real processor image in ECR.
- Add a job metadata table for idempotency, status tracking, retry visibility, and user-facing progress.
- Add dead-letter handling or operational alerts for failed workflow executions.
- Add interface VPC endpoints for Secrets Manager, CloudWatch Logs, ECR, and Step Functions where they fit the target region and cost profile.
- Add reserved concurrency controls or EventBridge/SQS buffering if many large files can arrive at once.
- Add integration tests that assert the synthesized IAM policy scope and Step Functions input paths.

## Deployment

```bash
npm install
aws configure
cdk bootstrap aws://<account-id>/<region>
npm run build
cdk synth
cdk deploy
```

`aws configure` should point to the AWS account where you want to deploy. The stack is portable across accounts and regions; set the target account and region through your AWS CLI profile, or export them explicitly:

```bash
export AWS_ACCOUNT_ID=<your-account-id>
export AWS_REGION=<aws-region>
cdk bootstrap aws://$AWS_ACCOUNT_ID/$AWS_REGION
cdk deploy
```

If neither `AWS_ACCOUNT_ID` nor `AWS_REGION` is set, CDK uses the active CLI profile/default environment. The stack outputs the raw, processed, and failed bucket names after deployment.

Raw file retention defaults to 7 days and can be changed per command:

```bash
cdk deploy -c rawFileRetentionDays=14
```

## CI/CD

GitHub Actions runs a CI workflow on pull requests and pushes to `main`:

- `npm ci`
- `npm run build`
- `npm test -- --runInBand`
- `npx cdk synth`

The workflow intentionally does not deploy yet. For deployment automation, add a separate workflow using GitHub OIDC and an AWS IAM role scoped to this stack instead of storing long-lived AWS access keys in GitHub secrets.
