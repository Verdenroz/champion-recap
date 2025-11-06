import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sagemaker from 'aws-cdk-lib/aws-sagemaker';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { SqsDestination } from 'aws-cdk-lib/aws-lambda-destinations';
import { Construct } from 'constructs';
import { BedrockCoachingConstruct } from './bedrock-coaching-construct';

export class ChampionRecapStack extends cdk.Stack {
	constructor(scope: Construct, id: string, props?: cdk.StackProps) {
		super(scope, id, props);

		// ===================================
		// S3 Bucket for Raw Match Data
		// ===================================
		const matchDataBucket = new s3.Bucket(this, 'MatchDataBucket', {
			bucketName: `champion-recap-matches-${this.account}`,
			versioned: false,
			encryption: s3.BucketEncryption.S3_MANAGED,
			lifecycleRules: [
				{
					id: 'transition-to-intelligent-tiering',
					enabled: true,
					transitions: [
						{
							storageClass: s3.StorageClass.INTELLIGENT_TIERING,
							transitionAfter: cdk.Duration.days(0) // Immediate
						}
					]
				}
			],
			removalPolicy: cdk.RemovalPolicy.DESTROY,
			autoDeleteObjects: true
		});

		// ===================================
		// DynamoDB Tables
		// ===================================

		// Player Profiles Table
		const playerTable = new dynamodb.Table(this, 'PlayerTable', {
			tableName: 'ChampionRecap-Players',
			partitionKey: { name: 'puuid', type: dynamodb.AttributeType.STRING },
			sortKey: { name: 'year', type: dynamodb.AttributeType.NUMBER },
			billingMode: dynamodb.BillingMode.PAY_PER_REQUEST, // Auto-scaling
			removalPolicy: cdk.RemovalPolicy.DESTROY,
			pointInTimeRecovery: true,
			stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES
		});

		// Champion Statistics Table
		const championStatsTable = new dynamodb.Table(this, 'ChampionStatsTable', {
			tableName: 'ChampionRecap-Stats',
			partitionKey: { name: 'puuid', type: dynamodb.AttributeType.STRING },
			sortKey: { name: 'year', type: dynamodb.AttributeType.NUMBER },
			billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
			removalPolicy: cdk.RemovalPolicy.DESTROY,
			pointInTimeRecovery: true
		});

		// Coaching Sessions Table
		const coachingSessionsTable = new dynamodb.Table(this, 'CoachingSessionsTable', {
			tableName: 'ChampionRecap-CoachingSessions',
			partitionKey: { name: 'session_id', type: dynamodb.AttributeType.STRING },
			sortKey: { name: 'timestamp', type: dynamodb.AttributeType.NUMBER },
			billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
			removalPolicy: cdk.RemovalPolicy.DESTROY,
			pointInTimeRecovery: true,
			timeToLiveAttribute: 'ttl'
		});

		// Global Secondary Index for querying by summoner
		coachingSessionsTable.addGlobalSecondaryIndex({
			indexName: 'SummonerIndex',
			partitionKey: { name: 'summoner_id', type: dynamodb.AttributeType.STRING },
			sortKey: { name: 'timestamp', type: dynamodb.AttributeType.NUMBER },
			projectionType: dynamodb.ProjectionType.ALL
		});

		// ===================================
		// S3 Bucket for Voice Models
		// ===================================
		const modelsBucket = s3.Bucket.fromBucketName(this, 'ModelsBucket', `champion-recap-models-${this.account}`);

		// S3 Bucket for Generated Voices
		const voicesBucket = new s3.Bucket(this, 'VoicesBucket', {
			bucketName: `champion-recap-voices-${this.account}`,
			versioned: false,
			encryption: s3.BucketEncryption.S3_MANAGED,
			lifecycleRules: [
				{
					id: 'expire-old-voices',
					enabled: true,
					expiration: cdk.Duration.days(30) // Cache for 30 days
				}
			],
			removalPolicy: cdk.RemovalPolicy.DESTROY,
			autoDeleteObjects: true,
			cors: [
				{
					allowedMethods: [s3.HttpMethods.GET],
					allowedOrigins: ['*'],
					allowedHeaders: ['*']
				}
			]
		});

		// ===================================
		// SQS Queues
		// ===================================

		// Dead Letter Queue (FIFO to match MatchProcessingQueue)
		const dlq = new sqs.Queue(this, 'ProcessingDLQ', {
			queueName: 'champion-recap-processing-dlq.fifo',
			fifo: true,
			contentBasedDeduplication: true,
			retentionPeriod: cdk.Duration.days(14)
		});

		// Async Invocation DLQ (for fetch-matches and aggregate-stats async failures)
		const asyncInvocationDLQ = new sqs.Queue(this, 'AsyncInvocationDLQ', {
			queueName: 'champion-recap-async-invocation-dlq',
			retentionPeriod: cdk.Duration.days(14)
		});

		// Match Processing Queue (FIFO for ordered processing per player)
		// https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-visibility-timeout.html
		const matchProcessingQueue = new sqs.Queue(this, 'MatchProcessingQueue', {
			queueName: 'champion-recap-match-processing.fifo',
			fifo: true,
			contentBasedDeduplication: true,
			visibilityTimeout: cdk.Duration.minutes(12), // 6x Lambda timeout (2min)
			deadLetterQueue: {
				queue: dlq,
				maxReceiveCount: 3
			}
		});

		// ===================================
		// Lambda Functions
		// ===================================

		// Lambda: Fetch Player Matches
		const fetchMatchesFunction = new lambda.Function(this, 'FetchMatchesFunction', {
			functionName: 'champion-recap-fetch-matches',
			runtime: lambda.Runtime.NODEJS_20_X,
			handler: 'index.handler',
			code: lambda.Code.fromAsset('../lambda/fetch-matches/dist'),
			timeout: cdk.Duration.minutes(15),
			memorySize: 1024,
			tracing: lambda.Tracing.ACTIVE,
			environment: {
				MATCH_DATA_BUCKET: matchDataBucket.bucketName,
				PLAYER_TABLE: playerTable.tableName,
				MATCH_PROCESSING_QUEUE_URL: matchProcessingQueue.queueUrl,
				RIOT_API_KEY: process.env.RIOT_API_KEY || ''
				// AGGREGATE_STATS_FUNCTION_NAME will be added after aggregateStatsFunction is created
			},
			logRetention: logs.RetentionDays.ONE_WEEK,
			// AWS Best Practice: Configure DLQ for async invocation failures
			onFailure: new SqsDestination(asyncInvocationDLQ)
		});

		// NOTE: Bedrock Coaching construct will be added after WebSocket API is created
		// This is because the construct needs the WebSocket endpoint URL
		// Placeholder for now - will be initialized after line 678

		// Lambda: Aggregate Champion Statistics
		const aggregateStatsFunction = new lambda.Function(this, 'AggregateStatsFunction', {
			functionName: 'champion-recap-aggregate-stats',
			runtime: lambda.Runtime.NODEJS_20_X,
			handler: 'index.handler',
			code: lambda.Code.fromAsset('../lambda/aggregate-stats/dist'),
			timeout: cdk.Duration.minutes(5),
			memorySize: 2048,
			tracing: lambda.Tracing.ACTIVE,
			environment: {
				CHAMPION_STATS_TABLE: championStatsTable.tableName,
				PLAYER_TABLE: playerTable.tableName,
				MATCH_DATA_BUCKET: matchDataBucket.bucketName
				// COACHING_AGENT_FUNCTION will be added after Bedrock construct is created
			},
			logRetention: logs.RetentionDays.ONE_WEEK,
			// AWS Best Practice: Configure DLQ for async invocation failures
			onFailure: new SqsDestination(asyncInvocationDLQ)
		});

		// Lambda: API Handler
		const apiHandlerFunction = new lambda.Function(this, 'ApiHandlerFunction', {
			functionName: 'champion-recap-api-handler',
			runtime: lambda.Runtime.NODEJS_20_X,
			handler: 'index.handler',
			code: lambda.Code.fromAsset('../lambda/api-handler/dist'),
			timeout: cdk.Duration.seconds(30),
			memorySize: 512,
			tracing: lambda.Tracing.ACTIVE,
			environment: {
				PLAYER_TABLE: playerTable.tableName,
				CHAMPION_STATS_TABLE: championStatsTable.tableName,
				FETCH_MATCHES_FUNCTION_ARN: fetchMatchesFunction.functionArn,
				RIOT_API_KEY: process.env.RIOT_API_KEY || ''
			},
			logRetention: logs.RetentionDays.ONE_WEEK
		});

		// Lambda: Process Match (SQS Consumer)
		const processMatchFunction = new lambda.Function(this, 'ProcessMatchFunction', {
			functionName: 'champion-recap-process-match',
			runtime: lambda.Runtime.NODEJS_20_X,
			handler: 'index.handler',
			code: lambda.Code.fromAsset('../lambda/process-match/dist'),
			timeout: cdk.Duration.minutes(2),
			memorySize: 512,
			reservedConcurrentExecutions: 10, // Limit concurrency to protect Riot API rate limits
			tracing: lambda.Tracing.ACTIVE,
			environment: {
				MATCH_DATA_BUCKET: matchDataBucket.bucketName,
				PLAYER_TABLE: playerTable.tableName,
				RIOT_API_KEY: process.env.RIOT_API_KEY || ''
				// AGGREGATE_STATS_FUNCTION_NAME will be added after aggregateStatsFunction is created
			},
			logRetention: logs.RetentionDays.ONE_WEEK
		});

		// Connect process-match Lambda to SQS queue
		// AWS Best Practice: Enable reportBatchItemFailures for partial batch response
		// https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html#services-sqs-batchfailurereporting
		processMatchFunction.addEventSource(new SqsEventSource(matchProcessingQueue, {
			batchSize: 5, // Process 5 messages at a time (maxBatchingWindow not supported for FIFO queues)
			reportBatchItemFailures: true // Enable partial batch response - only failed messages are retried
		}));

		// ===================================
		// Grant Permissions
		// ===================================

		// Fetch Matches Function
		matchDataBucket.grantRead(fetchMatchesFunction); // Need read for checking S3 cache
		playerTable.grantReadWriteData(fetchMatchesFunction);
		matchProcessingQueue.grantSendMessages(fetchMatchesFunction);
		aggregateStatsFunction.grantInvoke(fetchMatchesFunction);

		// Add aggregate stats function name to environment (after function is created)
		fetchMatchesFunction.addEnvironment('AGGREGATE_STATS_FUNCTION_NAME', aggregateStatsFunction.functionName);

		// Process Match Function
		matchDataBucket.grantWrite(processMatchFunction);
		playerTable.grantReadWriteData(processMatchFunction);
		aggregateStatsFunction.grantInvoke(processMatchFunction);
		// SQS permissions are automatically granted by addEventSource

		// Add aggregate stats function name to environment (after function is created)
		processMatchFunction.addEnvironment('AGGREGATE_STATS_FUNCTION_NAME', aggregateStatsFunction.functionName);

		// Aggregate Stats Function
		matchDataBucket.grantRead(aggregateStatsFunction);
		championStatsTable.grantWriteData(aggregateStatsFunction);
		playerTable.grantReadWriteData(aggregateStatsFunction);
		// Coaching agent invoke permission added after Bedrock construct creation (line 682)

		// API Handler Function
		playerTable.grantReadData(apiHandlerFunction);
		championStatsTable.grantReadData(apiHandlerFunction);
		fetchMatchesFunction.grantInvoke(apiHandlerFunction);

		// ===================================
		// API Gateway
		// ===================================

		const api = new apigateway.RestApi(this, 'ChampionRecapApi', {
			restApiName: 'Champion Recap API',
			description: 'API for Champion Recap service',
			deployOptions: {
				stageName: 'prod',
				throttlingRateLimit: 100,
				throttlingBurstLimit: 200,
				loggingLevel: apigateway.MethodLoggingLevel.INFO
			},
			defaultCorsPreflightOptions: {
				allowOrigins: apigateway.Cors.ALL_ORIGINS,
				allowMethods: apigateway.Cors.ALL_METHODS,
				allowHeaders: ['Content-Type', 'Authorization']
			}
		});

		// API Gateway Lambda Integration
		const apiIntegration = new apigateway.LambdaIntegration(apiHandlerFunction);

		// Routes
		const player = api.root.addResource('player');
		player.addMethod('GET', apiIntegration); // GET /player?gameName=X&tagLine=Y

		const recap = player.addResource('recap');
		recap.addMethod('GET', apiIntegration); // GET /player/recap?puuid=X&year=2025

		const status = player.addResource('status');
		status.addMethod('GET', apiIntegration); // GET /player/status?puuid=X&year=2025

		// ===================================
		// SageMaker Endpoint: F5-TTS Voice Generator with PyTorch
		// Simple PyTorch-based deployment - champion voices loaded dynamically from S3
		// ===================================

		// Create IAM role for SageMaker with all permissions defined upfront
		const sagemakerRole = new iam.Role(this, 'SageMakerVoiceGeneratorRole', {
			assumedBy: new iam.ServicePrincipal('sagemaker.amazonaws.com'),
			description: 'IAM role for F5-TTS SageMaker Endpoint with PyTorch',
			managedPolicies: [
				iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSageMakerFullAccess')
			],
			inlinePolicies: {
				S3ModelsBucketAccess: new iam.PolicyDocument({
					statements: [
						new iam.PolicyStatement({
							effect: iam.Effect.ALLOW,
							actions: ['s3:GetObject', 's3:ListBucket'],
							resources: [
								`arn:aws:s3:::champion-recap-models-${this.account}`,
								`arn:aws:s3:::champion-recap-models-${this.account}/*`
							]
						}),
						new iam.PolicyStatement({
							effect: iam.Effect.ALLOW,
							actions: ['s3:GetObject', 's3:PutObject', 's3:ListBucket'],
							resources: [
								`arn:aws:s3:::champion-recap-voices-${this.account}`,
								`arn:aws:s3:::champion-recap-voices-${this.account}/*`
							]
						})
					]
				})
			}
		});

		// Grant additional permissions
		championStatsTable.grantReadData(sagemakerRole); // Read player stats (optional)

		// SageMaker Model (PyTorch with F5-TTS)
		const sagemakerModel = new sagemaker.CfnModel(this, 'F5TTSVoiceGeneratorModel', {
			modelName: 'champion-recap-f5tts-voice-generator',
			executionRoleArn: sagemakerRole.roleArn,
			primaryContainer: {
				// AWS PyTorch Deep Learning Container for GPU inference
				image: `763104351884.dkr.ecr.${this.region}.amazonaws.com/pytorch-inference:2.1.0-gpu-py310`,
				modelDataUrl: `s3://${modelsBucket.bucketName}/f5tts-pytorch/model.tar.gz`, // PyTorch model artifacts
				environment: {
					// SageMaker PyTorch configuration
					SAGEMAKER_PROGRAM: 'inference.py', // Entry point script
					SAGEMAKER_REGION: this.region,

					// S3 bucket for champion reference audio
					VOICE_BUCKET: voicesBucket.bucketName
				}
			}
		});

		// SageMaker Endpoint Configuration
		// Using 1× ml.g4dn.xlarge instance (auto-scales to 4)
		const endpointConfig = new sagemaker.CfnEndpointConfig(this, 'F5TTSEndpointConfig', {
			endpointConfigName: 'champion-recap-f5tts-endpoint-config',
			productionVariants: [
				{
					variantName: 'AllTraffic',
					modelName: sagemakerModel.attrModelName,
					instanceType: 'ml.g4dn.xlarge', // T4 GPU, 16GB VRAM
					initialInstanceCount: 1, // Start with 1, auto-scale to 4
					initialVariantWeight: 1.0
				}
			]
		});

		endpointConfig.addDependency(sagemakerModel);

		// SageMaker Endpoint
		const endpoint = new sagemaker.CfnEndpoint(this, 'F5TTSEndpoint', {
			endpointName: 'f5tts-voice-generator',
			endpointConfigName: endpointConfig.attrEndpointConfigName
		});

		endpoint.addDependency(endpointConfig);

		// Auto-scaling configuration (1-2 instances)
		const autoScalingTarget = new cdk.aws_applicationautoscaling.ScalableTarget(this, 'F5TTSScalableTarget', {
			serviceNamespace: cdk.aws_applicationautoscaling.ServiceNamespace.SAGEMAKER,
			scalableDimension: 'sagemaker:variant:DesiredInstanceCount',
			resourceId: `endpoint/${endpoint.endpointName}/variant/AllTraffic`,
			minCapacity: 1,
			maxCapacity: 2
		});
		autoScalingTarget.node.addDependency(endpoint);

		// Target tracking scaling policy (based on invocations per instance)
		autoScalingTarget.scaleToTrackMetric('F5TTSAutoScaling', {
			targetValue: 1000, // Target 1000 invocations per instance
			predefinedMetric: cdk.aws_applicationautoscaling.PredefinedMetric.SAGEMAKER_VARIANT_INVOCATIONS_PER_INSTANCE,
			scaleInCooldown: cdk.Duration.minutes(5),
			scaleOutCooldown: cdk.Duration.minutes(1)
		});

		// ===================================
		// CloudWatch Alarms for SageMaker Endpoint Monitoring
		// ===================================

		// Alarm: High invocation error rate (> 5% over 5 minutes)
		const invocationErrorAlarm = new cloudwatch.Alarm(this, 'F5TTSInvocationErrors', {
			alarmName: 'F5TTS-HighErrorRate',
			alarmDescription: 'F5-TTS SageMaker endpoint has high invocation error rate (> 5%)',
			metric: new cloudwatch.Metric({
				namespace: 'AWS/SageMaker',
				metricName: 'ModelInvocation4XXErrors',
				dimensionsMap: {
					EndpointName: endpoint.endpointName!,
					VariantName: 'AllTraffic'
				},
				statistic: 'Sum',
				period: cdk.Duration.minutes(5)
			}),
			threshold: 5,
			evaluationPeriods: 1,
			comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
			treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING
		});

		// Alarm: High latency (p99 > 10 seconds)
		const latencyAlarm = new cloudwatch.Alarm(this, 'F5TTSHighLatency', {
			alarmName: 'F5TTS-HighLatency',
			alarmDescription: 'F5-TTS SageMaker endpoint p99 latency > 10 seconds',
			metric: new cloudwatch.Metric({
				namespace: 'AWS/SageMaker',
				metricName: 'ModelLatency',
				dimensionsMap: {
					EndpointName: endpoint.endpointName!,
					VariantName: 'AllTraffic'
				},
				statistic: 'p99',
				period: cdk.Duration.minutes(5)
			}),
			threshold: 10000, // 10 seconds in milliseconds
			evaluationPeriods: 2,
			comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
			treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING
		});

		// Alarm: High GPU utilization (> 90% for 5 minutes)
		const gpuUtilizationAlarm = new cloudwatch.Alarm(this, 'F5TTSHighGPUUtilization', {
			alarmName: 'F5TTS-HighGPUUtilization',
			alarmDescription: 'F5-TTS SageMaker endpoint GPU utilization > 90%',
			metric: new cloudwatch.Metric({
				namespace: '/aws/sagemaker/Endpoints',
				metricName: 'GPUUtilization',
				dimensionsMap: {
					EndpointName: endpoint.endpointName!,
					VariantName: 'AllTraffic'
				},
				statistic: 'Average',
				period: cdk.Duration.minutes(5)
			}),
			threshold: 90,
			evaluationPeriods: 1,
			comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
			treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING
		});

		// Lambda function to proxy SageMaker/PyTorch requests
		// This allows us to keep the same API Gateway interface
		const voiceGeneratorLambda = new lambda.Function(this, 'VoiceGeneratorProxyFunction', {
			functionName: 'champion-recap-voice-generator-proxy',
			runtime: lambda.Runtime.NODEJS_20_X,
			handler: 'index.handler',
			code: lambda.Code.fromInline(`
const { SageMakerRuntimeClient, InvokeEndpointCommand } = require('@aws-sdk/client-sagemaker-runtime');

const client = new SageMakerRuntimeClient({ region: process.env.AWS_REGION });
const ENDPOINT_NAME = process.env.SAGEMAKER_ENDPOINT_NAME;

exports.handler = async (event) => {
  try {
    const body = JSON.parse(event.body);
    const { championId, text, duration } = body;

    if (!championId || !text) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Missing required parameters: championId and text' })
      };
    }

    // Prepare PyTorch inference request format (matches inference.py input_fn)
    const pytorchPayload = {
      champion_id: championId.toLowerCase(),
      text: text,
      voice_bucket: process.env.VOICE_BUCKET,
      duration: duration // Optional, auto-calculated if not provided
    };

    // Invoke SageMaker endpoint (PyTorch inference)
    const command = new InvokeEndpointCommand({
      EndpointName: ENDPOINT_NAME,
      ContentType: 'application/json',
      Accept: 'application/json', // Request JSON response with base64 audio
      Body: JSON.stringify(pytorchPayload)
    });

    const response = await client.send(command);
    const result = JSON.parse(new TextDecoder().decode(response.Body));

    // PyTorch endpoint returns: { audio: base64, sample_rate: 24000, duration: X, format: "wav" }
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audio_data: result.audio, // Base64-encoded WAV
        sample_rate: result.sample_rate,
        duration: result.duration,
        format: result.format,
        champion_id: championId
      })
    };

  } catch (error) {
    console.error('SageMaker PyTorch invocation error:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'Voice generation failed',
        message: error.message
      })
    };
  }
};
			`),
			timeout: cdk.Duration.minutes(2),
			memorySize: 512,
			tracing: lambda.Tracing.ACTIVE,
			environment: {
				SAGEMAKER_ENDPOINT_NAME: endpoint.endpointName!,
				VOICE_BUCKET: voicesBucket.bucketName
			},
			logRetention: logs.RetentionDays.ONE_WEEK
		});

		// Grant Lambda permission to invoke SageMaker endpoint
		voiceGeneratorLambda.addToRolePolicy(new iam.PolicyStatement({
			actions: ['sagemaker:InvokeEndpoint'],
			resources: [endpoint.ref]
		}));

		// Add voice generator to API Gateway via Lambda proxy
		const voice = api.root.addResource('voice');
		const generate = voice.addResource('generate');

		generate.addMethod('POST', new apigateway.LambdaIntegration(voiceGeneratorLambda));

		// ===================================
		// Update Coaching Agent with additional environment variables and permissions
		// ===================================

		// Old coaching agent environment and permissions removed
		// All permissions now handled by BedrockCoachingConstruct (line 669-682)

		// ===================================
		// WebSocket API for Real-time Coaching Streaming
		// ===================================

		// WebSocket Lambda for connection management
		const wsConnectionHandler = new lambda.Function(this, 'WSConnectionHandler', {
			functionName: 'champion-recap-ws-connection',
			runtime: lambda.Runtime.NODEJS_20_X,
			handler: 'index.handler',
			code: lambda.Code.fromInline(`
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, DeleteCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE;
const SESSIONS_TABLE = process.env.SESSIONS_TABLE;

exports.handler = async (event) => {
  const connectionId = event.requestContext.connectionId;
  const routeKey = event.requestContext.routeKey;

  // Extract sessionId from query parameters
  const queryParams = event.queryStringParameters || {};
  const sessionId = queryParams.sessionId;

  console.log(JSON.stringify({
    level: 'INFO',
    message: 'WebSocket event',
    connectionId,
    routeKey,
    sessionId,
    timestamp: new Date().toISOString()
  }));

  try {
    if (routeKey === '$connect') {
      // Validate sessionId is provided
      if (!sessionId) {
        console.log(JSON.stringify({
          level: 'WARN',
          message: 'Connection rejected - missing sessionId',
          connectionId,
          timestamp: new Date().toISOString()
        }));
        return { statusCode: 400, body: 'Missing sessionId query parameter' };
      }

      // Validate session exists in DynamoDB
      try {
        const sessionResult = await docClient.send(new GetCommand({
          TableName: SESSIONS_TABLE,
          Key: { session_id: sessionId, timestamp: 0 } // Using composite key - may need adjustment
        }));

        if (!sessionResult.Item) {
          console.log(JSON.stringify({
            level: 'WARN',
            message: 'Connection rejected - invalid sessionId',
            connectionId,
            sessionId,
            timestamp: new Date().toISOString()
          }));
          return { statusCode: 403, body: 'Invalid sessionId' };
        }
      } catch (err) {
        console.log(JSON.stringify({
          level: 'WARN',
          message: 'Session validation skipped - table query failed',
          connectionId,
          sessionId,
          error: err.message,
          timestamp: new Date().toISOString()
        }));
        // Continue connection even if validation fails (graceful degradation)
      }

      // Store connection with sessionId
      await docClient.send(new PutCommand({
        TableName: CONNECTIONS_TABLE,
        Item: {
          connectionId,
          sessionId,
          timestamp: Date.now(),
          ttl: Math.floor(Date.now() / 1000) + (3600 * 8) // 8 hours
        }
      }));

      console.log(JSON.stringify({
        level: 'INFO',
        message: 'Connection established',
        connectionId,
        sessionId,
        timestamp: new Date().toISOString()
      }));

      return { statusCode: 200, body: 'Connected' };
    }

    if (routeKey === '$disconnect') {
      // Remove connection
      await docClient.send(new DeleteCommand({
        TableName: CONNECTIONS_TABLE,
        Key: { connectionId }
      }));

      console.log(JSON.stringify({
        level: 'INFO',
        message: 'Connection closed',
        connectionId,
        timestamp: new Date().toISOString()
      }));

      return { statusCode: 200, body: 'Disconnected' };
    }

    if (routeKey === '$default') {
      // Handle incoming messages
      return { statusCode: 200, body: 'Message received' };
    }

    return { statusCode: 400, body: 'Unknown route' };

  } catch (error) {
    console.error(JSON.stringify({
      level: 'ERROR',
      message: 'WebSocket error',
      connectionId,
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    }));
    return { statusCode: 500, body: 'Server error' };
  }
};
			`),
			timeout: cdk.Duration.seconds(30),
			memorySize: 256,
			tracing: lambda.Tracing.ACTIVE,
			environment: {
				CONNECTIONS_TABLE: coachingSessionsTable.tableName,
				SESSIONS_TABLE: coachingSessionsTable.tableName // Using same table with different keys
			},
			logRetention: logs.RetentionDays.ONE_WEEK
		});

		// Grant WebSocket handler permissions
		coachingSessionsTable.grantReadWriteData(wsConnectionHandler);

		// WebSocket API Gateway
		const wsApi = new apigatewayv2.CfnApi(this, 'CoachingWebSocketApi', {
			name: 'champion-recap-coaching-ws',
			protocolType: 'WEBSOCKET',
			routeSelectionExpression: '$request.body.action'
		});

		// WebSocket Integration
		const wsIntegration = new apigatewayv2.CfnIntegration(this, 'WSIntegration', {
			apiId: wsApi.ref,
			integrationType: 'AWS_PROXY',
			integrationUri: `arn:aws:apigateway:${this.region}:lambda:path/2015-03-31/functions/${wsConnectionHandler.functionArn}/invocations`,
			credentialsArn: wsConnectionHandler.role!.roleArn
		});

		// WebSocket Routes
		['$connect', '$disconnect', '$default'].forEach((routeKey) => {
			const route = new apigatewayv2.CfnRoute(this, `WSRoute${routeKey}`, {
				apiId: wsApi.ref,
				routeKey,
				target: `integrations/${wsIntegration.ref}`
			});
			route.addDependency(wsIntegration);
		});

		// WebSocket Deployment
		const wsDeployment = new apigatewayv2.CfnDeployment(this, 'WSDeployment', {
			apiId: wsApi.ref
		});

		// WebSocket Stage
		const wsStage = new apigatewayv2.CfnStage(this, 'WSStage', {
			apiId: wsApi.ref,
			deploymentId: wsDeployment.ref,
			stageName: 'prod',
			description: 'Production WebSocket stage for coaching'
		});
		wsStage.addDependency(wsDeployment);

		// Grant WebSocket invoke permissions
		wsConnectionHandler.grantInvoke(new iam.ServicePrincipal('apigateway.amazonaws.com'));

		// ===================================
		// Bedrock Coaching Agent Infrastructure
		// ===================================

		const websocketEndpoint = `https://${wsApi.ref}.execute-api.${this.region}.amazonaws.com/${wsStage.stageName}`;

		const bedrockCoaching = new BedrockCoachingConstruct(this, 'BedrockCoaching', {
			matchDataBucket,
			voicesBucket,
			sessionsTable: coachingSessionsTable,
			sagemakerEndpointName: endpoint.endpointName!,
			websocketEndpoint
		});

		// Update aggregate-stats Lambda to invoke orchestrator
		aggregateStatsFunction.addEnvironment(
			'COACHING_AGENT_FUNCTION',
			bedrockCoaching.orchestratorFunction.functionName
		);
		bedrockCoaching.orchestratorFunction.grantInvoke(aggregateStatsFunction);

		// ===================================
		// CloudWatch Alarms (Production Monitoring)
		// ===================================

		// Alarm 1: DLQ Messages - Critical for detecting SQS processing failures
		new cloudwatch.Alarm(this, 'SQSDLQMessagesAlarm', {
			alarmName: 'ChampionRecap-SQS-DLQ-Messages',
			alarmDescription: 'Alert when messages land in SQS DLQ - indicates processing failures',
			metric: dlq.metricApproximateNumberOfMessagesVisible(),
			threshold: 1,
			evaluationPeriods: 1,
			comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
			treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING
		});

		// Alarm 2: Async Invocation DLQ - Critical for detecting Lambda async invocation failures
		new cloudwatch.Alarm(this, 'AsyncDLQMessagesAlarm', {
			alarmName: 'ChampionRecap-Async-DLQ-Messages',
			alarmDescription: 'Alert when async invocations fail and land in DLQ',
			metric: asyncInvocationDLQ.metricApproximateNumberOfMessagesVisible(),
			threshold: 1,
			evaluationPeriods: 1,
			comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
			treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING
		});

		// Alarm 3: Process-Match Lambda Errors - High error rate indicates Riot API issues
		new cloudwatch.Alarm(this, 'ProcessMatchErrorsAlarm', {
			alarmName: 'ChampionRecap-ProcessMatch-Errors',
			alarmDescription: 'Alert on high error rate in process-match Lambda',
			metric: processMatchFunction.metricErrors({
				statistic: cloudwatch.Stats.SUM,
				period: cdk.Duration.minutes(5)
			}),
			threshold: 10,
			evaluationPeriods: 2,
			comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
			treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING
		});

		// Alarm 4: Process-Match Lambda Throttles - Reserved concurrency limit reached
		new cloudwatch.Alarm(this, 'ProcessMatchThrottlesAlarm', {
			alarmName: 'ChampionRecap-ProcessMatch-Throttles',
			alarmDescription: 'Alert when process-match hits reserved concurrency limit',
			metric: processMatchFunction.metricThrottles({
				statistic: cloudwatch.Stats.SUM,
				period: cdk.Duration.minutes(1)
			}),
			threshold: 5,
			evaluationPeriods: 1,
			comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
			treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING
		});

		// Alarm 5: Fetch-Matches Lambda Errors - Indicates API Gateway or Riot API issues
		new cloudwatch.Alarm(this, 'FetchMatchesErrorsAlarm', {
			alarmName: 'ChampionRecap-FetchMatches-Errors',
			alarmDescription: 'Alert on high error rate in fetch-matches Lambda',
			metric: fetchMatchesFunction.metricErrors({
				statistic: cloudwatch.Stats.SUM,
				period: cdk.Duration.minutes(5)
			}),
			threshold: 5,
			evaluationPeriods: 2,
			comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
			treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING
		});

		// ===================================
		// Outputs
		// ===================================

		new cdk.CfnOutput(this, 'ApiUrl', {
			value: api.url,
			description: 'API Gateway URL'
		});

		new cdk.CfnOutput(this, 'MatchDataBucketName', {
			value: matchDataBucket.bucketName,
			description: 'S3 bucket for match data'
		});

		new cdk.CfnOutput(this, 'PlayerTableName', {
			value: playerTable.tableName,
			description: 'DynamoDB table for player profiles'
		});

		new cdk.CfnOutput(this, 'ChampionStatsTableName', {
			value: championStatsTable.tableName,
			description: 'DynamoDB table for champion statistics'
		});

		new cdk.CfnOutput(this, 'ModelsBucketName', {
			value: modelsBucket.bucketName,
			description: 'S3 bucket for voice models'
		});

		new cdk.CfnOutput(this, 'VoicesBucketName', {
			value: voicesBucket.bucketName,
			description: 'S3 bucket for generated voices'
		});

		new cdk.CfnOutput(this, 'SageMakerEndpointName', {
			value: endpoint.endpointName!,
			description: 'SageMaker endpoint name for voice generation'
		});

		new cdk.CfnOutput(this, 'VoiceGeneratorLambdaArn', {
			value: voiceGeneratorLambda.functionArn,
			description: 'Lambda proxy function ARN for voice generation'
		});

		new cdk.CfnOutput(this, 'CoachingSessionsTableName', {
			value: coachingSessionsTable.tableName,
			description: 'DynamoDB table for coaching sessions'
		});

		new cdk.CfnOutput(this, 'BedrockAgentId', {
			value: bedrockCoaching.agent.attrAgentId,
			description: 'Bedrock Agent ID for coaching'
		});

		new cdk.CfnOutput(this, 'BedrockAgentAliasId', {
			value: bedrockCoaching.agentAlias.attrAgentAliasId,
			description: 'Bedrock Agent Alias ID for coaching'
		});

		new cdk.CfnOutput(this, 'CoachingOrchestratorFunctionArn', {
			value: bedrockCoaching.orchestratorFunction.functionArn,
			description: 'Lambda orchestrator function ARN for coaching'
		});

		new cdk.CfnOutput(this, 'WebSocketApiUrl', {
			value: `wss://${wsApi.ref}.execute-api.${this.region}.amazonaws.com/${wsStage.stageName}`,
			description: 'WebSocket API URL for coaching streaming'
		});
	}
}
