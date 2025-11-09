"""
Data Dragon utilities for strategic gameplay analysis.
Python equivalents of TypeScript utilities in src/lib/data-dragon.ts
Used by action handlers for generating contextual coaching remarks.
"""

from typing import Any, Dict, Literal, Tuple


# Vision score benchmarks per role (per minute)
VISION_SCORE_BENCHMARKS: Dict[str, Dict[str, float]] = {
    'SUPPORT': {'excellent': 3.5, 'good': 2.5, 'average': 1.8, 'poor': 1.2},
    'JUNGLE': {'excellent': 2.5, 'good': 1.8, 'average': 1.3, 'poor': 0.8},
    'TOP': {'excellent': 1.5, 'good': 1.0, 'average': 0.7, 'poor': 0.4},
    'MIDDLE': {'excellent': 1.5, 'good': 1.0, 'average': 0.7, 'poor': 0.4},
    'BOTTOM': {'excellent': 2.0, 'good': 1.3, 'average': 0.9, 'poor': 0.5}
}

# Damage share benchmarks per role (percentage of team damage)
DAMAGE_SHARE_BENCHMARKS: Dict[str, Dict[str, float]] = {
    'SUPPORT': {'excellent': 0.12, 'good': 0.08, 'average': 0.05, 'poor': 0.03},
    'JUNGLE': {'excellent': 0.22, 'good': 0.18, 'average': 0.14, 'poor': 0.10},
    'TOP': {'excellent': 0.28, 'good': 0.23, 'average': 0.18, 'poor': 0.13},
    'MIDDLE': {'excellent': 0.30, 'good': 0.25, 'average': 0.20, 'poor': 0.15},
    'BOTTOM': {'excellent': 0.32, 'good': 0.27, 'average': 0.22, 'poor': 0.17}
}


def get_vision_score_per_minute(vision_score: int, duration_seconds: int) -> float:
    """
    Calculate vision score per minute.

    Args:
        vision_score: Total vision score from match
        duration_seconds: Match duration in seconds

    Returns:
        Vision score per minute
    """
    duration_minutes = duration_seconds / 60
    return vision_score / duration_minutes if duration_minutes > 0 else 0


def get_vision_score_rating(
    vision_score: int,
    role: str,
    duration_seconds: int
) -> Literal['Excellent', 'Good', 'Average', 'Needs Improvement']:
    """
    Rate vision score performance based on role and duration.

    Args:
        vision_score: Total vision score from match
        role: Player's role (TOP, JUNGLE, MIDDLE, BOTTOM, SUPPORT)
        duration_seconds: Match duration in seconds

    Returns:
        Rating: Excellent, Good, Average, or Needs Improvement
    """
    vision_per_minute = get_vision_score_per_minute(vision_score, duration_seconds)

    normalized_role = role.upper()
    benchmarks = VISION_SCORE_BENCHMARKS.get(normalized_role, VISION_SCORE_BENCHMARKS['MIDDLE'])

    if vision_per_minute >= benchmarks['excellent']:
        return 'Excellent'
    elif vision_per_minute >= benchmarks['good']:
        return 'Good'
    elif vision_per_minute >= benchmarks['average']:
        return 'Average'
    else:
        return 'Needs Improvement'


def get_damage_share_rating(
    team_damage_percentage: float,
    role: str
) -> Literal['Excellent', 'Good', 'Average', 'Needs Improvement']:
    """
    Rate damage contribution based on role expectations.

    Args:
        team_damage_percentage: Percentage of team's total damage (0.0-1.0)
        role: Player's role (TOP, JUNGLE, MIDDLE, BOTTOM, SUPPORT)

    Returns:
        Rating: Excellent, Good, Average, or Needs Improvement
    """
    normalized_role = role.upper()
    benchmarks = DAMAGE_SHARE_BENCHMARKS.get(normalized_role, DAMAGE_SHARE_BENCHMARKS['MIDDLE'])

    if team_damage_percentage >= benchmarks['excellent']:
        return 'Excellent'
    elif team_damage_percentage >= benchmarks['good']:
        return 'Good'
    elif team_damage_percentage >= benchmarks['average']:
        return 'Average'
    else:
        return 'Needs Improvement'


