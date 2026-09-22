from __future__ import annotations

import copy
import os
import secrets
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, Field

try:
    from pymongo import MongoClient
except ImportError:  # pragma: no cover - dependency is installed in deployment
    MongoClient = None  # type: ignore[assignment,misc]


BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = BASE_DIR / "static"
TEMPLATES_DIR = BASE_DIR / "templates"
MAX_DATA_URL_LENGTH = 5_000_000


QUESTIONS: list[dict[str, Any]] = [
    {
        "code": "has_diabetes",
        "label": "Possui diabetes?",
        "helper": "Inclua qualquer tipo de diabetes diagnosticado.",
        "required": True,
        "priority": "high",
    },
    {
        "code": "uses_anticoagulants",
        "label": "Usa anticoagulantes?",
        "helper": "Considere medicamentos de uso contínuo ou temporário.",
        "required": True,
        "priority": "high",
    },
    {
        "code": "has_keloid_tendency",
        "label": "Tem tendência a queloide?",
        "helper": "Considere histórico pessoal ou familiar.",
        "required": True,
        "priority": "high",
    },
    {
        "code": "has_allergy",
        "label": "Possui alergias conhecidas?",
        "helper": "Pode incluir alergia a pigmentos, metais, cosméticos ou medicamentos.",
        "required": True,
        "priority": "medium",
    },
    {
        "code": "uses_continuous_medication",
        "label": "Usa medicação contínua?",
        "helper": "Informe ao profissional mesmo que a medicação não pareça relacionada ao procedimento.",
        "required": True,
        "priority": "medium",
    },
    {
        "code": "has_skin_injury",
        "label": "Há machucado, queimadura ou irritação na área?",
        "helper": "A foto da pele será vinculada à região selecionada.",
        "required": True,
        "priority": "high",
    },
]

RULES: list[dict[str, Any]] = [
    {
        "code": "health-diabetes",
        "question": "has_diabetes",
        "severity": "critical",
        "title": "Diabetes informado",
        "message": "Avaliar condições de saúde e cicatrização antes de iniciar.",
    },
    {
        "code": "health-anticoagulants",
        "question": "uses_anticoagulants",
        "severity": "critical",
        "title": "Uso de anticoagulantes informado",
        "message": "Revisar o uso do medicamento e a política do procedimento.",
    },
    {
        "code": "health-keloid",
        "question": "has_keloid_tendency",
        "severity": "critical",
        "title": "Tendência a queloide informada",
        "message": "Avaliar histórico e risco de cicatrização antes de iniciar.",
    },
    {
        "code": "health-skin-injury",
        "question": "has_skin_injury",
        "severity": "critical",
        "title": "Alteração na pele informada",
        "message": "Conferir a foto e a região selecionada antes do procedimento.",
    },
    {
        "code": "health-allergy",
        "question": "has_allergy",
        "severity": "warning",
        "title": "Alergia informada",
        "message": "Confirmar substância e reação relatada pelo cliente.",
    },
    {
        "code": "health-medication",
        "question": "uses_continuous_medication",
        "severity": "review",
        "title": "Medicação contínua informada",
        "message": "Solicitar os detalhes necessários para a avaliação profissional.",
    },
]

BODY_REGIONS: list[dict[str, Any]] = [
    {"id": "head", "label": "Cabeça", "view": "front", "x": 132, "y": 12, "w": 56, "h": 48},
    {"id": "neck", "label": "Pescoço", "view": "front", "x": 140, "y": 58, "w": 40, "h": 28},
    {"id": "chest", "label": "Peito", "view": "front", "x": 112, "y": 88, "w": 96, "h": 72},
    {"id": "abdomen", "label": "Abdômen", "view": "front", "x": 118, "y": 158, "w": 84, "h": 72},
    {"id": "left_arm", "label": "Braço esquerdo", "view": "front", "x": 66, "y": 88, "w": 42, "h": 126},
    {"id": "right_arm", "label": "Braço direito", "view": "front", "x": 206, "y": 88, "w": 42, "h": 126},
    {"id": "left_thigh", "label": "Coxa esquerda", "view": "front", "x": 116, "y": 230, "w": 42, "h": 130},
    {"id": "right_thigh", "label": "Coxa direita", "view": "front", "x": 162, "y": 230, "w": 42, "h": 130},
    {"id": "left_leg", "label": "Perna esquerda", "view": "front", "x": 116, "y": 360, "w": 42, "h": 150},
    {"id": "right_leg", "label": "Perna direita", "view": "front", "x": 162, "y": 360, "w": 42, "h": 150},
    {"id": "upper_back", "label": "Parte superior das costas", "view": "back", "x": 112, "y": 88, "w": 96, "h": 90},
    {"id": "lower_back", "label": "Lombar", "view": "back", "x": 118, "y": 178, "w": 84, "h": 60},
    {"id": "left_shoulder_back", "label": "Ombro esquerdo", "view": "back", "x": 66, "y": 88, "w": 48, "h": 78},
    {"id": "right_shoulder_back", "label": "Ombro direito", "view": "back", "x": 202, "y": 88, "w": 48, "h": 78},
    {"id": "left_glute", "label": "Glúteo esquerdo", "view": "back", "x": 116, "y": 238, "w": 42, "h": 76},
    {"id": "right_glute", "label": "Glúteo direito", "view": "back", "x": 162, "y": 238, "w": 42, "h": 76},
]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def empty_session(session_id: str, client_name: str = "") -> dict[str, Any]:
    return {
        "_id": session_id,
        "studioId": "studio-demo",
        "client": {"name": client_name, "contact": "", "service": "Tatuagem"},
        "status": "waiting_client",
        "consentStatus": "pending",
        "alertStatus": "none",
        "answers": {},
        "bodyMap": [],
        "skinPhotos": [],
        "document": None,
        "signature": None,
        "termsAccepted": False,
        "termsVersion": "v1.0",
        "rulesVersion": "2026.09",
        "alert": None,
        "createdAt": now_iso(),
        "updatedAt": now_iso(),
        "audit": [],
    }


