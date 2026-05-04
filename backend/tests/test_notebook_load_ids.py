import os
import sys


sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.routers import notebook_execution


def test_ensure_notebook_cell_ids_preserves_existing_ids_and_backfills_metadata():
    notebook_payload = {
        "cells": [
            {
                "id": "cell-a",
                "cell_type": "code",
                "source": ["print('a')"],
                "metadata": {},
            },
            {
                "metadata": {"inspyro_id": "cell-b"},
                "cell_type": "markdown",
                "source": ["# heading"],
            },
        ],
        "metadata": {},
        "nbformat": 4,
        "nbformat_minor": 5,
    }

    result = notebook_execution._ensure_notebook_cell_ids(notebook_payload)

    assert result["cells"][0]["id"] == "cell-a"
    assert result["cells"][0]["metadata"]["inspyro_id"] == "cell-a"
    assert result["cells"][1]["id"] == "cell-b"
    assert result["cells"][1]["metadata"]["inspyro_id"] == "cell-b"


def test_ensure_notebook_cell_ids_generates_missing_ids_once():
    notebook_payload = {
        "cells": [
            {
                "cell_type": "code",
                "source": ["x = 1"],
                "metadata": {},
            },
            {
                "cell_type": "code",
                "source": ["y = 2"],
                "metadata": None,
            },
        ],
        "metadata": {},
        "nbformat": 4,
        "nbformat_minor": 5,
    }

    result = notebook_execution._ensure_notebook_cell_ids(notebook_payload)

    generated_ids = [cell["id"] for cell in result["cells"]]
    assert all(isinstance(cell_id, str) and cell_id for cell_id in generated_ids)
    assert generated_ids[0] != generated_ids[1]
    assert result["cells"][0]["metadata"]["inspyro_id"] == generated_ids[0]
    assert result["cells"][1]["metadata"]["inspyro_id"] == generated_ids[1]


def test_ensure_notebook_cell_ids_preserves_docx_cell_type():
    notebook_payload = {
        "cells": [
            {
                "id": "cell-docx",
                "cell_type": "docx",
                "source": ["with build_doc() as doc:\n", "    doc.text('x')"],
                "metadata": {},
            },
        ],
        "metadata": {},
        "nbformat": 4,
        "nbformat_minor": 5,
    }

    result = notebook_execution._ensure_notebook_cell_ids(notebook_payload)

    assert result["cells"][0]["cell_type"] == "docx"
    assert result["cells"][0]["id"] == "cell-docx"
    assert result["cells"][0]["metadata"]["inspyro_id"] == "cell-docx"


def test_ensure_notebook_cell_ids_migrates_legacy_docx_source_to_docx_type():
    notebook_payload = {
        "cells": [
            {
                "id": "legacy-docx",
                "cell_type": "code",
                "source": ["with build_doc() as doc:\n", "    doc.text('legacy')"],
                "metadata": {},
            },
        ],
        "metadata": {},
        "nbformat": 4,
        "nbformat_minor": 5,
    }

    result = notebook_execution._ensure_notebook_cell_ids(notebook_payload)

    assert result["cells"][0]["cell_type"] == "docx"
