"""shellm web viewer backend."""

import os
from pathlib import Path


def create_app_from_env():
    """App factory for uvicorn --reload (needs an import string)."""
    from shellm_web.server import create_app

    root = Path(os.environ.get("SHELLM_WEB_ROOT", ".")).resolve()
    static = os.environ.get("SHELLM_WEB_STATIC")
    return create_app(root, Path(static) if static else None)


__all__ = ["create_app_from_env"]
