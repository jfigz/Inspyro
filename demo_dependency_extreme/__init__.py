"""Extreme dependency analyzer demo package.

The package is intentionally static and verbose so the dependency analyzer can
see imports, reexports, class scopes, instance attributes, and long call chains.
"""

from .facade import *  # noqa: F401,F403

