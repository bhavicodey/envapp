"""Saved data: watched places and saved readings, kept in data/saved.json on this computer.

The browser also keeps a copy (localStorage), so the app still works if this file can't be written.
"""
import json
import os
import threading
import time
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from . import config

router = APIRouter(prefix="/api/saved")
FILE = config.DATA_DIR / "saved.json"
_lock = threading.Lock()


class Place(BaseModel):
    id: str = Field(..., max_length=40)
    name: str = Field(..., max_length=200)
    lat: float = Field(..., ge=-90, le=90)
    lon: float = Field(..., ge=-180, le=180)
    radius: int = Field(150, ge=5, le=300)
    poly: Optional[List[List[float]]] = None
    added: Optional[str] = Field(None, max_length=40)


class Reading(BaseModel):
    id: str = Field(..., max_length=40)
    name: str = Field(..., max_length=200)
    saved_at: str = Field(..., max_length=40)
    date: str = Field(..., max_length=10)
    sensor: str = Field(..., max_length=12)
    lat: float = Field(..., ge=-90, le=90)
    lon: float = Field(..., ge=-180, le=180)
    radius: int = Field(150, ge=5, le=300)
    poly: Optional[List[List[float]]] = None
    values: dict = Field(default_factory=dict)
    so2_series: list = Field(default_factory=list)
    note: Optional[str] = Field(None, max_length=500)


class Saved(BaseModel):
    places: List[Place] = Field(default_factory=list, max_length=200)
    readings: List[Reading] = Field(default_factory=list, max_length=500)


def _read() -> dict:
    try:
        data = json.loads(FILE.read_text(encoding="utf-8"))
        return {"places": data.get("places", []), "readings": data.get("readings", []),
                "updated": data.get("updated")}
    except (OSError, ValueError):
        return {"places": [], "readings": [], "updated": None}


@router.get("")
def get_saved():
    with _lock:
        return _read()


@router.put("")
def put_saved(body: Saved):
    data = {"places": [p.model_dump() for p in body.places],
            "readings": [r.model_dump() for r in body.readings],
            "updated": time.strftime("%Y-%m-%dT%H:%M:%S")}
    with _lock:
        try:
            FILE.parent.mkdir(exist_ok=True)
            tmp = FILE.with_suffix(".tmp")
            tmp.write_text(json.dumps(data, indent=1), encoding="utf-8")
            os.replace(tmp, FILE)
        except OSError as exc:
            raise HTTPException(500, f"Couldn't write {FILE.name}: {exc}") from exc
    return {"ok": True, "updated": data["updated"], "file": str(FILE)}
