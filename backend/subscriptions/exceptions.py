"""Turn integration failures into clean JSON errors instead of HTML 500 pages."""

import logging

from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_exception_handler

from .integrations.http import IntegrationError

logger = logging.getLogger(__name__)


def exception_handler(exc, context):
    response = drf_exception_handler(exc, context)
    if response is not None:
        return response
    if isinstance(exc, IntegrationError):
        logger.warning("Integration error in %s: %s", context.get("view"), exc)
        return Response({"detail": str(exc), "service": exc.service}, status=502)
    return None
