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
from logger import logger, log_with_context
from session_manager import SessionManager, get_session_attributes
from voice_generator import generate_voice
from websocket_client import send_websocket_message, send_error_message

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
        "last_match_index_sent": 0,  # Index before sending these matches
        "new_last_match_index": 20,  # Index after processing (total matches processed)
        "connection_id": "websocket-connection-id" (optional)
    }
    """
    log_with_context(logger, "info", "Orchestrator invoked", event=json.dumps(event, default=str))

    # Extract event data
    session_id = event.get('session_id') or str(uuid.uuid4())
    summoner_id = event['summoner_id']
    top_champion = event['top_champion']
    matches = event['matches']
    last_match_index_sent = event.get('last_match_index_sent', 0)
    new_last_match_index = event.get('new_last_match_index', len(matches))
    connection_id = event.get('connection_id')

    total_matches = len(matches)

    log_with_context(
        logger,
        "info",
        "Starting coaching session",
        session_id=session_id,
        summoner_id=summoner_id,
        champion_personality=top_champion,
        new_matches=total_matches,
        last_match_index_sent=last_match_index_sent,
        new_last_match_index=new_last_match_index
    )

    # Initialize session manager
    session_manager = SessionManager(session_id)

    # Try to get existing session (WebSocket may have already created it)
    existing_session = session_manager.get_session()

    if existing_session:
        log_with_context(logger, "info", "Found existing session", session_id=session_id)

        # Check session status for resumability
        session_status = existing_session.get('status')

        # Allow resuming from disconnected or failed states
        if session_status in ['disconnected', 'failed']:
            log_with_context(
                logger,
                "info",
                "Resuming session from previous state",
                session_id=session_id,
                previous_status=session_status,
                last_match_index_sent=existing_session.get('last_match_index_sent', 0)
            )
            # Reset status to active for resume
            session_manager.create_session(
                puuid=summoner_id,
                champion_personality=top_champion,
                total_matches=total_matches,
                connection_id=connection_id
            )
        elif session_status == 'completed':
            # Session already completed - log and skip
            log_with_context(
                logger,
                "info",
                "Session already completed, skipping",
                session_id=session_id
            )
            return {
                'statusCode': 200,
                'body': json.dumps({
                    'session_id': session_id,
                    'status': 'already_completed',
                    'message': 'Coaching session was already completed'
                })
            }
        else:
            # Session is active - continue normally
            # Use connection_id from existing session if not provided in event
            if not connection_id and existing_session.get('connection_id'):
                connection_id = existing_session['connection_id']
                log_with_context(logger, "info", "Using connection_id from existing session", connection_id=connection_id)
    else:
        # Create new session
        session_manager.create_session(
            puuid=summoner_id,
            champion_personality=top_champion,
            total_matches=total_matches,
            connection_id=connection_id
        )

    # Note: Welcome message is now sent by WebSocket $connect handler
    # for immediate feedback when the connection is established

    # Invoke Bedrock Agent with streaming matches
    try:
        invoke_bedrock_agent(session_id, matches, last_match_index_sent, new_last_match_index)

        # Update session to track that these matches have been sent
        session_manager.update_last_match_index_sent(new_last_match_index)

        log_with_context(
            logger,
            "info",
            "Coaching session completed successfully",
            session_id=session_id,
            matches_analyzed=total_matches,
            updated_last_match_index=new_last_match_index
        )

        return {
            'statusCode': 200,
            'body': json.dumps({
                'session_id': session_id,
                'status': 'completed',
                'matches_analyzed': total_matches,
                'last_match_index': new_last_match_index
            })
        }
    except Exception as e:
        error_message = str(e)
        logger.error("Error invoking Bedrock Agent", exc_info=True, extra={
            "context": {"session_id": session_id, "total_matches": total_matches}
        })

        # Mark session as failed in DynamoDB
        try:
            session_manager.mark_failed(error_message)
            log_with_context(logger, "info", "Marked session as failed", session_id=session_id)
        except Exception as mark_error:
            logger.error("Failed to mark session as failed", exc_info=True, extra={
                "context": {"session_id": session_id}
            })

        # Send error notification via WebSocket if connection exists
        if connection_id:
            try:
                send_error_message(
                    connection_id=connection_id,
                    error_message=f"Coaching session failed: {error_message}",
                    error_type='agent_error',
                    session_id=session_id
                )
                log_with_context(logger, "info", "Sent error notification to WebSocket",
                    session_id=session_id, connection_id=connection_id)
            except Exception as ws_error:
                logger.error("Failed to send WebSocket error notification", exc_info=True, extra={
                    "context": {"session_id": session_id, "connection_id": connection_id}
                })

        return {
            'statusCode': 500,
            'body': json.dumps({
                'error': error_message,
                'session_id': session_id,
                'status': 'failed'
            })
        }


def invoke_bedrock_agent(
    session_id: str,
    matches: List[Dict[str, Any]],
    last_match_index_sent: int,
    total_matches_cumulative: int
) -> None:
    """
    Invoke Bedrock Agent with match data.

    Sends each match as a separate message to the agent, allowing it to
    build context incrementally and generate observations as patterns emerge.

    Args:
        session_id: Coaching session ID
        matches: List of new matches to send (only matches not previously sent)
        last_match_index_sent: Index of last match sent in previous invocations (0-based)
        total_matches_cumulative: Total number of matches after processing this batch
    """
    # Get session attributes for dynamic personality
    session_attributes = get_session_attributes(session_id)

    # Stream matches to agent one at a time
    # Match numbers are 1-based and start from last_match_index_sent + 1
    for index, match in enumerate(matches, start=1):
        match_number = last_match_index_sent + index

        # Prepare match summary for agent with cumulative total
        match_summary = format_match_for_agent(match, match_number, total_matches_cumulative)

        print(f"Sending match {match_number}/{total_matches_cumulative} to agent...")

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

    # After all matches in this batch, send conclusion prompt if this is the final batch
    # Note: We don't know if more matches will come later, so we prompt for patterns observed so far
    conclusion_prompt = f"""
