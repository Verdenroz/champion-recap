import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as logs from 'aws-cdk-lib/aws-logs';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { Construct } from 'constructs';

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
			removalPolicy: cdk.RemovalPolicy.RETAIN
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
			removalPolicy: cdk.RemovalPolicy.RETAIN,
			pointInTimeRecovery: true,
			stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES
		});

		// Champion Statistics Table
		const championStatsTable = new dynamodb.Table(this, 'ChampionStatsTable', {
			tableName: 'ChampionRecap-Stats',
			partitionKey: { name: 'puuid', type: dynamodb.AttributeType.STRING },
			sortKey: { name: 'year', type: dynamodb.AttributeType.NUMBER },
			billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
			removalPolicy: cdk.RemovalPolicy.RETAIN,
			pointInTimeRecovery: true
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

		// Match Processing Queue (FIFO for ordered processing per player)
		const matchProcessingQueue = new sqs.Queue(this, 'MatchProcessingQueue', {
			queueName: 'champion-recap-match-processing.fifo',
			fifo: true,
			contentBasedDeduplication: true,
			visibilityTimeout: cdk.Duration.minutes(5),
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
			environment: {
				MATCH_DATA_BUCKET: matchDataBucket.bucketName,
				PLAYER_TABLE: playerTable.tableName,
				MATCH_PROCESSING_QUEUE_URL: matchProcessingQueue.queueUrl,
				RIOT_API_KEY: process.env.RIOT_API_KEY || ''
			},
			logRetention: logs.RetentionDays.ONE_WEEK
		});

		// Lambda: Aggregate Champion Statistics
		const aggregateStatsFunction = new lambda.Function(this, 'AggregateStatsFunction', {
			functionName: 'champion-recap-aggregate-stats',
			runtime: lambda.Runtime.NODEJS_20_X,
			handler: 'index.handler',
			code: lambda.Code.fromAsset('../lambda/aggregate-stats/dist'),
			timeout: cdk.Duration.minutes(5),
			memorySize: 2048,
			environment: {
				CHAMPION_STATS_TABLE: championStatsTable.tableName,
				PLAYER_TABLE: playerTable.tableName,
				MATCH_DATA_BUCKET: matchDataBucket.bucketName
			},
			logRetention: logs.RetentionDays.ONE_WEEK
		});

		// Lambda: API Handler
		const apiHandlerFunction = new lambda.Function(this, 'ApiHandlerFunction', {
			functionName: 'champion-recap-api-handler',
			runtime: lambda.Runtime.NODEJS_20_X,
			handler: 'index.handler',
			code: lambda.Code.fromAsset('../lambda/api-handler/dist'),
			timeout: cdk.Duration.seconds(30),
			memorySize: 512,
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
			environment: {
				MATCH_DATA_BUCKET: matchDataBucket.bucketName,
				PLAYER_TABLE: playerTable.tableName,
				RIOT_API_KEY: process.env.RIOT_API_KEY || ''
			},
			logRetention: logs.RetentionDays.ONE_WEEK
			// Note: reservedConcurrentExecutions removed due to account limits
			// Riot API rate limiting is handled by retry logic and SQS visibility timeout
		});

		// Connect process-match Lambda to SQS queue
		processMatchFunction.addEventSource(new SqsEventSource(matchProcessingQueue, {
			batchSize: 5 // Process 5 messages at a time (maxBatchingWindow not supported for FIFO queues)
		}));

		// ===================================
		// Grant Permissions
		// ===================================

		// Fetch Matches Function
		matchDataBucket.grantRead(fetchMatchesFunction); // Need read for checking S3 cache
		playerTable.grantReadWriteData(fetchMatchesFunction);
		matchProcessingQueue.grantSendMessages(fetchMatchesFunction);
		aggregateStatsFunction.grantInvoke(fetchMatchesFunction);

		// Process Match Function
		matchDataBucket.grantWrite(processMatchFunction);
		playerTable.grantReadWriteData(processMatchFunction);
		aggregateStatsFunction.grantInvoke(processMatchFunction);
		// SQS permissions are automatically granted by addEventSource

		// Aggregate Stats Function
		matchDataBucket.grantRead(aggregateStatsFunction);
		championStatsTable.grantWriteData(aggregateStatsFunction);
		playerTable.grantReadWriteData(aggregateStatsFunction);

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
	}
}