class ClientData(BaseModel):
    name: str = ""
    contact: str = ""
    service: str = "Tatuagem"


class DraftPayload(BaseModel):
    client: ClientData | None = None
    answers: dict[str, str] = Field(default_factory=dict)
    bodyMap: list[dict[str, Any]] = Field(default_factory=list)
    skinPhotos: list[dict[str, Any]] = Field(default_factory=list)
    document: dict[str, Any] | None = None
    signature: str | None = None
    termsAccepted: bool = False


class NewSessionPayload(BaseModel):
    clientName: str = ""
    service: str = "Tatuagem"


class AlertActionPayload(BaseModel):
    action: str
    note: str = ""


class SessionStore:
    def __init__(self) -> None:
        self.memory: dict[str, dict[str, Any]] = {}
        self.mongo = None
        uri = os.getenv("MONGO_URI", "mongodb://127.0.0.1:27017").strip()
        if uri and MongoClient is not None:
            try:
                client = MongoClient(uri, serverSelectionTimeoutMS=1200)
                client.admin.command("ping")
                self.mongo = client[os.getenv("MONGO_DB", "anamnese_visual")]
            except Exception:
                self.mongo = None
        self.seed_demo()

    def seed_demo(self) -> None:
        if self.get("demo") is None:
            demo = empty_session("demo", "Marina Costa")
            demo["client"]["contact"] = "marina@email.com"
            self.save(demo)

    def get(self, session_id: str) -> dict[str, Any] | None:
        if self.mongo is not None:
            record = self.mongo.sessions.find_one({"_id": session_id})
            return copy.deepcopy(record) if record else None
        record = self.memory.get(session_id)
        return copy.deepcopy(record) if record else None

    def save(self, session: dict[str, Any]) -> None:
        if self.mongo is not None:
            self.mongo.sessions.replace_one({"_id": session["_id"]}, session, upsert=True)
        else:
            self.memory[session["_id"]] = copy.deepcopy(session)

    def list(self) -> list[dict[str, Any]]:
        if self.mongo is not None:
            records = self.mongo.sessions.find().sort("updatedAt", -1)
            return [copy.deepcopy(item) for item in records]
        return sorted(self.memory.values(), key=lambda item: item.get("updatedAt", ""), reverse=True)


store = SessionStore()
app = FastAPI(title="Anamnese Visual", version="0.1.0")
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
templates = Jinja2Templates(directory=str(TEMPLATES_DIR))


def get_session_or_404(session_id: str) -> dict[str, Any]:
    session = store.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Sessão não encontrada")
    return session


def validate_data_url(value: Any, label: str) -> Any:
    if value is None:
        return None
    if isinstance(value, str):
        if len(value) > MAX_DATA_URL_LENGTH:
            raise HTTPException(status_code=413, detail=f"{label} excede o tamanho permitido")
        return value
    if isinstance(value, dict):
        result = dict(value)
        data_url = result.get("dataUrl", "")
        if data_url and len(data_url) > MAX_DATA_URL_LENGTH:
            raise HTTPException(status_code=413, detail=f"{label} excede o tamanho permitido")
        return result
    raise HTTPException(status_code=422, detail=f"Formato inválido para {label}")


def apply_draft(session: dict[str, Any], payload: DraftPayload) -> dict[str, Any]:
    if payload.client is not None:
        session["client"] = payload.client.model_dump()
    session["answers"] = dict(payload.answers)
    session["bodyMap"] = list(payload.bodyMap)
    session["skinPhotos"] = [validate_data_url(photo, "Foto") for photo in payload.skinPhotos]
    session["document"] = validate_data_url(payload.document, "Documento")
    session["signature"] = validate_data_url(payload.signature, "Assinatura")
    session["termsAccepted"] = payload.termsAccepted
    session["updatedAt"] = now_iso()
    return session


