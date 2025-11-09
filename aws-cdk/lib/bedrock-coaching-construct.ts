import * as cdk from 'aws-cdk-lib';
import * as bedrock from 'aws-cdk-lib/aws-bedrock';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

/**
 * Champion personality mappings for dynamic agent behavior
 */
const CHAMPION_PERSONALITIES = {
	yasuo: 'Direct, focused swordsman. Speaks of honor, precision, and timing.',
	jinx: 'Chaotic, explosive energy. Finds humor in everything, loves big plays.',
	thresh: 'Cold, calculated analyst. Focus on vision, positioning, and opportunities.',
	ahri: 'Graceful, playful charm. Appreciates clever outplays and mobility.',
	default: 'Professional, encouraging coach. Clear and actionable feedback.'
};

/**
 * Props for Bedrock Coaching Construct
 */
export interface BedrockCoachingConstructProps {
	/**
	 * S3 bucket for match data
	 */
	matchDataBucket: cdk.aws_s3.IBucket;

	/**
	 * S3 bucket for voice files
	 */
	voicesBucket: cdk.aws_s3.IBucket;

	/**
	 * DynamoDB table for coaching sessions
	 */
	sessionsTable: cdk.aws_dynamodb.ITable;

	/**
	 * SageMaker endpoint name for voice generation
	 */
	sagemakerEndpointName: string;

	/**
	 * WebSocket API endpoint for real-time streaming
	 */
	websocketEndpoint: string;
}

/**
 * Bedrock Agent construct for League of Legends coaching
 */
export class BedrockCoachingConstruct extends Construct {
	public readonly agent: bedrock.CfnAgent;
	public readonly agentAlias: bedrock.CfnAgentAlias;
	public readonly orchestratorFunction: lambda.Function;
	public readonly actionHandlerFunction: lambda.Function;