def get_positioning_quality(
    damage_dealt: int,
    damage_taken: int
) -> Tuple[Literal['Excellent', 'Good', 'Fair', 'Risky'], float]:
    """
    Evaluate positioning quality based on damage dealt vs damage taken ratio.
    Higher ratio = better positioning (dealing damage while staying safe).

    Args:
        damage_dealt: Total damage dealt to champions
        damage_taken: Total damage taken

    Returns:
        Tuple of (rating, ratio)
    """
    if damage_taken == 0:
        # Edge case: no damage taken (very rare, likely short game)
        ratio = float('inf') if damage_dealt > 0 else 0
        return ('Excellent', ratio)

    ratio = damage_dealt / damage_taken

    # Positioning benchmarks (damage dealt/taken ratio)
    if ratio >= 1.5:
        return ('Excellent', ratio)
    elif ratio >= 1.0:
        return ('Good', ratio)
    elif ratio >= 0.7:
        return ('Fair', ratio)
    else:
        return ('Risky', ratio)


def get_gold_efficiency(
    gold_earned: int,
    total_minions_killed: int,
    duration_seconds: int
) -> Tuple[Literal['Excellent', 'Good', 'Average', 'Needs Improvement'], float]:
    """
    Assess gold optimization from CS and other sources (kills, objectives).

    Args:
        gold_earned: Total gold earned in match
        total_minions_killed: Total CS (minions + monsters)
        duration_seconds: Match duration in seconds

    Returns:
        Tuple of (rating, gold_per_minute)
    """
    duration_minutes = duration_seconds / 60
    gold_per_minute = gold_earned / duration_minutes if duration_minutes > 0 else 0

    # Gold efficiency benchmarks (gold per minute)
    if gold_per_minute >= 450:
        rating = 'Excellent'
    elif gold_per_minute >= 380:
        rating = 'Good'
    elif gold_per_minute >= 320:
        rating = 'Average'
    else:
        rating = 'Needs Improvement'

    return (rating, gold_per_minute)


def assess_objective_participation(
    dragon_kills: int,
    baron_kills: int,
    turret_kills: int,
    first_blood: bool
) -> Dict[str, Any]:
    """
    Comprehensive objective analysis for strategic coaching.

    Args:
        dragon_kills: Number of dragons participated in
        baron_kills: Number of barons participated in
        turret_kills: Number of turrets destroyed (assists count)
        first_blood: Whether player got first blood

    Returns:
        Dictionary with objective assessment data
    """
    # Dragon priority assessment
    dragon_rating = 'Excellent' if dragon_kills >= 3 else \
                   'Good' if dragon_kills >= 2 else \
                   'Average' if dragon_kills >= 1 else \
                   'Needs Improvement'

    # Baron priority assessment (usually fewer barons than dragons in a game)
    baron_rating = 'Excellent' if baron_kills >= 2 else \
                  'Good' if baron_kills >= 1 else \
                  'Average'  # 0 barons might be fine if game ended early

    # Tower push assessment
    turret_rating = 'Excellent' if turret_kills >= 5 else \
                   'Good' if turret_kills >= 3 else \
                   'Average' if turret_kills >= 1 else \
                   'Needs Improvement'

    # Overall objective priority score (0-100)
    objective_score = 0
    objective_score += min(dragon_kills * 15, 45)  # Up to 45 points from dragons
    objective_score += min(baron_kills * 20, 40)   # Up to 40 points from barons
    objective_score += min(turret_kills * 3, 15)   # Up to 15 points from turrets

    if first_blood:
        objective_score += 10  # Bonus for early pressure

    # Cap at 100
    objective_score = min(objective_score, 100)

    return {
        'dragon_rating': dragon_rating,
        'baron_rating': baron_rating,
        'turret_rating': turret_rating,
        'first_blood': first_blood,
        'objective_score': objective_score,
        'dragon_kills': dragon_kills,
        'baron_kills': baron_kills,
        'turret_kills': turret_kills,
        'priority_assessment': 'High' if objective_score >= 70 else \
                              'Moderate' if objective_score >= 40 else \
                              'Low'
    }
