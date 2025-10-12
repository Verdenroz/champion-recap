#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { ChampionRecapStack } from '../lib/champion-recap-stack';

const app = new cdk.App();

new ChampionRecapStack(app, 'ChampionRecapStack', {
	env: {
		account: process.env.CDK_DEFAULT_ACCOUNT,
		region: process.env.CDK_DEFAULT_REGION || 'us-east-1'
	},
	tags: {
		'rift-rewind-hackathon': '2025'
	}
});