	constructor(scope: Construct, id: string, props: BedrockCoachingConstructProps) {
		super(scope, id);

		const region = cdk.Stack.of(this).region;
		const account = cdk.Stack.of(this).account;

		// ===================================
		// Action Handler Lambda
		// ===================================

		// This Lambda handles action group callbacks from Bedrock Agent
		this.actionHandlerFunction = new lambda.Function(this, 'ActionHandler', {
			functionName: 'champion-recap-coaching-action-handler',
			runtime: lambda.Runtime.PYTHON_3_11,
			handler: 'action_handler.handler',
			code: lambda.Code.fromAsset('../lambda/bedrock-coaching-orchestrator'),
			timeout: cdk.Duration.minutes(2),
			memorySize: 1024,
			tracing: lambda.Tracing.ACTIVE,
			environment: {
				MATCH_DATA_BUCKET: props.matchDataBucket.bucketName,
				VOICE_BUCKET: props.voicesBucket.bucketName,
				SAGEMAKER_ENDPOINT: props.sagemakerEndpointName,
				SESSIONS_TABLE: props.sessionsTable.tableName,
				WEBSOCKET_ENDPOINT: props.websocketEndpoint
			},
			logRetention: logs.RetentionDays.ONE_WEEK
		});

		// Grant permissions to action handler
		props.matchDataBucket.grantRead(this.actionHandlerFunction);
		props.voicesBucket.grantReadWrite(this.actionHandlerFunction);
		props.sessionsTable.grantReadWriteData(this.actionHandlerFunction);

		// SageMaker invoke permissions
		this.actionHandlerFunction.addToRolePolicy(
			new iam.PolicyStatement({
				actions: ['sagemaker:InvokeEndpoint'],
				resources: [
					`arn:aws:sagemaker:${region}:${account}:endpoint/${props.sagemakerEndpointName}`
				]
			})
		);

		// WebSocket post permissions
		this.actionHandlerFunction.addToRolePolicy(
			new iam.PolicyStatement({
				actions: ['execute-api:ManageConnections'],
				resources: [`arn:aws:execute-api:${region}:${account}:*/*`]
			})
		);

		// CRITICAL: Add Lambda resource-based permission BEFORE agent creation
		// Bedrock validates Lambda access during agent creation, not after
		// Using wildcard ARN pattern since agent ARN doesn't exist yet
		// MUST include both sourceArn AND sourceAccount conditions (AWS security best practice)
		this.actionHandlerFunction.addPermission('AllowBedrockAgentInvoke', {
			principal: new iam.ServicePrincipal('bedrock.amazonaws.com'),
			action: 'lambda:InvokeFunction',
			sourceArn: `arn:aws:bedrock:${region}:${account}:agent/*`,
			sourceAccount: account
		});

		// ===================================
		// Bedrock Agent IAM Role
		// ===================================

		const agentRole = new iam.Role(this, 'AgentRole', {
			assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com', {
				conditions: {
					StringEquals: {
						'aws:SourceAccount': account
					},
					ArnLike: {
						'aws:SourceArn': `arn:aws:bedrock:${region}:${account}:agent/*`
					}
				}
			}),
			description: 'Execution role for Champion Recap coaching agent'
		});

		// Allow agent to invoke foundation model
		// Using Amazon Nova Lite (ACTIVE lifecycle, AWS native model designed for agents)
		// Note: Anthropic Haiku 4.5 only supports INFERENCE_PROFILE mode (incompatible with agents)
		// Note: Anthropic Claude 3.5 Sonnet has LEGACY lifecycle status (stabilization failures)
		// Note: Anthropic Claude 3 Haiku still failed stabilization despite ACTIVE status
		agentRole.addToPolicy(
			new iam.PolicyStatement({
				actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
				resources: [
					// Amazon Nova Lite foundation model in us-east-1 (ACTIVE lifecycle, AWS native)
					`arn:aws:bedrock:us-east-1::foundation-model/amazon.nova-lite-v1:0`
				]
			})
		);

		// Allow agent to get inference profile metadata
		agentRole.addToPolicy(
			new iam.PolicyStatement({
				actions: [
					'bedrock:GetInferenceProfile',
					'bedrock:ListInferenceProfiles'
				],
				resources: [
					`arn:aws:bedrock:${region}:${account}:inference-profile/*`
				]
			})
		);

		// Allow agent to invoke action handler Lambda
		agentRole.addToPolicy(
			new iam.PolicyStatement({
				actions: ['lambda:InvokeFunction'],
				resources: [this.actionHandlerFunction.functionArn]
			})
		);

		// ===================================
		// Action Groups (MUST be defined BEFORE agent creation)
		// ===================================

		// Action Group 1: Stream Match Data
		const streamMatchDataAction: bedrock.CfnAgent.AgentActionGroupProperty = {
			actionGroupName: 'StreamMatchData',
			description: 'Receive and record a single match for analysis',
			actionGroupExecutor: {
				lambda: this.actionHandlerFunction.functionArn
			},
			functionSchema: {
				functions: [
					{
						name: 'streamMatchData',
						description:
							'Record a match in session memory. Call this for EVERY match you receive. AWS Bedrock limit: max 5 parameters per function.',
						parameters: {
							matchNumber: {
								type: 'integer',
								description: 'Current match number (1-based index)',
								required: true
							},
							totalMatches: {
								type: 'integer',
								description: 'Total number of matches to analyze',
								required: true
							},
							matchSummary: {
								type: 'string',
								description:
									'JSON string containing all match details: championName, kda, kills, deaths, assists, cs, csPerMin, visionScore, win, position, and other stats',
								required: true
							},
							championName: {
								type: 'string',
								description: 'Champion played this match (for quick reference)',
								required: true
							},
							result: {
								type: 'string',
								description: 'Match result: "win" or "loss"',
								required: true
							}
						}
					}
				]
			}
		};

		// Action Group 2: Detect Patterns
		const detectPatternAction: bedrock.CfnAgent.AgentActionGroupProperty = {
			actionGroupName: 'DetectPattern',
			description: 'Analyze patterns across matches analyzed so far',
			actionGroupExecutor: {
				lambda: this.actionHandlerFunction.functionArn
			},
			functionSchema: {
				functions: [
					{
						name: 'detectPattern',
						description:
							'Detect patterns in player performance across multiple matches. Call when you notice a trend.',
						parameters: {
							patternType: {
								type: 'string',
								description:
									'Type of pattern to analyze: deaths, farming, vision, positioning, championPool',
								required: true
							},
							matchesInPattern: {
								type: 'integer',
								description: 'Number of matches showing this pattern',
								required: false
							}
						}
					}
				]
			}
		};

		// Action Group 3: Generate Quick Remark
		const quickRemarkAction: bedrock.CfnAgent.AgentActionGroupProperty = {
			actionGroupName: 'GenerateQuickRemark',
			description: 'Generate short voice observation when pattern is spotted',
			actionGroupExecutor: {
				lambda: this.actionHandlerFunction.functionArn
			},
			functionSchema: {
				functions: [
					{
						name: 'generateQuickRemark',
						description:
							'Generate SHORT voice line (20-30 words max) when you spot a pattern. Call sparingly (2-3 times max).',
						parameters: {
							remarkText: {
								type: 'string',
								description:
									'Short observation in champion personality (20-30 words). Be specific and memorable.',
								required: true
							},
							remarkType: {
								type: 'string',
								description:
									'Type: encouragement, warning, pattern_spotted, improvement_noticed',
								required: true
							},
							matchNumber: {
								type: 'integer',
								description: 'Match number where pattern was spotted',
								required: false
							}
						}
					}
				]
			}
		};

		// Action Group 4: Generate Concluding Remark
		const concludingRemarkAction: bedrock.CfnAgent.AgentActionGroupProperty = {
			actionGroupName: 'GenerateConcludingRemark',
			description: 'Generate comprehensive final summary with voice',
			actionGroupExecutor: {
				lambda: this.actionHandlerFunction.functionArn
			},
			functionSchema: {
				functions: [
					{
						name: 'generateConcludingRemark',
						description:
							'Generate LONG final summary (80-100 words) after all matches are analyzed. Call ONCE at the end.',
						parameters: {
							conclusionText: {
								type: 'string',
								description:
									'Comprehensive summary in champion personality (80-100 words). Include strengths, weaknesses, and actionable advice.',
								required: true
							},
							keyStrengths: {
								type: 'array',
								description: 'List of 2-3 main strengths identified',
								required: true
							},
							keyWeaknesses: {
								type: 'array',
								description: 'List of 2-3 main weaknesses to improve',
								required: true
							},
							averageKDA: {
								type: 'number',
								description: 'Average KDA across all matches',
								required: false
							},
							winRate: {
								type: 'number',
								description: 'Win rate percentage (0-100)',
								required: false
							}
						}
					}
				]
			}
		};

		// ===================================
		// Bedrock Agent
		// ===================================

		const personalityDescriptions = Object.entries(CHAMPION_PERSONALITIES)
			.map(([champ, desc]) => `- ${champ}: ${desc}`)
			.join('\n');

		this.agent = new bedrock.CfnAgent(this, 'CoachingAgent', {
			agentName: 'champion-recap-coaching-agent',
			agentResourceRoleArn: agentRole.roleArn,
			foundationModel: 'amazon.nova-lite-v1:0',

			// CRITICAL: Disable auto-prepare to prevent premature validation
			// We manually prepare via custom resource AFTER all dependencies are ready
			autoPrepare: false,

			// Allow easier cleanup during testing/debugging
			skipResourceInUseCheckOnDelete: true,

			instruction: `You are an adaptive League of Legends coach analyzing a player's match history.

Your personality changes based on sessionAttributes.championPersonality:
${personalityDescriptions}

Coaching Guidelines:
1. Analyze matches incrementally as they stream in
2. Build context about player's patterns across matches
3. Provide SHORT observations (20-30 words) when you detect patterns
4. Save comprehensive feedback for the final conclusion (80-100 words)

When analyzing:
- Track KDA trends, CS/min patterns, vision scores
- Identify recurring mistakes (positioning, overextending, poor vision)
- Recognize strengths (mechanics, decision-making, consistency)
- Detect champion-specific performance variations

Call actions strategically:
- streamMatchData: Record each match (call for EVERY match). Create a JSON string with all match data for the matchSummary parameter.
- detectPattern: When you notice a trend across 3+ matches
- generateQuickRemark: When you spot a clear pattern worth mentioning (2-3 times max)
- generateConcludingRemark: At the end with overall assessment

Note: streamMatchData accepts a matchSummary JSON string containing all stats. Extract key data from the match description and format as JSON.

Be in character! Use phrases and tone matching your champion personality.`,

			description: 'AI coaching agent for League of Legends match analysis',

			// Enable session memory to remember all matches in the session
			memoryConfiguration: {
				enabledMemoryTypes: ['SESSION_SUMMARY'],
				storageDays: 1 // Sessions last up to 1 day
			},

			// Idle timeout - 8 minutes max for analysis
			idleSessionTtlInSeconds: 480,

			// CRITICAL: Include all action groups at creation time
			// CloudFormation L1 constructs don't support property mutations after creation
			actionGroups: [
				streamMatchDataAction,
				detectPatternAction,
				quickRemarkAction,
				concludingRemarkAction
			]
		});

		// CRITICAL: Ensure agent is created AFTER all dependencies are ready
		// This prevents CloudFormation from trying to validate the agent before Lambda permission exists
		this.agent.node.addDependency(this.actionHandlerFunction);
		this.agent.node.addDependency(agentRole);

		// ===================================
		// Agent Alias
		// ===================================

		// Create alias for agent (required for invocation)
		this.agentAlias = new bedrock.CfnAgentAlias(this, 'CoachingAgentAlias', {
			agentId: this.agent.attrAgentId,
			agentAliasName: 'production',
			description: 'Production alias for coaching agent'
		});

		// Prepare agent after creation (required step)
		const prepareAgent = new cdk.CustomResource(this, 'PrepareAgent', {
			serviceToken: new cdk.custom_resources.Provider(this, 'PrepareAgentProvider', {
				onEventHandler: new lambda.Function(this, 'PrepareAgentHandler', {
					runtime: lambda.Runtime.PYTHON_3_11,
					handler: 'index.handler',
					code: lambda.Code.fromInline(`
import boto3
import json

bedrock = boto3.client('bedrock-agent')

def handler(event, context):
    request_type = event['RequestType']
    agent_id = event['ResourceProperties']['AgentId']

    if request_type == 'Create' or request_type == 'Update':
        # Prepare the agent
        response = bedrock.prepare_agent(agentId=agent_id)
        return {
            'PhysicalResourceId': agent_id,
            'Data': {
                'AgentStatus': response['agentStatus']
            }
        }

    return {'PhysicalResourceId': agent_id}
					`),
					timeout: cdk.Duration.minutes(5),
					tracing: lambda.Tracing.ACTIVE,
					initialPolicy: [
						new iam.PolicyStatement({
							actions: ['bedrock:PrepareAgent', 'bedrock:GetAgent'],
							resources: [this.agent.attrAgentArn]
						})
					]
				})
			}).serviceToken,
			properties: {
				AgentId: this.agent.attrAgentId
			}
		});

		prepareAgent.node.addDependency(this.agent);
		this.agentAlias.node.addDependency(prepareAgent);

		// ===================================
		// Orchestrator Lambda
		// ===================================

		this.orchestratorFunction = new lambda.Function(this, 'Orchestrator', {
			functionName: 'champion-recap-bedrock-orchestrator',
			runtime: lambda.Runtime.PYTHON_3_11,
			handler: 'index.handler',
			code: lambda.Code.fromAsset('../lambda/bedrock-coaching-orchestrator'),
			timeout: cdk.Duration.minutes(9),
			memorySize: 2048,
			tracing: lambda.Tracing.ACTIVE,
			environment: {
				AGENT_ID: this.agent.attrAgentId,
				AGENT_ALIAS_ID: this.agentAlias.attrAgentAliasId,
				MATCH_DATA_BUCKET: props.matchDataBucket.bucketName,
				VOICE_BUCKET: props.voicesBucket.bucketName,
				SESSIONS_TABLE: props.sessionsTable.tableName,
				WEBSOCKET_ENDPOINT: props.websocketEndpoint,
				SAGEMAKER_ENDPOINT: props.sagemakerEndpointName,
				BEDROCK_REGION: region
			},
			logRetention: logs.RetentionDays.ONE_WEEK
		});

		// Grant permissions to orchestrator
		props.matchDataBucket.grantRead(this.orchestratorFunction);
		props.voicesBucket.grantReadWrite(this.orchestratorFunction);
		props.sessionsTable.grantReadWriteData(this.orchestratorFunction);

		// Bedrock Agent invoke permissions
		this.orchestratorFunction.addToRolePolicy(
			new iam.PolicyStatement({
				actions: ['bedrock:InvokeAgent'],
				resources: [this.agentAlias.attrAgentAliasArn]
			})
		);

		// SageMaker invoke permissions
		this.orchestratorFunction.addToRolePolicy(
			new iam.PolicyStatement({
				actions: ['sagemaker:InvokeEndpoint'],
				resources: [
					`arn:aws:sagemaker:${region}:${account}:endpoint/${props.sagemakerEndpointName}`
				]
			})
		);

		// WebSocket post permissions
		this.orchestratorFunction.addToRolePolicy(
			new iam.PolicyStatement({
				actions: ['execute-api:ManageConnections'],
				resources: [`arn:aws:execute-api:${region}:${account}:*/*`]
			})
		);

		// ===================================
		// Outputs
		// ===================================

		new cdk.CfnOutput(this, 'AgentId', {
			value: this.agent.attrAgentId,
			description: 'Bedrock Agent ID'
		});

		new cdk.CfnOutput(this, 'AgentAliasId', {
			value: this.agentAlias.attrAgentAliasId,
			description: 'Bedrock Agent Alias ID'
		});

		new cdk.CfnOutput(this, 'OrchestratorFunctionArn', {
			value: this.orchestratorFunction.functionArn,
			description: 'Bedrock Orchestrator Lambda ARN'
		});
	}
}
