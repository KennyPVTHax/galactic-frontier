"""
REFERENCE ONLY — not wired into OrbitBtc's production backend.

A standalone FastAPI router showing the server side of Galactic Frontier's
mission-completion contract. Copy into the OrbitBtc backend and adapt:
  * replace `get_current_user` with OrbitBtc's real auth dependency,
  * replace the in-memory stores with the real database,
  * implement `decide_reward` according to rules OrbitBtc approves.

Principles:
  * The game client never grants Orbit Coins. It only reports evidence.
  * Run ids are issued by the server, single-use, and bound to the user.
  * Completion reports are validated for plausibility and are idempotent.
  * No economic rates or token amounts are defined here.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import time
from typing import Literal, Optional
from urllib.parse import parse_qsl

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field

router = APIRouter(prefix="/galactic-frontier", tags=["galactic-frontier"])

INTRO_MISSION_ID = "intro_first_light_v1"
# Plausibility floor: a real playthrough takes minutes, not seconds.
MIN_MISSION_SECONDS = 120
MAX_MISSION_SECONDS = 7 * 24 * 3600
REQUIRED_SAMPLES = {"lumenite": 40, "ferrite": 30}


# --------------------------------------------------------------------- auth

class User(BaseModel):
    id: str


def verify_telegram_init_data(init_data: str, bot_token: str, max_age_s: int = 86400) -> dict:
    """Validates Telegram Mini App initData (HMAC-SHA256, per Telegram docs)."""
    pairs = dict(parse_qsl(init_data, keep_blank_values=True))
    received_hash = pairs.pop("hash", None)
    if not received_hash:
        raise HTTPException(401, "missing hash")
    check_string = "\n".join(f"{k}={v}" for k, v in sorted(pairs.items()))
    secret = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    expected = hmac.new(secret, check_string.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, received_hash):
        raise HTTPException(401, "bad signature")
    if time.time() - int(pairs.get("auth_date", "0")) > max_age_s:
        raise HTTPException(401, "initData expired")
    return json.loads(pairs.get("user", "{}"))


async def get_current_user(
    authorization: Optional[str] = Header(default=None),
    x_telegram_init_data: Optional[str] = Header(default=None),
) -> User:
    """PLACEHOLDER: swap for OrbitBtc's existing auth dependency."""
    if x_telegram_init_data:
        bot_token = os.environ.get("TELEGRAM_BOT_TOKEN", "")
        if not bot_token:
            raise HTTPException(500, "TELEGRAM_BOT_TOKEN not configured")
        tg_user = verify_telegram_init_data(x_telegram_init_data, bot_token)
        return User(id=f"tg:{tg_user.get('id')}")
    if authorization and authorization.startswith("Bearer "):
        raise HTTPException(501, "wire OrbitBtc session/JWT validation here")
    raise HTTPException(401, "not authenticated")


# --------------------------------------------------------------------- storage (replace with DB)

RUNS: dict[str, dict] = {}        # run_id -> {user_id, mission_id, issued_at, completed}
COMPLETIONS: dict[str, dict] = {}  # run_id -> stored result (idempotency)
SAVES: dict[tuple[str, str], dict] = {}


# --------------------------------------------------------------------- schemas

class StartRequest(BaseModel):
    missionId: str
    clientVersion: str = ""


class StartResponse(BaseModel):
    runId: str
    serverTime: int


class Telemetry(BaseModel):
    distanceOnFootM: float = Field(ge=0, le=1_000_000)
    distanceFlownM: float = Field(ge=0, le=10_000_000)
    scans: int = Field(ge=0, le=100_000)
    collected: dict[str, float]


class CompletionReport(BaseModel):
    missionId: str
    runId: str
    idempotencyKey: str
    clientStartedAt: int
    clientCompletedAt: int
    stepCompletedAt: dict[str, int]
    telemetry: Telemetry
    clientVersion: str


class SubmissionResult(BaseModel):
    status: Literal["accepted", "pending_review", "rejected"]
    message: str


# --------------------------------------------------------------------- endpoints

@router.post("/missions/start", response_model=StartResponse)
async def start_mission(body: StartRequest, user: User = Depends(get_current_user)):
    if body.missionId != INTRO_MISSION_ID:
        raise HTTPException(400, "unknown mission")
    run_id = secrets.token_urlsafe(18)
    RUNS[run_id] = {"user_id": user.id, "mission_id": body.missionId, "issued_at": time.time(), "completed": False}
    return StartResponse(runId=run_id, serverTime=int(time.time() * 1000))


@router.post("/missions/complete", response_model=SubmissionResult)
async def complete_mission(report: CompletionReport, user: User = Depends(get_current_user)):
    # Idempotent: a retried report gets the original answer.
    if report.runId in COMPLETIONS:
        return COMPLETIONS[report.runId]

    run = RUNS.get(report.runId)
    if not run or run["user_id"] != user.id or run["mission_id"] != report.missionId:
        raise HTTPException(409, "unknown run")
    if run["completed"]:
        raise HTTPException(409, "run already completed")

    # Timing is measured on the SERVER clock from when the run id was issued.
    elapsed = time.time() - run["issued_at"]
    problems = []
    if elapsed < MIN_MISSION_SECONDS:
        problems.append("too fast")
    if elapsed > MAX_MISSION_SECONDS:
        problems.append("run expired")
    for res, need in REQUIRED_SAMPLES.items():
        if report.telemetry.collected.get(res, 0) < need:
            problems.append(f"missing {res}")
    if report.telemetry.scans < 1:
        problems.append("no scan")

    run["completed"] = True
    if problems:
        result = SubmissionResult(status="rejected", message="Expedition report could not be verified.")
    else:
        result = decide_reward(user, report)
    COMPLETIONS[report.runId] = result.model_dump()
    return result


def decide_reward(user: User, report: CompletionReport) -> SubmissionResult:
    """
    OrbitBtc must define this. Intentionally contains NO coin amounts or rates.
    Typical options: queue for review, grant an off-chain badge, or credit a
    server-side ledger entry under rules approved by OrbitBtc. Whatever is
    chosen, the message returned here is the only thing the game displays.
    """
    return SubmissionResult(status="pending_review", message="Expedition verified. Any reward is pending OrbitBtc review.")


# --------------------------------------------------------------------- optional cloud saves

@router.get("/saves/{slot}")
async def load_save(slot: str, user: User = Depends(get_current_user)):
    return {"data": SAVES.get((user.id, slot))}


@router.put("/saves/{slot}")
async def store_save(slot: str, body: dict, user: User = Depends(get_current_user)):
    data = body.get("data")
    if not isinstance(data, dict) or len(json.dumps(data)) > 256_000:
        raise HTTPException(400, "invalid save")
    # Save data is untrusted player state. Never read balances from it.
    SAVES[(user.id, slot)] = data
    return {"ok": True}
