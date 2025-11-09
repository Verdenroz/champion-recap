"""
Bedrock Agent action handler for coaching action groups.

Handles 4 action groups:
1. streamMatchData - Record each match in session memory
2. detectPattern - Analyze patterns across matches
3. generateQuickRemark - Generate short voice observation (20-30 words)
4. generateConcludingRemark - Generate comprehensive final summary (80-100 words)
"""
import os
import json
import boto3
from botocore.exceptions import ClientError
from typing import Dict, Any
from session_manager import SessionManager
from voice_generator import generate_voice
from websocket_client import send_websocket_message

apigateway_management = boto3.client('apigatewaymanagementapi')


def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Lambda handler for Bedrock Agent action group callbacks.

    Event format from Bedrock Agent:
    {
        "messageVersion": "1.0",
        "agent": {...},
        "sessionId": "...",
        "sessionAttributes": {...},
        "promptSessionAttributes": {...},
        "inputText": "...",
        "actionGroup": "StreamMatchData",
        "apiPath": "/streamMatchData",
        "httpMethod": "POST",
        "parameters": [...]
    }
    """
    print(f"Action handler event: {json.dumps(event, default=str)}")

    action_group = event.get('actionGroup')
    function = event.get('function')
    parameters = {p['name']: p['value'] for p in event.get('parameters', [])}

    # Extract session context
    session_id = event.get('sessionId')
    session_attributes = event.get('sessionAttributes', {})

    # Route to appropriate action handler
    if action_group == 'StreamMatchData' or function == 'streamMatchData':
        return handle_stream_match_data(session_id, parameters)

    elif action_group == 'DetectPattern' or function == 'detectPattern':
        return handle_detect_pattern(session_id, parameters)

    elif action_group == 'GenerateQuickRemark' or function == 'generateQuickRemark':
        return handle_generate_quick_remark(session_id, session_attributes, parameters)

    elif action_group == 'GenerateConcludingRemark' or function == 'generateConcludingRemark':
        return handle_generate_concluding_remark(session_id, session_attributes, parameters)

    else:
        return create_error_response(f"Unknown action group: {action_group}")


def handle_stream_match_data(session_id: str, params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Action: streamMatchData
    Record a match in session memory and update progress.
    """
    match_number = int(params['matchNumber'])
    total_matches = int(params['totalMatches'])

    # Update session progress
    session_manager = SessionManager(session_id)
    session_manager.update_processed_matches(match_number)

    # Return confirmation to agent
    response_body = {
        'match_recorded': True,
        'progress': f"{match_number}/{total_matches}",
        'message': f"Match {match_number} recorded successfully"
    }

    return create_success_response(response_body)


