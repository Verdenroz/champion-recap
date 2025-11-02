"""
DynamoDB session manager for coaching sessions.

Handles:
- Creating and updating session state
- Tracking matches processed
- Managing session attributes (champion personality)
- TTL-based auto-cleanup
"""
import os
import time
import boto3
from typing import Dict, Any, Optional
from decimal import Decimal

dynamodb = boto3.resource('dynamodb')
SESSIONS_TABLE = os.environ['SESSIONS_TABLE']
table = dynamodb.Table(SESSIONS_TABLE)


class SessionManager:
    """Manage coaching session state in DynamoDB."""

    def __init__(self, session_id: str):
        self.session_id = session_id

    def create_session(
        self,
        puuid: str,
        champion_personality: str,
        total_matches: int,
        connection_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Create a new coaching session.

        Args:
            puuid: Player's PUUID
            champion_personality: Champion to use for personality
            total_matches: Total number of matches to analyze
            connection_id: WebSocket connection ID (optional)

        Returns:
            Session record
        """
        now = int(time.time())
        ttl = now + (24 * 60 * 60)  # 24 hours

        item = {
            'session_id': self.session_id,
            'puuid': puuid,
            'champion_personality': champion_personality,
            'total_matches': total_matches,
            'processed_matches': 0,
            'status': 'active',
            'created_at': now,
            'updated_at': now,
            'ttl': ttl
        }

        if connection_id:
            item['connection_id'] = connection_id

        table.put_item(Item=item)
        return item

    def get_session(self) -> Optional[Dict[str, Any]]:
        """
        Get session record from DynamoDB.

        Returns:
            Session record or None if not found
        """
        response = table.get_item(Key={'session_id': self.session_id})
        return response.get('Item')

    def update_processed_matches(self, match_number: int) -> None:
        """
        Update the count of processed matches.

        Args:
            match_number: Current match number (1-based)
        """
        table.update_item(
            Key={'session_id': self.session_id},
            UpdateExpression='SET processed_matches = :num, updated_at = :now',
            ExpressionAttributeValues={
                ':num': match_number,
                ':now': int(time.time())
            }
        )

    def mark_complete(self) -> None:
        """Mark the session as complete."""
        table.update_item(
            Key={'session_id': self.session_id},
            UpdateExpression='SET #status = :status, updated_at = :now',
            ExpressionAttributeNames={'#status': 'status'},
            ExpressionAttributeValues={
                ':status': 'completed',
                ':now': int(time.time())
            }
        )

    def add_observation(self, observation: Dict[str, Any]) -> None:
        """
        Add an observation to the session's history.

        Args:
            observation: Observation data (match_number, text, type, audio_url)
        """
        table.update_item(
            Key={'session_id': self.session_id},
            UpdateExpression='SET observations = list_append(if_not_exists(observations, :empty_list), :obs), updated_at = :now',
            ExpressionAttributeValues={
                ':obs': [observation],
                ':empty_list': [],
                ':now': int(time.time())
            }
        )

    def clear_connection(self) -> None:
        """
        Clear the WebSocket connection_id from the session.

        This should be called when a GoneException is caught, indicating
        the WebSocket connection is no longer valid.
        """
        table.update_item(
            Key={'session_id': self.session_id},
            UpdateExpression='REMOVE connection_id SET updated_at = :now',
            ExpressionAttributeValues={
                ':now': int(time.time())
            }
        )


def get_session_attributes(session_id: str) -> Dict[str, str]:
    """
    Get session attributes for Bedrock Agent.

    Args:
        session_id: Coaching session ID

    Returns:
        Dict with championPersonality attribute
    """
    session = SessionManager(session_id).get_session()
    if not session:
        return {}

    return {
        'championPersonality': session.get('champion_personality', 'default')
    }