You have now analyzed {total_matches_cumulative} total matches. Please generate your concluding remark now based on all matches analyzed.
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
    Format match data as natural language for the agent with comprehensive stats.
    Focus on strategic gameplay: objectives, vision control, damage contribution.
    """
    # Basic info
    champion = match.get('championName', 'Unknown')
    kills = match.get('kills', 0)
    deaths = match.get('deaths', 0)
    assists = match.get('assists', 0)
    win = match.get('win', False)
    position = match.get('position', 'UNKNOWN')

    # CS and gold
    cs = match.get('totalMinionsKilled', 0)
    cs_per_min = match.get('csPerMin', 0)
    gold_earned = match.get('goldEarned', 0)

    # Vision control
    vision_score = match.get('visionScore', 0)
    wards_placed = match.get('wardsPlaced', 0)
    wards_killed = match.get('wardsKilled', 0)
    control_wards = match.get('visionWardsBoughtInGame', 0)

    # Combat stats
    damage_dealt = match.get('totalDamageDealtToChampions', 0)
    damage_taken = match.get('totalDamageTaken', 0)
    damage_share = match.get('teamDamagePercentage', 0)

    # Objectives (from challenges or direct fields)
    challenges = match.get('challenges', {})
    baron_kills = challenges.get('baronTakedowns', match.get('baronKills', 0))
    dragon_kills = challenges.get('dragonTakedowns', match.get('dragonKills', 0))
    turret_kills = match.get('turretKills', 0)
    first_blood = match.get('firstBloodKill', False)

    # Strategic coaching fields
    # Early game performance
    lane_cs_10min = match.get('laneMinionsFirst10Minutes')
    jungle_cs_10min = match.get('jungleCsBefore10Minutes')

    # Objective timing
    earliest_dragon = match.get('earliestDragonTakedown')
    earliest_baron = match.get('earliestBaron')
    epic_steals = match.get('epicMonsterSteals', 0)
    elder_kills = match.get('teamElderDragonKills', 0)

    # Vision patterns
    vision_per_min = match.get('visionScorePerMinute')
    control_wards_placed = match.get('controlWardsPlaced')
    wards_guarded = match.get('wardsGuarded', 0)
    stealth_wards = match.get('stealthWardsPlaced')

    # Combat effectiveness
    damage_per_min = match.get('damagePerMinute')
    gold_per_min = match.get('goldPerMinute')
    kill_participation = match.get('killParticipation')
    skillshots_hit = match.get('skillshotsHit')
    skillshots_dodged = match.get('skillshotsDodged')

    # Team fighting
    damage_taken_share = match.get('damageTakenOnTeamPercentage')
    solo_kills = match.get('soloKills', 0)
    multikills = match.get('multikills', 0)

    # Map control
    jungle_kills_early = match.get('junglerKillsEarlyJungle', 0)
    enemy_jungle_kills = match.get('enemyJungleMonsterKills', 0)
    scuttle_kills = match.get('scuttleCrabKills', 0)

    # Format output
    kda = f"{kills}/{deaths}/{assists}"
    result = "Victory" if win else "Defeat"

    # Build early game section
    early_game_section = "Early Game (0-10 min):\n"
    if lane_cs_10min is not None:
        early_game_section += f"- Lane CS at 10min: {lane_cs_10min}\n"
    if jungle_cs_10min is not None:
        early_game_section += f"- Jungle CS at 10min: {jungle_cs_10min}\n"
    if jungle_kills_early > 0:
        early_game_section += f"- Early Jungle Kills: {jungle_kills_early}\n"

    # Build objective timing section
    objective_timing = ""
    if earliest_dragon is not None:
        objective_timing += f"- First Dragon: {earliest_dragon/60:.1f} min\n"
    if earliest_baron is not None:
        objective_timing += f"- First Baron: {earliest_baron/60:.1f} min\n"
    if epic_steals > 0:
        objective_timing += f"- Epic Monster Steals: {epic_steals}\n"

    # Build vision patterns section
    vision_patterns = ""
    if vision_per_min is not None:
        vision_patterns += f"- Vision Score/min: {vision_per_min:.2f}\n"
    if control_wards_placed is not None:
        vision_patterns += f"- Control Wards Placed: {control_wards_placed}\n"
    if wards_guarded > 0:
        vision_patterns += f"- Wards Guarded: {wards_guarded}\n"

    # Build combat effectiveness section
    combat_effectiveness = ""
    if damage_per_min is not None:
        combat_effectiveness += f"- Damage/min: {damage_per_min:.0f}\n"
    if gold_per_min is not None:
        combat_effectiveness += f"- Gold/min: {gold_per_min:.0f}\n"
    if kill_participation is not None:
        combat_effectiveness += f"- Kill Participation: {kill_participation:.1%}\n"
    if skillshots_hit is not None and skillshots_dodged is not None:
        combat_effectiveness += f"- Skillshots: {skillshots_hit} hit, {skillshots_dodged} dodged\n"
    if solo_kills > 0:
        combat_effectiveness += f"- Solo Kills: {solo_kills}\n"

    # Build map control section
    map_control = ""
    if enemy_jungle_kills > 0:
        map_control += f"- Enemy Jungle CS: {enemy_jungle_kills}\n"
    if scuttle_kills > 0:
        map_control += f"- Scuttle Crabs: {scuttle_kills}\n"

    message = f"""