def handle_detect_pattern(session_id: str, params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Action: detectPattern
    Acknowledge pattern detection.
    """
    pattern_type = params['patternType']
    matches_in_pattern = params.get('matchesInPattern', 0)

    response_body = {
        'pattern_detected': True,
        'pattern_type': pattern_type,
        'matches_affected': matches_in_pattern,
        'message': f"Pattern '{pattern_type}' detected across {matches_in_pattern} matches"
    }

    return create_success_response(response_body)


def handle_generate_quick_remark(
    session_id: str,
    session_attributes: Dict[str, str],
    params: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Action: generateQuickRemark
    Generate short voice observation (20-30 words) when pattern is spotted.
    """
    remark_text = params['remarkText']
    remark_type = params['remarkType']
    match_number = int(params.get('matchNumber', 0))

    # Get champion personality from session attributes
    champion_id = session_attributes.get('championPersonality', 'default')

    # Log champion usage for voice generation tracking
    if not champion_id or champion_id == 'default':
        print(f"WARNING: Using default champion voice (session has no personality set)")

    print(f"Generating quick remark for champion '{champion_id}': {remark_text[:50]}...")

    # Generate voice using SageMaker (will fallback to 'default' if champion voice not found)
    try:
        voice_result = generate_voice(
            champion_id=champion_id,
            target_text=remark_text,
            session_id=session_id
        )

        audio_url = voice_result['audio_url']

        # Save observation to session
        session_manager = SessionManager(session_id)
        observation = {
            'type': 'quick_remark',
            'match_number': match_number,
            'text': remark_text,
            'remark_type': remark_type,
            'audio_url': audio_url,
            'champion': champion_id
        }
        session_manager.add_observation(observation)

        # Send to WebSocket if connection available
        session = session_manager.get_session()
        if session and session.get('connection_id'):
            send_websocket_message(
                connection_id=session['connection_id'],
                message={
                    'type': 'quick_remark',
                    'match_number': match_number,
                    'text': remark_text,
                    'audio_url': audio_url,
                    'champion': champion_id
                },
                session_id=session_id
            )

        response_body = {
            'remark_generated': True,
            'audio_url': audio_url,
            'message': f"Quick remark generated: {remark_text[:30]}..."
        }

        return create_success_response(response_body)

    except ClientError as e:
        error_code = e.response['Error']['Code']
        error_message = e.response['Error']['Message']
        print(f"AWS ClientError generating quick remark: {error_code} - {error_message}")

        # Handle specific AWS errors
        if error_code == 'ThrottlingException':
            return create_error_response("Voice generation throttled. Please retry.")
        elif error_code == 'ValidationException':
            return create_error_response(f"Invalid parameters: {error_message}")
        elif error_code == 'ModelNotReadyException':
            return create_error_response("SageMaker model is loading. Please retry.")
        else:
            return create_error_response(f"AWS error: {error_code}")

    except Exception as e:
        # Catch-all for unexpected errors
        print(f"Unexpected error generating quick remark: {type(e).__name__}: {e}")
        return create_error_response(f"Internal error: {type(e).__name__}")


def handle_generate_concluding_remark(
    session_id: str,
    session_attributes: Dict[str, str],
    params: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Action: generateConcludingRemark
    Generate comprehensive final summary (80-100 words) with voice.
    """
    conclusion_text = params['conclusionText']
    key_strengths = params.get('keyStrengths', [])
    key_weaknesses = params.get('keyWeaknesses', [])
    average_kda = params.get('averageKDA')
    win_rate = params.get('winRate')

    # Get champion personality from session attributes
    champion_id = session_attributes.get('championPersonality', 'default')

    # Log champion usage for voice generation tracking
    if not champion_id or champion_id == 'default':
        print(f"WARNING: Using default champion voice (session has no personality set)")

    print(f"Generating concluding remark for champion '{champion_id}': {conclusion_text[:50]}...")

    # Generate voice using SageMaker (will fallback to 'default' if champion voice not found)
    try:
        voice_result = generate_voice(
            champion_id=champion_id,
            target_text=conclusion_text,
            session_id=session_id
        )

        audio_url = voice_result['audio_url']

        # Save observation to session
        session_manager = SessionManager(session_id)
        observation = {
            'type': 'conclusion',
            'text': conclusion_text,
            'audio_url': audio_url,
            'champion': champion_id,
            'key_strengths': key_strengths,
            'key_weaknesses': key_weaknesses,
            'average_kda': average_kda,
            'win_rate': win_rate
        }
        session_manager.add_observation(observation)

        # Mark session as complete
        session_manager.mark_complete()

        # Send to WebSocket if connection available
        session = session_manager.get_session()
        if session and session.get('connection_id'):
            send_websocket_message(
                connection_id=session['connection_id'],
                message={
                    'type': 'conclusion',
                    'text': conclusion_text,
                    'audio_url': audio_url,
                    'champion': champion_id,
                    'key_strengths': key_strengths,
                    'key_weaknesses': key_weaknesses,
                    'average_kda': average_kda,
                    'win_rate': win_rate
                },
                session_id=session_id
            )

        response_body = {
            'conclusion_generated': True,
            'audio_url': audio_url,
            'session_complete': True,
            'message': "Coaching session concluded successfully"
        }

        return create_success_response(response_body)

    except ClientError as e:
        error_code = e.response['Error']['Code']
        error_message = e.response['Error']['Message']
        print(f"AWS ClientError generating conclusion: {error_code} - {error_message}")

        # Handle specific AWS errors
        if error_code == 'ThrottlingException':
            return create_error_response("Voice generation throttled. Please retry.")
        elif error_code == 'ValidationException':
            return create_error_response(f"Invalid parameters: {error_message}")
        elif error_code == 'ModelNotReadyException':
            return create_error_response("SageMaker model is loading. Please retry.")
        else:
            return create_error_response(f"AWS error: {error_code}")

    except Exception as e:
        # Catch-all for unexpected errors
        print(f"Unexpected error generating conclusion: {type(e).__name__}: {e}")
        return create_error_response(f"Internal error: {type(e).__name__}")


def create_success_response(body: Dict[str, Any]) -> Dict[str, Any]:
    """Create a successful action response for Bedrock Agent."""
    return {
        'messageVersion': '1.0',
        'response': {
            'actionGroup': 'success',
            'apiPath': '/',
            'httpMethod': 'POST',
            'httpStatusCode': 200,
            'responseBody': {
                'application/json': {
                    'body': json.dumps(body)
                }
            }
        }
    }


def create_error_response(error_message: str) -> Dict[str, Any]:
    """Create an error response for Bedrock Agent."""
    return {
        'messageVersion': '1.0',
        'response': {
            'actionGroup': 'error',
            'apiPath': '/',
            'httpMethod': 'POST',
            'httpStatusCode': 500,
            'responseBody': {
                'application/json': {
                    'body': json.dumps({'error': error_message})
                }
            }
        }
    }