def evaluate_rules(answers: dict[str, str]) -> dict[str, Any] | None:
    matched: list[dict[str, Any]] = []
    ranks = {"none": 0, "warning": 1, "review": 2, "critical": 3}
    highest = "none"
    for rule in RULES:
        answer = answers.get(rule["question"])
        if answer == "yes" or (answer == "unknown" and rule["severity"] in {"critical", "review"}):
            matched.append(
                {
                    "code": rule["code"],
                    "title": rule["title"],
                    "message": rule["message"],
                    "severity": rule["severity"],
                    "question": rule["question"],
                    "answer": answer,
                }
            )
            if ranks[rule["severity"]] > ranks[highest]:
                highest = rule["severity"]
    if not matched:
        return None
    return {
        "level": highest,
        "status": "pending",
        "matchedRules": matched,
        "createdAt": now_iso(),
        "updatedAt": now_iso(),
    }


def audit(session: dict[str, Any], action: str, detail: str = "") -> None:
    session.setdefault("audit", []).append({"action": action, "detail": detail, "at": now_iso()})


def public_session(session: dict[str, Any], include_audit: bool = False) -> dict[str, Any]:
    result = copy.deepcopy(session)
    if not include_audit:
        result.pop("audit", None)
    return result


@app.get("/", response_class=HTMLResponse)
async def home(request: Request) -> HTMLResponse:
    return templates.TemplateResponse(request=request, name="index.html", context={})


@app.get("/staff", response_class=HTMLResponse)
async def staff(request: Request) -> HTMLResponse:
    return templates.TemplateResponse(request=request, name="index.html", context={})


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "database": "mongodb" if store.mongo is not None else "memory-demo"}


@app.get("/api/config")
async def config() -> dict[str, Any]:
    return {
        "questions": QUESTIONS,
        "rulesVersion": "2026.09",
        "termsVersion": "v1.0",
        "bodyRegions": BODY_REGIONS,
    }


@app.get("/api/sessions")
async def list_sessions() -> list[dict[str, Any]]:
    return [public_session(item) for item in store.list()]


@app.post("/api/sessions")
async def create_session(payload: NewSessionPayload) -> dict[str, Any]:
    session_id = secrets.token_urlsafe(8)
    session = empty_session(session_id, payload.clientName)
    session["client"]["service"] = payload.service
    audit(session, "session_created", "Sessão criada pela recepção")
    store.save(session)
    return public_session(session)


@app.get("/api/sessions/{session_id}")
async def get_session(session_id: str, view: str = "client") -> dict[str, Any]:
    return public_session(get_session_or_404(session_id), include_audit=view == "staff")


@app.post("/api/sessions/{session_id}/draft")
async def save_draft(session_id: str, payload: DraftPayload) -> dict[str, Any]:
    session = get_session_or_404(session_id)
    apply_draft(session, payload)
    session["status"] = "draft"
    audit(session, "draft_saved")
    store.save(session)
    return public_session(session)


@app.post("/api/sessions/{session_id}/submit")
async def submit_session(session_id: str, payload: DraftPayload) -> dict[str, Any]:
    session = get_session_or_404(session_id)
    apply_draft(session, payload)

    missing: list[str] = []
    if not session.get("client", {}).get("name", "").strip():
        missing.append("nome")
    for question in QUESTIONS:
        if question["required"] and not session["answers"].get(question["code"]):
            missing.append(question["label"])
    if not session["bodyMap"]:
        missing.append("região do procedimento")
    if not session["skinPhotos"]:
        missing.append("foto da pele")
    if not session["document"]:
        missing.append("foto do documento")
    if not session["signature"]:
        missing.append("assinatura")
    if not session["termsAccepted"]:
        missing.append("aceite do termo")
    if missing:
        raise HTTPException(status_code=422, detail={"message": "Complete os itens obrigatórios", "items": missing})

    session["consentStatus"] = "valid"
    session["submittedAt"] = now_iso()
    session["alert"] = evaluate_rules(session["answers"])
    if session["alert"] is None:
        session["alertStatus"] = "clear"
        session["status"] = "ready"
    else:
        session["alertStatus"] = session["alert"]["level"]
        session["status"] = "needs_review"
    audit(session, "session_submitted", f"Status: {session['status']}")
    store.save(session)
    return public_session(session)


@app.post("/api/sessions/{session_id}/alert-action")
async def alert_action(session_id: str, payload: AlertActionPayload) -> dict[str, Any]:
    session = get_session_or_404(session_id)
    if session.get("alert") is None:
        raise HTTPException(status_code=409, detail="Esta sessão não possui alerta ativo")
    if payload.action not in {"acknowledge", "block", "release"}:
        raise HTTPException(status_code=422, detail="Ação de alerta inválida")
    if payload.action in {"block", "release"} and not payload.note.strip():
        raise HTTPException(status_code=422, detail="Informe uma justificativa para esta ação")

    session["alert"]["status"] = {
        "acknowledge": "acknowledged",
        "block": "blocked",
        "release": "resolved",
    }[payload.action]
    session["alert"]["updatedAt"] = now_iso()
    session["alert"]["note"] = payload.note.strip()
    session["alertStatus"] = "resolved" if payload.action == "release" else session["alert"]["status"]
    session["status"] = "ready" if payload.action == "release" else "blocked" if payload.action == "block" else "needs_review"
    audit(session, f"alert_{payload.action}", payload.note.strip())
    store.save(session)
    return public_session(session)