Match {match_number} of {total_matches}:
Champion: {champion}
Position: {position}
Result: {result}

{early_game_section if lane_cs_10min or jungle_cs_10min or jungle_kills_early else ""}
Combat:
- KDA: {kda}
- Damage to Champions: {damage_dealt:,}
- Damage Taken: {damage_taken:,}
- Team Damage Share: {damage_share:.1%}
{damage_taken_share is not None and f"- Damage Taken Share: {damage_taken_share:.1%}\n" or ""}
{combat_effectiveness}

Economy:
- CS: {cs} ({cs_per_min:.1f}/min)
- Gold Earned: {gold_earned:,}

Objectives:
- Dragons: {dragon_kills}{elder_kills > 0 and f" (including {elder_kills} Elder)" or ""}
- Barons: {baron_kills}
- Turrets: {turret_kills}
- First Blood: {"Yes" if first_blood else "No"}
{objective_timing}

Vision Control:
- Vision Score: {vision_score}
- Wards Placed: {wards_placed}
- Wards Destroyed: {wards_killed}
- Control Wards: {control_wards}
{vision_patterns}
{map_control and f"\nMap Control:\n{map_control}" or ""}

Please analyze this match for patterns in:
1. Early game performance (CS@10, jungle control)
2. Vision control efficiency (vision score/min, control ward usage)
3. Objective priority and timing (first dragon/baron timing)
4. Combat effectiveness (kill participation, damage output/taken ratio, skillshot accuracy)
5. Map control (enemy jungle invades, scuttle control)

Call streamMatchData to record it, and consider detectPattern/generateQuickRemark if you notice trends across matches.
"""

    return message.strip()


