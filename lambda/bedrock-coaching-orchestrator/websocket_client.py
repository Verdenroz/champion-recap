"""
WebSocket client for sending messages to connected clients.
"""
import os
import json
import boto3
from typing import Dict, Any, Optional
from session_manager import SessionManager

WEBSOCKET_ENDPOINT = os.environ['WEBSOCKET_ENDPOINT']

# Extract API ID and stage from endpoint URL
# Format: https://{api_id}.execute-api.{region}.amazonaws.com/{stage}
endpoint_parts = WEBSOCKET_ENDPOINT.replace('https://', '').replace('wss://', '').split('/')
api_id = endpoint_parts[0].split('.')[0]
stage = endpoint_parts[1] if len(endpoint_parts) > 1 else 'prod'
region = endpoint_parts[0].split('.')[2]

# Create API Gateway Management API client
apigateway_management = boto3.client(
    'apigatewaymanagementapi',
    endpoint_url=f"https://{api_id}.execute-api.{region}.amazonaws.com/{stage}"
)


def send_websocket_message(
    connection_id: str,
    message: Dict[str, Any],
    session_id: Optional[str] = None
) -> None:
    """
    Send a message to a WebSocket connection.

    Args:
        connection_id: WebSocket connection ID
        message: Message data to send
        session_id: Optional session ID for clearing stale connections
    """
    try:
        apigateway_management.post_to_connection(
            ConnectionId=connection_id,
            Data=json.dumps(message).encode('utf-8')
        )
        print(f"Sent WebSocket message to {connection_id}: {message.get('type')}")
    except apigateway_management.exceptions.GoneException:
        print(f"Connection {connection_id} is gone, clearing from session")
        # Clear the stale connection from session if session_id provided
        if session_id:
            try:
                SessionManager(session_id).clear_connection()
                print(f"Cleared stale connection from session {session_id}")
            except Exception as e:
                print(f"Error clearing connection from session: {e}")
    except Exception as e:
        print(f"Error sending WebSocket message: {e}")


def send_error_message(
    connection_id: str,
    error_message: str,
    error_type: str = 'processing_error',
    session_id: Optional[str] = None
) -> None:
    """
    Send an error notification to a WebSocket connection.

    Args:
        connection_id: WebSocket connection ID
        error_message: Human-readable error message
        error_type: Type of error (processing_error, timeout, agent_error, etc.)
        session_id: Optional session ID for clearing stale connections
    """
    message = {
        'type': 'error',
        'error_type': error_type,
        'message': error_message
    }

    send_websocket_message(connection_id, message, session_id)
