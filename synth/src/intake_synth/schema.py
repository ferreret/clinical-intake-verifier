"""Access to the repository-wide field configuration and golden JSON Schema.

Both files live in ``<repo>/schema`` and are shared with the Next.js app. Nothing in the
Python package may hard-code field names: everything goes through this module.
"""

from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path

from jsonschema import Draft202012Validator

FIELDS_FILE = "fields.json"
GOLDEN_SCHEMA_FILE = "golden.schema.json"
PREDICTION_SCHEMA_FILE = "prediction.schema.json"


def schema_dir() -> Path:
    """Locate the ``schema`` directory: ``INTAKE_SCHEMA_DIR`` or walk up from this file."""
    env = os.environ.get("INTAKE_SCHEMA_DIR")
    if env:
        return Path(env)
    for parent in Path(__file__).resolve().parents:
        candidate = parent / "schema" / FIELDS_FILE
        if candidate.exists():
            return candidate.parent
    raise FileNotFoundError(
        "Could not find <repo>/schema/fields.json. Set INTAKE_SCHEMA_DIR to override."
    )


def repo_root() -> Path:
    return schema_dir().parent


@lru_cache(maxsize=1)
def load_fields() -> dict:
    with open(schema_dir() / FIELDS_FILE, encoding="utf-8") as fh:
        return json.load(fh)


def field_names() -> list[str]:
    return [f["name"] for f in load_fields()["fields"]]


def field_spec(name: str) -> dict:
    for f in load_fields()["fields"]:
        if f["name"] == name:
            return f
    raise KeyError(name)


def required_field_names() -> list[str]:
    return [f["name"] for f in load_fields()["fields"] if f["required"]]


@lru_cache(maxsize=1)
def load_golden_schema() -> dict:
    with open(schema_dir() / GOLDEN_SCHEMA_FILE, encoding="utf-8") as fh:
        return json.load(fh)


@lru_cache(maxsize=1)
def load_prediction_schema() -> dict:
    with open(schema_dir() / PREDICTION_SCHEMA_FILE, encoding="utf-8") as fh:
        return json.load(fh)


def _validator(schema: dict) -> Draft202012Validator:
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema)


@lru_cache(maxsize=1)
def golden_validator() -> Draft202012Validator:
    return _validator(load_golden_schema())


@lru_cache(maxsize=1)
def prediction_validator() -> Draft202012Validator:
    return _validator(load_prediction_schema())


def _errors(validator: Draft202012Validator, doc: dict) -> list[str]:
    errors = sorted(validator.iter_errors(doc), key=lambda e: list(e.absolute_path))
    out = []
    for e in errors:
        path = "/".join(str(p) for p in e.absolute_path) or "<root>"
        out.append(f"{path}: {e.message}")
    return out


def validate_golden(doc: dict) -> list[str]:
    """Return a list of human-readable validation errors (empty when valid)."""
    return _errors(golden_validator(), doc)


def validate_prediction(doc: dict) -> list[str]:
    """Validate an extractor prediction against schema/prediction.schema.json."""
    return _errors(prediction_validator(), doc)
