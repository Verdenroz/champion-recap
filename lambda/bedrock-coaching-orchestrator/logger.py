"""
Structured logging utility for Python Lambda functions.

AWS Best Practice: Use JSON-formatted logs for CloudWatch Insights queries.
https://docs.aws.amazon.com/lambda/latest/dg/python-logging.html
"""
import json
import logging
import sys
from datetime import datetime
from typing import Any, Dict, Optional


class JSONFormatter(logging.Formatter):
    """
    Custom JSON formatter for structured logging.
    Outputs logs in JSON format compatible with CloudWatch Insights.
    """

    def format(self, record: logging.LogRecord) -> str:
        log_data: Dict[str, Any] = {
            "level": record.levelname,
            "message": record.getMessage(),
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "logger": record.name,
            "function": record.funcName,
            "line": record.lineno,
        }

        # Add extra context if provided
        if hasattr(record, "context"):
            log_data.update(record.context)

        # Add exception info if present
        if record.exc_info:
            log_data["exception"] = {
                "type": record.exc_info[0].__name__,
                "message": str(record.exc_info[1]),
                "traceback": self.formatException(record.exc_info),
            }

        return json.dumps(log_data)


def get_logger(name: str = __name__, level: str = "INFO") -> logging.Logger:
    """
    Get a configured logger with JSON formatting.

    Args:
        name: Logger name (defaults to module name)
        level: Log level (DEBUG, INFO, WARNING, ERROR, CRITICAL)

    Returns:
        Configured logger instance
    """
    logger = logging.getLogger(name)

    # Avoid adding handlers multiple times (Lambda container reuse)
    if not logger.handlers:
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(JSONFormatter())
        logger.addHandler(handler)

    # Set log level from environment or parameter
    log_level = logging.getLevelName(level)
    logger.setLevel(log_level)

    # Prevent propagation to root logger
    logger.propagate = False

    return logger


def log_with_context(logger: logging.Logger, level: str, message: str, **context):
    """
    Log a message with additional context.

    Args:
        logger: Logger instance
        level: Log level (info, warning, error, debug)
        message: Log message
        **context: Additional context as keyword arguments
    """
    log_method = getattr(logger, level.lower())

    # Create a LogRecord with context
    extra = {"context": context}
    log_method(message, extra=extra)


# Create default logger for the module
logger = get_logger("bedrock-coaching-orchestrator")
