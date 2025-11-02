"""
Bedrock Agent orchestrator for coaching sessions.

This Lambda is invoked by aggregate-stats with ALL match data for a player.
It streams matches to the Bedrock Agent one at a time, allowing the agent
to build context and generate observations throughout the session.

Flow:
1. Receive session_id, summoner_id, top_champion, and match data
2. Create/initialize session in DynamoDB
3. Send welcome message via WebSocket
4. Stream matches to Bedrock Agent using InvokeAgent API
5. Agent calls action groups as it analyzes
6. Return completion status
"""
import os
import json
import uuid
import boto3
from typing import Dict, Any, List
from session_manager import SessionManager, get_session_attributes
from voice_generator import generate_voice
from websocket_client import send_websocket_message

bedrock_agent_runtime = boto3.client('bedrock-agent-runtime')

AGENT_ID = os.environ['AGENT_ID']
AGENT_ALIAS_ID = os.environ['AGENT_ALIAS_ID']


def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Lambda handler for orchestrating Bedrock Agent coaching sessions.

    Event format from aggregate-stats Lambda:
    {
        "session_id": "uuid",
        "summoner_id": "puuid",
        "top_champion": "yasuo",
        "matches": [
            {
                "championName": "Yasuo",
                "kills": 8,
                "deaths": 5,
                "assists": 12,
                ...
            },
            ...
        ],
        "connection_id": "websocket-connection-id" (optional)
    }
    """
    print(f"Orchestrator invoked: {json.dumps(event, default=str)}")

    # Extract event data
    session_id = event.get('session_id') or str(uuid.uuid4())
    summoner_id = event['summoner_id']
    top_champion = event['top_champion']
    matches = event['matches']
    connection_id = event.get('connection_id')

    total_matches = len(matches)

    print(f"Starting coaching session {session_id} for {summoner_id}")
    print(f"Champion personality: {top_champion}")
    print(f"Total matches: {total_matches}")

    # Create session in DynamoDB
    session_manager = SessionManager(session_id)
    session_manager.create_session(
        puuid=summoner_id,
        champion_personality=top_champion,
        total_matches=total_matches,
        connection_id=connection_id
    )

    # Send welcome message with voice
    try:
        welcome_text = get_welcome_message(top_champion)
        voice_result = generate_voice(
            champion_id=top_champion,
            target_text=welcome_text,
            session_id=session_id
        )

        if connection_id:
            send_websocket_message(
                connection_id=connection_id,
                message={
                    'type': 'welcome',
                    'text': welcome_text,
                    'audio_url': voice_result['audio_url'],
                    'champion': top_champion,
                    'total_matches': total_matches
                }
            )
    except Exception as e:
        print(f"Error generating welcome message: {e}")
        # Continue anyway - not critical

    # Invoke Bedrock Agent with streaming matches
    try:
        invoke_bedrock_agent(session_id, matches)

        return {
            'statusCode': 200,
            'body': json.dumps({
                'session_id': session_id,
                'status': 'completed',
                'matches_analyzed': total_matches
            })
        }
    except Exception as e:
        print(f"Error invoking Bedrock Agent: {e}")
        return {
            'statusCode': 500,
            'body': json.dumps({
                'error': str(e)
            })
        }


def invoke_bedrock_agent(session_id: str, matches: List[Dict[str, Any]]) -> None:
    """
    Invoke Bedrock Agent with match data.

    Sends each match as a separate message to the agent, allowing it to
    build context incrementally and generate observations as patterns emerge.
    """
    # Get session attributes for dynamic personality
    session_attributes = get_session_attributes(session_id)

    total_matches = len(matches)

    # Stream matches to agent one at a time
    for index, match in enumerate(matches, start=1):
        match_number = index

        # Prepare match summary for agent
        match_summary = format_match_for_agent(match, match_number, total_matches)

        print(f"Sending match {match_number}/{total_matches} to agent...")

        # Invoke agent with this match
        response = bedrock_agent_runtime.invoke_agent(
            agentId=AGENT_ID,
            agentAliasId=AGENT_ALIAS_ID,
            sessionId=session_id,
            sessionState={
                'sessionAttributes': session_attributes
            },
            inputText=match_summary,
            enableTrace=False
        )

        # Process streaming response
        event_stream = response['completion']
        for event in event_stream:
            if 'chunk' in event:
                chunk = event['chunk']
                chunk_bytes = chunk.get('bytes')
                if chunk_bytes:
                    response_text = chunk_bytes.decode('utf-8')
                    print(f"Agent response: {response_text}")

            elif 'trace' in event:
                # Debug: Agent reasoning trace
                trace = event['trace']
                print(f"Agent trace: {json.dumps(trace, default=str)}")

        print(f"Match {match_number} processed")

    # After all matches, send conclusion prompt
    conclusion_prompt = f"""
All {total_matches} matches have been analyzed. Please generate your concluding remark now.
Call the generateConcludingRemark action with your comprehensive summary.
"""

    response = bedrock_agent_runtime.invoke_agent(
        agentId=AGENT_ID,
        agentAliasId=AGENT_ALIAS_ID,
        sessionId=session_id,
        sessionState={
            'sessionAttributes': session_attributes
        },
        inputText=conclusion_prompt,
        enableTrace=False
    )

    # Process final response
    event_stream = response['completion']
    for event in event_stream:
        if 'chunk' in event:
            chunk = event['chunk']
            chunk_bytes = chunk.get('bytes')
            if chunk_bytes:
                response_text = chunk_bytes.decode('utf-8')
                print(f"Final agent response: {response_text}")

    print(f"Coaching session {session_id} completed")


def format_match_for_agent(match: Dict[str, Any], match_number: int, total_matches: int) -> str:
    """
    Format match data as natural language for the agent.
    """
    champion = match.get('championName', 'Unknown')
    kills = match.get('kills', 0)
    deaths = match.get('deaths', 0)
    assists = match.get('assists', 0)
    cs = match.get('totalMinionsKilled', 0)
    cs_per_min = match.get('csPerMin', 0)
    vision_score = match.get('visionScore', 0)
    win = match.get('win', False)
    position = match.get('position', 'UNKNOWN')

    kda = f"{kills}/{deaths}/{assists}"
    result = "Victory" if win else "Defeat"

    message = f"""
Match {match_number} of {total_matches}:
Champion: {champion}
Position: {position}
Result: {result}
KDA: {kda}
CS: {cs} ({cs_per_min:.1f} per minute)
Vision Score: {vision_score}

Please analyze this match and call the streamMatchData action to record it.
If you notice any patterns, you may optionally call detectPattern and generateQuickRemark actions.
"""

    return message.strip()


def get_welcome_message(champion_id: str) -> str:
    """
    Get welcome message based on champion personality.
    """
    welcome_messages = {
        'yasuo': "The path of the wanderer begins. Let me examine your journey, Summoner.",
        'jinx': "Ooh, time to see what kind of chaos you've been causing! This is gonna be FUN!",
        'thresh': "Another soul arrives for judgment. Let us see what patterns emerge from your battles.",
        'ahri': "Welcome, Summoner. Let's see how gracefully you've been dancing through the Rift.",
        'default': "Greetings, Summoner. Let me analyze your recent matches and provide guidance."
    }

    return welcome_messages.get(champion_id.lower(), welcome_messages['default'])
