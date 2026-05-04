"""
Routers package.

This package contains the modular routers for the Inspyro backend API.
"""

from .files import router as files_router

__all__ = ["files_router"]
