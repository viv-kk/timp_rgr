from datetime import datetime, timedelta, timezone
from enum import Enum
import base64
from email.message import EmailMessage
import hashlib
import hmac
import io
import json
import logging
import os
import urllib.error
import urllib.parse
import urllib.request
import re
import secrets
import smtplib
import uuid

import jwt
from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from passlib.context import CryptContext
from dotenv import load_dotenv
from pydantic import BaseModel, ConfigDict
import qrcode
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, and_, create_engine, func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, aliased, mapped_column, relationship, sessionmaker

load_dotenv()
logger = logging.getLogger("event_security")


DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+psycopg://postgres:postgres@localhost:5433/event_security",
)
JWT_SECRET = os.getenv("JWT_SECRET", "dev_secret_change_me")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "720"))
REFRESH_TOKEN_EXPIRE_DAYS = int(os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", "14"))
MAX_FAILED_LOGIN_ATTEMPTS = int(os.getenv("MAX_FAILED_LOGIN_ATTEMPTS", "5"))
LOGIN_LOCK_MINUTES = int(os.getenv("LOGIN_LOCK_MINUTES", "15"))
SMTP_HOST = os.getenv("SMTP_HOST", "")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "").replace(" ", "")
SMTP_FROM = os.getenv("SMTP_FROM", SMTP_USER)
SMTP_USE_TLS = os.getenv("SMTP_USE_TLS", "true").lower() == "true"
SMTP_TIMEOUT_SECONDS = int(os.getenv("SMTP_TIMEOUT_SECONDS", "20"))
ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "ChangeMe_Admin_Password_123!")
ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "").strip().lower()
LOGIN_2FA_EXPIRE_MINUTES = int(os.getenv("LOGIN_2FA_EXPIRE_MINUTES", "10"))
TICKET_VALID_BEFORE_HOURS = int(os.getenv("TICKET_VALID_BEFORE_HOURS", "2"))
TICKET_VALID_AFTER_HOURS = int(os.getenv("TICKET_VALID_AFTER_HOURS", "6"))
MAX_GATE_SCAN_FAILURES = int(os.getenv("MAX_GATE_SCAN_FAILURES", "15"))
GATE_SCAN_FAILURE_WINDOW_MINUTES = int(os.getenv("GATE_SCAN_FAILURE_WINDOW_MINUTES", "15"))
YANDEX_GEOCODER_API_KEY = os.getenv("YANDEX_GEOCODER_API_KEY", "").strip()

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")
LOGIN_ATTEMPTS: dict[str, dict] = {}
REGISTRATION_CODE_SENDS: dict[str, list[datetime]] = {}
GATE_SCAN_FAILURES: dict[str, list[datetime]] = {}
TICKET_EMAIL_LAST_SEND: dict[str, datetime] = {}
TICKET_EMAIL_MIN_INTERVAL_SECONDS = int(os.getenv("TICKET_EMAIL_MIN_INTERVAL_SECONDS", "50"))
PASSWORD_MIN_LENGTH = 10
REGISTRATION_CODE_LENGTH = 6
REGISTRATION_CODE_EXPIRE_MINUTES = 10
REGISTRATION_CODE_SEND_LIMIT = int(os.getenv("CODE_SEND_LIMIT", "25"))
REGISTRATION_CODE_SEND_WINDOW_MINUTES = int(os.getenv("CODE_SEND_WINDOW_MINUTES", "10"))


class Base(DeclarativeBase):
    pass


class UserRole(str, Enum):
    admin = "admin"
    manager = "manager"
    cashier = "cashier"


STAFF_REGISTER_ROLES = frozenset({UserRole.cashier.value, UserRole.manager.value})


class TicketStatus(str, Enum):
    sold = "sold"
    used = "used"


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    username: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(20), default=UserRole.cashier.value)


class Event(Base):
    __tablename__ = "events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    title: Mapped[str] = mapped_column(String(120))
    venue_name: Mapped[str] = mapped_column(String(120))
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"))

    tickets: Mapped[list["Ticket"]] = relationship(back_populates="event")


class Venue(Base):
    __tablename__ = "venues"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    address: Mapped[str | None] = mapped_column(String(255), nullable=True)
    capacity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"))


class Ticket(Base):
    __tablename__ = "tickets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    ticket_uuid: Mapped[str] = mapped_column(String(36), unique=True, index=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("events.id"), index=True)
    seat_label: Mapped[str | None] = mapped_column(String(30), nullable=True)
    buyer_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    price: Mapped[float] = mapped_column(Float)
    status: Mapped[str] = mapped_column(String(20), default=TicketStatus.sold.value)
    qr_token: Mapped[str] = mapped_column(String(600), unique=True)
    sold_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    sold_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    event: Mapped[Event] = relationship(back_populates="tickets")


class GateScanLog(Base):
    __tablename__ = "gate_scan_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    ticket_id: Mapped[int | None] = mapped_column(ForeignKey("tickets.id"), nullable=True)
    scanned_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    decision: Mapped[str] = mapped_column(String(20))
    reason: Mapped[str] = mapped_column(String(255))
    scanned_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    token_hash: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class CashierRegistrationRequest(Base):
    __tablename__ = "cashier_registration_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    username: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    email: Mapped[str] = mapped_column(String(255), index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    requested_role: Mapped[str] = mapped_column(String(20), default=UserRole.cashier.value, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class EmailVerificationCode(Base):
    __tablename__ = "email_verification_codes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    email: Mapped[str] = mapped_column(String(255), index=True)
    code_hash: Mapped[str] = mapped_column(String(64))
    purpose: Mapped[str] = mapped_column(String(40), index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class SystemAuditLog(Base):
    __tablename__ = "system_audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    event_type: Mapped[str] = mapped_column(String(40), index=True)
    actor: Mapped[str] = mapped_column(String(50))
    action: Mapped[str] = mapped_column(String(120))
    details: Mapped[str] = mapped_column(String(1000))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class LoginResponse(BaseModel):
    requires_2fa: bool = False
    access_token: str | None = None
    refresh_token: str | None = None
    token_type: str = "bearer"
    login_challenge_token: str | None = None
    message: str | None = None
    email_hint: str | None = None


class Login2FAVerifyRequest(BaseModel):
    login_challenge_token: str
    verification_code: str


class UserOut(BaseModel):
    id: int
    username: str
    role: str
    model_config = ConfigDict(from_attributes=True)


class EventCreate(BaseModel):
    title: str
    venue_id: int
    starts_at: datetime


class EventUpdate(BaseModel):
    title: str
    venue_id: int
    starts_at: datetime


class EventOut(BaseModel):
    id: int
    title: str
    venue_id: int | None = None
    venue_name: str
    starts_at: datetime
    model_config = ConfigDict(from_attributes=True)


class VenueCreate(BaseModel):
    name: str
    address: str | None = None
    capacity: int | None = None


class VenueUpdate(BaseModel):
    name: str
    address: str | None = None
    capacity: int | None = None


class VenueOut(BaseModel):
    id: int
    name: str
    address: str | None = None
    capacity: int | None = None
    model_config = ConfigDict(from_attributes=True)


class YandexGeocodeResultOut(BaseModel):
    address: str
    coords: list[float]


class YandexSuggestItemOut(BaseModel):
    address: str
    uri: str | None = None


class YandexSuggestResponse(BaseModel):
    items: list[YandexSuggestItemOut]


class TicketSaleCreate(BaseModel):
    event_id: int
    seat_label: str | None = None
    buyer_name: str | None = None
    price: float


class TicketOut(BaseModel):
    id: int
    ticket_uuid: str
    event_id: int
    status: str
    price: float
    qr_token: str
    short_code: str
    qr_image_base64: str


class TicketBatchSaleCreate(BaseModel):
    event_id: int
    seat_labels: list[str]
    buyer_name: str | None = None
    price_per_ticket: float


class TicketBatchSaleResponse(BaseModel):
    tickets: list[TicketOut]
    quantity: int
    total_price: float


class GateScanRequest(BaseModel):
    scan_value: str | None = None
    qr_token: str | None = None


class GateScanResponse(BaseModel):
    allowed: bool
    message: str
    ticket_id: int | None = None


class TicketEmailRequest(BaseModel):
    email: str
    ticket_ids: list[int] | None = None


class RefreshTokenRequest(BaseModel):
    refresh_token: str


class CashierRegisterSendCodeRequest(BaseModel):
    email: str


class CashierRegisterRequest(BaseModel):
    email: str
    username: str
    password: str
    verification_code: str


class StaffRegisterSendCodeRequest(BaseModel):
    email: str
    role: str = UserRole.cashier.value


class StaffRegisterRequest(BaseModel):
    email: str
    username: str
    password: str
    verification_code: str
    role: str = UserRole.cashier.value


class CashierRegistrationRequestOut(BaseModel):
    id: int
    username: str
    email: str | None = None
    requested_role: str
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class SeatMapResponse(BaseModel):
    rows: int
    cols: int
    taken_seats: list[str]


class EventStatsResponse(BaseModel):
    event_id: int
    sold_count: int
    checked_in_count: int
    not_checked_in_count: int
    check_in_rate_percent: float
    gate_allow_count: int
    gate_deny_count: int
    repeated_qr_attempts: int


class StatsOverviewResponse(BaseModel):
    events_count: int
    sold_count: int
    checked_in_count: int
    not_checked_in_count: int
    check_in_rate_percent: float
    gate_allow_count: int
    gate_deny_count: int
    repeated_qr_attempts: int


class EventStatsBreakdownItem(BaseModel):
    event_id: int
    event_title: str
    sold_count: int
    checked_in_count: int
    not_checked_in_count: int
    check_in_rate_percent: float
    sold_share_percent: float
    checked_in_share_percent: float
    not_checked_in_share_percent: float


class StatsByEventResponse(BaseModel):
    events_count: int
    total_sold: int
    total_checked_in: int
    total_not_checked_in: int
    check_in_rate_percent: float
    items: list[EventStatsBreakdownItem]


STAT_DETAIL_CATEGORIES = frozenset(
    {"sold", "checked_in", "not_checked_in", "gate_allow", "gate_deny", "repeated_qr"}
)


class EventStatDetailItem(BaseModel):
    event_title: str | None = None
    buyer_name: str | None = None
    seat_label: str | None = None
    ticket_code: str | None = None
    price: float | None = None
    sold_at: datetime | None = None
    used_at: datetime | None = None
    sold_by_username: str | None = None
    scanned_at: datetime | None = None
    scanner_username: str | None = None
    decision: str | None = None
    reason: str | None = None


class EventStatDetailsResponse(BaseModel):
    category: str
    items: list[EventStatDetailItem]


class AuditEventOut(BaseModel):
    timestamp: datetime
    event_type: str
    actor: str
    action: str
    details: str
    extra: dict[str, str] | None = None


class AuditFeedResponse(BaseModel):
    items: list[AuditEventOut]


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def create_access_token(user: User) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user.id),
        "username": user.username,
        "role": user.role,
        "iat": now,
        "exp": now + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
        "type": "access",
    }
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")


def hash_refresh_token(refresh_token: str) -> str:
    return hashlib.sha256(refresh_token.encode("utf-8")).hexdigest()


def create_refresh_token_record(db: Session, user_id: int) -> str:
    raw_token = secrets.token_urlsafe(48)
    token_record = RefreshToken(
        user_id=user_id,
        token_hash=hash_refresh_token(raw_token),
        expires_at=datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS),
    )
    db.add(token_record)
    return raw_token


def issue_token_pair(db: Session, user: User) -> TokenResponse:
    access_token = create_access_token(user)
    refresh_token = create_refresh_token_record(db, user.id)
    db.commit()
    return TokenResponse(access_token=access_token, refresh_token=refresh_token)


def get_login_lock_seconds(username_key: str) -> int:
    state = LOGIN_ATTEMPTS.get(username_key)
    if not state:
        return 0
    locked_until = state.get("locked_until")
    if not locked_until:
        return 0
    now = datetime.now(timezone.utc)
    if locked_until <= now:
        LOGIN_ATTEMPTS.pop(username_key, None)
        return 0
    return int((locked_until - now).total_seconds())


def register_failed_login(username_key: str) -> None:
    now = datetime.now(timezone.utc)
    state = LOGIN_ATTEMPTS.get(username_key, {"count": 0, "locked_until": None})
    state["count"] = int(state.get("count", 0)) + 1
    if state["count"] >= MAX_FAILED_LOGIN_ATTEMPTS:
        state["locked_until"] = now + timedelta(minutes=LOGIN_LOCK_MINUTES)
        state["count"] = 0
    LOGIN_ATTEMPTS[username_key] = state


def clear_login_attempts(username_key: str) -> None:
    LOGIN_ATTEMPTS.pop(username_key, None)


def validate_buyer_name(name: str | None) -> str | None:
    if not name:
        return None
    trimmed = name.strip()
    if not trimmed:
        return None
    if re.search(r"\d", trimmed):
        return "ФИО покупателя не должно содержать цифры"
    return None


def normalize_buyer_name(name: str | None) -> str | None:
    if name is None:
        return None
    trimmed = name.strip()
    return trimmed or None


def normalize_email(email: str) -> str:
    return email.strip().lower()


def validate_email_format(email: str) -> str | None:
    if not email:
        return "Укажите email"
    if len(email) > 255:
        return "Слишком длинный email"
    if not re.fullmatch(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$", email):
        return "Укажите корректный email"
    return None


def hash_verification_code(code: str) -> str:
    return hashlib.sha256(code.encode("utf-8")).hexdigest()


def generate_verification_code() -> str:
    return f"{secrets.randbelow(10**REGISTRATION_CODE_LENGTH):0{REGISTRATION_CODE_LENGTH}d}"


def can_send_registration_code(email_key: str) -> tuple[bool, int]:
    now = datetime.now(timezone.utc)
    window_start = now - timedelta(minutes=REGISTRATION_CODE_SEND_WINDOW_MINUTES)
    sends = [ts for ts in REGISTRATION_CODE_SENDS.get(email_key, []) if ts > window_start]
    REGISTRATION_CODE_SENDS[email_key] = sends
    if len(sends) >= REGISTRATION_CODE_SEND_LIMIT:
        retry_after = int((sends[0] - window_start).total_seconds())
        wait_seconds = max(1, REGISTRATION_CODE_SEND_WINDOW_MINUTES * 60 - retry_after)
        return False, wait_seconds
    return True, 0


def register_registration_code_send(email_key: str) -> None:
    now = datetime.now(timezone.utc)
    REGISTRATION_CODE_SENDS.setdefault(email_key, []).append(now)


def can_send_ticket_email(user_id: int) -> tuple[bool, int]:
    key = str(user_id)
    now = datetime.now(timezone.utc)
    last = TICKET_EMAIL_LAST_SEND.get(key)
    if last is None:
        return True, 0
    elapsed = (now - last).total_seconds()
    if elapsed >= TICKET_EMAIL_MIN_INTERVAL_SECONDS:
        return True, 0
    wait_seconds = max(1, int(TICKET_EMAIL_MIN_INTERVAL_SECONDS - elapsed))
    return False, wait_seconds


def register_ticket_email_send(user_id: int) -> None:
    TICKET_EMAIL_LAST_SEND[str(user_id)] = datetime.now(timezone.utc)


def send_text_email(to_email: str, subject: str, body: str) -> None:
    if not SMTP_HOST or not SMTP_FROM:
        raise HTTPException(
            status_code=500,
            detail="SMTP не настроен. Заполни SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASSWORD/SMTP_FROM",
        )
    send_email_with_attachments(to_email=to_email, subject=subject, body=body, attachments=[])


def verify_and_consume_email_code(
    db: Session,
    *,
    email: str,
    purpose: str,
    code: str,
) -> str | None:
    normalized_code = code.strip()
    if not re.fullmatch(rf"\d{{{REGISTRATION_CODE_LENGTH}}}", normalized_code):
        return "Код подтверждения должен состоять из 6 цифр"

    now = datetime.now(timezone.utc)
    record = db.scalar(
        select(EmailVerificationCode)
        .where(
            EmailVerificationCode.email == email,
            EmailVerificationCode.purpose == purpose,
            EmailVerificationCode.consumed_at.is_(None),
            EmailVerificationCode.expires_at >= now,
        )
        .order_by(EmailVerificationCode.created_at.desc())
    )
    if not record:
        return "Код подтверждения не найден или истёк. Запросите новый код."

    if record.code_hash != hash_verification_code(normalized_code):
        return "Неверный код подтверждения"

    record.consumed_at = now
    return None


def validate_username_letters(username: str) -> str | None:
    if len(username) < 3:
        return "Логин должен быть не короче 3 символов"
    if not re.fullmatch(r"[A-Za-zА-Яа-яЁё]+", username):
        return "Логин может содержать только русские и английские буквы"
    return None


def validate_password_strength(password: str) -> str | None:
    if len(password) < PASSWORD_MIN_LENGTH:
        return f"Пароль должен быть не короче {PASSWORD_MIN_LENGTH} символов"
    if " " in password:
        return "Пароль не должен содержать пробелы"
    if not re.search(r"[a-z]", password):
        return "Пароль должен содержать хотя бы одну строчную букву"
    if not re.search(r"[A-Z]", password):
        return "Пароль должен содержать хотя бы одну заглавную букву"
    if not re.search(r"\d", password):
        return "Пароль должен содержать хотя бы одну цифру"
    if not re.search(r"[^A-Za-z0-9]", password):
        return "Пароль должен содержать хотя бы один спецсимвол"
    return None


def mask_email(email: str) -> str:
    if "@" not in email:
        return email
    local, domain = email.split("@", 1)
    if len(local) <= 2:
        masked_local = local[0] + "*"
    else:
        masked_local = f"{local[0]}{'*' * (len(local) - 2)}{local[-1]}"
    return f"{masked_local}@{domain}"


def create_login_challenge_token(user_id: int) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "type": "login_2fa",
        "iat": now,
        "exp": now + timedelta(minutes=LOGIN_2FA_EXPIRE_MINUTES),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")


def decode_login_challenge_token(token: str) -> int:
    payload = decode_jwt(token)
    if payload.get("type") != "login_2fa":
        raise HTTPException(status_code=401, detail="Недействительный запрос двухфакторной проверки")
    return int(payload["sub"])


def send_login_2fa_code(db: Session, user: User) -> None:
    if not user.email:
        raise HTTPException(
            status_code=400,
            detail="У аккаунта не указан email. Обратитесь к администратору.",
        )
    email = normalize_email(user.email)
    can_send, wait_seconds = can_send_registration_code(email)
    if not can_send:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Слишком много запросов кода. Повторите через {wait_seconds} сек.",
        )

    verification_code = generate_verification_code()
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(minutes=LOGIN_2FA_EXPIRE_MINUTES)
    previous_codes = db.scalars(
        select(EmailVerificationCode).where(
            EmailVerificationCode.email == email,
            EmailVerificationCode.purpose == "login_2fa",
            EmailVerificationCode.consumed_at.is_(None),
        )
    ).all()
    for item in previous_codes:
        item.consumed_at = now

    db.add(
        EmailVerificationCode(
            email=email,
            code_hash=hash_verification_code(verification_code),
            purpose="login_2fa",
            expires_at=expires_at,
        )
    )
    send_text_email(
        to_email=email,
        subject="Код входа в систему — Event Security",
        body=(
            "Запрошен вход в систему Event Security.\n\n"
            f"Код подтверждения: {verification_code}\n"
            f"Код действует {LOGIN_2FA_EXPIRE_MINUTES} минут.\n\n"
            "Если это были не вы, смените пароль и сообщите администратору."
        ),
    )
    register_registration_code_send(email)


def get_gate_scan_lock_seconds(user_id: int) -> int:
    key = str(user_id)
    now = datetime.now(timezone.utc)
    window_start = now - timedelta(minutes=GATE_SCAN_FAILURE_WINDOW_MINUTES)
    failures = [ts for ts in GATE_SCAN_FAILURES.get(key, []) if ts > window_start]
    GATE_SCAN_FAILURES[key] = failures
    if len(failures) < MAX_GATE_SCAN_FAILURES:
        return 0
    retry_after = int((failures[0] - window_start).total_seconds())
    return max(1, GATE_SCAN_FAILURE_WINDOW_MINUTES * 60 - retry_after)


def register_gate_scan_failure(user_id: int) -> None:
    now = datetime.now(timezone.utc)
    key = str(user_id)
    GATE_SCAN_FAILURES.setdefault(key, []).append(now)


def clear_gate_scan_failures(user_id: int) -> None:
    GATE_SCAN_FAILURES.pop(str(user_id), None)


def parse_iso_datetime(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed


def validate_ticket_for_gate(ticket: Ticket, event: Event, qr_payload: dict | None) -> str | None:
    if qr_payload is not None:
        token_event_id = qr_payload.get("event_id")
        if token_event_id is not None and int(token_event_id) != ticket.event_id:
            return "Билет не соответствует мероприятию"
        token_starts_at = qr_payload.get("event_starts_at")
        if not token_starts_at:
            return "QR-код устарел. Переоформите билет"
        if parse_iso_datetime(token_starts_at) != event.starts_at.astimezone(timezone.utc):
            return "QR-код не соответствует дате мероприятия"

    now = datetime.now(timezone.utc)
    starts_at = event.starts_at.astimezone(timezone.utc)
    if now < starts_at - timedelta(hours=TICKET_VALID_BEFORE_HOURS):
        return f"Проход откроется за {TICKET_VALID_BEFORE_HOURS} ч до начала мероприятия"
    if now > starts_at + timedelta(hours=TICKET_VALID_AFTER_HOURS):
        return "Время прохода по этому билету истекло"
    return None


def create_ticket_token(ticket_uuid: str, event_id: int, event_starts_at: datetime) -> str:
    starts_at = event_starts_at.astimezone(timezone.utc)
    payload = {
        "ticket_uuid": ticket_uuid,
        "event_id": event_id,
        "event_starts_at": starts_at.isoformat(),
        "issued_at": datetime.now(timezone.utc).isoformat(),
        "type": "ticket",
    }
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")


def build_qr_png_bytes(qr_value: str) -> bytes:
    qr = qrcode.QRCode(version=1, box_size=8, border=2)
    qr.add_data(qr_value)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    buffer = io.BytesIO()
    img.save(buffer, format="PNG")
    return buffer.getvalue()


def build_qr_base64(qr_value: str) -> str:
    return base64.b64encode(build_qr_png_bytes(qr_value)).decode("ascii")


def normalize_seat_label(seat_label: str) -> str:
    return seat_label.strip().upper()


def create_short_ticket_code(ticket_uuid: str) -> str:
    digest = hmac.new(JWT_SECRET.encode("utf-8"), ticket_uuid.encode("utf-8"), hashlib.sha256).hexdigest()
    return str(int(digest[:12], 16) % 100_000_000).zfill(8)


def ticket_to_out(ticket: Ticket) -> TicketOut:
    return TicketOut(
        id=ticket.id,
        ticket_uuid=ticket.ticket_uuid,
        event_id=ticket.event_id,
        status=ticket.status,
        price=ticket.price,
        qr_token=ticket.qr_token,
        short_code=create_short_ticket_code(ticket.ticket_uuid),
        qr_image_base64=build_qr_base64(ticket.qr_token),
    )


def event_to_out(event: Event, venue_id_by_name: dict[str, int]) -> EventOut:
    return EventOut(
        id=event.id,
        title=event.title,
        venue_id=venue_id_by_name.get(event.venue_name),
        venue_name=event.venue_name,
        starts_at=event.starts_at,
    )


def get_pdf_font_names() -> tuple[str, str]:
    regular = "Helvetica"
    bold = "Helvetica-Bold"
    font_pairs = [
        (
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        ),
        (
            "/usr/share/fonts/dejavu/DejaVuSans.ttf",
            "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
        ),
    ]

    try:
        registered_fonts = pdfmetrics.getRegisteredFontNames()
        for regular_path, bold_path in font_pairs:
            if not os.path.exists(regular_path) or not os.path.exists(bold_path):
                continue
            if "DejaVuSans" not in registered_fonts:
                pdfmetrics.registerFont(TTFont("DejaVuSans", regular_path))
            if "DejaVuSans-Bold" not in registered_fonts:
                pdfmetrics.registerFont(TTFont("DejaVuSans-Bold", bold_path))
            registered_fonts = pdfmetrics.getRegisteredFontNames()
            if "DejaVuSans" in registered_fonts and "DejaVuSans-Bold" in registered_fonts:
                return "DejaVuSans", "DejaVuSans-Bold"
    except Exception as exc:
        logger.warning("PDF Cyrillic fonts unavailable, fallback to Helvetica: %s", exc)

    logger.warning(
        "DejaVu fonts not found on server. Install fonts-dejavu-core or rebuild API Docker image."
    )
    return regular, bold


def build_ticket_pdf_bytes(
    event_title: str,
    venue_name: str,
    starts_at: datetime,
    ticket_uuid: str,
    seat_label: str | None,
    buyer_name: str | None,
    price: float,
    qr_token: str,
) -> bytes:
    regular_font, bold_font = get_pdf_font_names()
    buffer = io.BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=A4)
    width, height = A4

    pdf.setFillColor(colors.HexColor("#020617"))
    pdf.rect(0, 0, width, height, stroke=0, fill=1)

    try:
        pdf.setFillAlpha(0.22)
    except Exception:
        pass
    pdf.setFillColor(colors.HexColor("#1D4ED8"))
    pdf.circle(70, height - 80, 95, stroke=0, fill=1)
    pdf.setFillColor(colors.HexColor("#4338CA"))
    pdf.circle(width - 65, height - 120, 85, stroke=0, fill=1)
    try:
        pdf.setFillAlpha(1)
    except Exception:
        pass

    margin = 36
    card_x = margin
    card_y = margin
    card_w = width - 2 * margin
    card_h = height - 2 * margin
    pdf.setFillColor(colors.HexColor("#0F172A"))
    pdf.setStrokeColor(colors.HexColor("#334155"))
    pdf.setLineWidth(1)
    pdf.roundRect(card_x, card_y, card_w, card_h, radius=18, stroke=1, fill=1)

    header_h = 90
    pdf.setFillColor(colors.HexColor("#1E3A8A"))
    pdf.roundRect(card_x, card_y + card_h - header_h, card_w, header_h, radius=18, stroke=0, fill=1)
    pdf.rect(card_x, card_y + card_h - header_h, card_w, 18, stroke=0, fill=1)

    pdf.setFillColor(colors.HexColor("#93C5FD"))
    pdf.roundRect(card_x + 24, card_y + card_h - 30, 92, 18, radius=9, stroke=0, fill=1)
    pdf.setFillColor(colors.HexColor("#0F172A"))
    pdf.setFont(bold_font, 9)
    pdf.drawCentredString(card_x + 70, card_y + card_h - 24, "ONE-TIME PASS")

    pdf.setFillColor(colors.white)
    pdf.setFont(bold_font, 24)
    pdf.drawString(card_x + 24, card_y + card_h - 52, "Event Security Ticket")
    pdf.setFont(regular_font, 11)
    pdf.drawString(card_x + 24, card_y + card_h - 72, "One-time QR pass for event entry")

    content_top = card_y + card_h - header_h - 24
    left_x = card_x + 24
    right_x = card_x + card_w - 220

    pdf.setFillColor(colors.HexColor("#1E293B"))
    pdf.roundRect(left_x - 10, content_top - 60, card_w - 260, 72, radius=12, stroke=0, fill=1)
    pdf.setFillColor(colors.HexColor("#BFDBFE"))
    pdf.setFont(bold_font, 11)
    pdf.drawString(left_x, content_top, "Event")
    pdf.setFont(bold_font, 13)
    pdf.setFillColor(colors.HexColor("#F8FAFC"))
    pdf.drawString(left_x, content_top - 18, event_title)
    pdf.setFont(regular_font, 10)
    pdf.setFillColor(colors.HexColor("#CBD5E1"))
    pdf.drawString(left_x, content_top - 34, f"Venue: {venue_name}")
    pdf.drawString(left_x, content_top - 49, f"Start: {starts_at.strftime('%d.%m.%Y %H:%M')}")

    details_y = content_top - 92
    pdf.setFillColor(colors.HexColor("#93C5FD"))
    pdf.setFont(bold_font, 12)
    pdf.drawString(left_x, details_y, "Ticket details")

    pdf.setFont(regular_font, 10)
    rows = [
        ("Entry code", create_short_ticket_code(ticket_uuid)),
        ("Seat", seat_label or "-"),
        ("Visitor", buyer_name or "-"),
        ("Price", f"{price:.2f}"),
    ]
    row_y = details_y - 20
    for label, value in rows:
        row_box_y = row_y - 13
        text_y = row_box_y + 5
        pdf.setFillColor(colors.HexColor("#1E293B"))
        pdf.roundRect(left_x - 6, row_box_y, card_w - 280, 18, radius=8, stroke=0, fill=1)
        pdf.setFillColor(colors.HexColor("#94A3B8"))
        pdf.drawString(left_x, text_y, f"{label}:")
        pdf.setFillColor(colors.HexColor("#F8FAFC"))
        pdf.drawString(left_x + 100, text_y, str(value))
        row_y -= 24

    qr_bytes = build_qr_png_bytes(qr_token)
    qr_img = ImageReader(io.BytesIO(qr_bytes))
    qr_panel_x = right_x - 10
    qr_panel_y = content_top - 215
    qr_panel_w = 180
    qr_panel_h = 202
    qr_size = 160
    qr_img_x = right_x
    qr_img_y = qr_panel_y + 32
    qr_bg_padding = 4
    caption_y = qr_panel_y + 12

    pdf.setFillColor(colors.HexColor("#E2E8F0"))
    pdf.roundRect(qr_panel_x, qr_panel_y, qr_panel_w, qr_panel_h, radius=14, stroke=0, fill=1)
    pdf.setFillColor(colors.white)
    pdf.roundRect(
        qr_img_x - qr_bg_padding,
        qr_img_y - qr_bg_padding,
        qr_size + 2 * qr_bg_padding,
        qr_size + 2 * qr_bg_padding,
        radius=8,
        stroke=0,
        fill=1,
    )
    pdf.drawImage(qr_img, qr_img_x, qr_img_y, width=qr_size, height=qr_size, preserveAspectRatio=True, mask="auto")
    pdf.setFillColor(colors.HexColor("#0F172A"))
    pdf.setFont(regular_font, 9)
    pdf.drawCentredString(right_x + 80, caption_y, "Show this QR at entrance")

    footer_y = card_y + 28
    pdf.setFillColor(colors.HexColor("#334155"))
    pdf.line(card_x + 20, footer_y + 30, card_x + card_w - 20, footer_y + 30)
    pdf.setFillColor(colors.HexColor("#94A3B8"))
    pdf.setFont(regular_font, 9)
    pdf.drawString(card_x + 24, footer_y + 12, "Important: QR can only be used once. Keep this ticket safe.")

    pdf.showPage()
    pdf.save()
    return buffer.getvalue()


def send_ticket_email(
    to_email: str,
    event_title: str,
    venue_name: str,
    starts_at: datetime,
    ticket_uuid: str,
    seat_label: str | None,
    buyer_name: str | None,
    price: float,
    qr_token: str,
) -> None:
    if not SMTP_HOST or not SMTP_FROM:
        raise HTTPException(
            status_code=500,
            detail="SMTP не настроен. Заполни SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASSWORD/SMTP_FROM",
        )

    ticket_pdf = build_ticket_pdf_bytes(
        event_title=event_title,
        venue_name=venue_name,
        starts_at=starts_at,
        ticket_uuid=ticket_uuid,
        seat_label=seat_label,
        buyer_name=buyer_name,
        price=price,
        qr_token=qr_token,
    )
    send_email_with_attachments(
        to_email=to_email,
        subject=f"Билет на мероприятие: {event_title}",
        body=(
            "Ваш билет сформирован.\n\n"
            f"Мероприятие: {event_title}\n"
            f"Площадка: {venue_name}\n"
            f"Начало: {starts_at.isoformat()}\n\n"
            "Во вложении PDF-билет с QR-кодом. Покажите его на входе."
        ),
        attachments=[
            (
                f"ticket_{create_short_ticket_code(ticket_uuid)}.pdf",
                ticket_pdf,
            )
        ],
    )


def send_email_with_attachments(
    to_email: str,
    subject: str,
    body: str,
    attachments: list[tuple[str, bytes]],
) -> None:
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = SMTP_FROM
    msg["To"] = to_email
    msg.set_content(body)
    for filename, attachment_bytes in attachments:
        msg.add_attachment(
            attachment_bytes,
            maintype="application",
            subtype="pdf",
            filename=filename,
        )

    try:
        if SMTP_USE_TLS:
            with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=SMTP_TIMEOUT_SECONDS) as server:
                server.starttls()
                if SMTP_USER:
                    server.login(SMTP_USER, SMTP_PASSWORD)
                server.send_message(msg)
        else:
            with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, timeout=SMTP_TIMEOUT_SECONDS) as server:
                if SMTP_USER:
                    server.login(SMTP_USER, SMTP_PASSWORD)
                server.send_message(msg)
    except smtplib.SMTPAuthenticationError as exc:
        logger.exception("SMTP authentication failed: %s", exc)
        detail = str(exc)
        if "smtp_auth_disabled" in detail.lower() or "5.7.139" in detail:
            hint = (
                "Почтовый сервер отключил SMTP-вход для этого ящика. "
                "Для Outlook/Hotmail включите SMTP в настройках Microsoft и используйте пароль приложения."
            )
        elif "gmail" in detail.lower() or "google" in detail.lower():
            hint = (
                "Gmail отклонил вход: неверный SMTP_USER/SMTP_PASSWORD или нужен пароль приложения Google."
            )
        else:
            hint = "Почтовый сервер отклонил вход SMTP. Проверьте SMTP_USER, SMTP_PASSWORD и пароль приложения."
        raise HTTPException(status_code=502, detail=hint) from exc
    except (smtplib.SMTPException, OSError, TimeoutError) as exc:
        logger.exception("SMTP send failed: %s", exc)
        raise HTTPException(
            status_code=502,
            detail="Не удалось отправить письмо через SMTP. Проверь SMTP_HOST/SMTP_PORT и доступность сети.",
        ) from exc


def send_ticket_bundle_email(
    to_email: str,
    tickets_with_events: list[tuple[Ticket, Event]],
) -> None:
    if not SMTP_HOST or not SMTP_FROM:
        raise HTTPException(
            status_code=500,
            detail="SMTP не настроен. Заполни SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASSWORD/SMTP_FROM",
        )
    if not tickets_with_events:
        raise HTTPException(status_code=400, detail="Нет билетов для отправки")

    attachments: list[tuple[str, bytes]] = []
    event_titles: set[str] = set()
    for ticket, event in tickets_with_events:
        event_titles.add(event.title)
        ticket_pdf = build_ticket_pdf_bytes(
            event_title=event.title,
            venue_name=event.venue_name,
            starts_at=event.starts_at,
            ticket_uuid=ticket.ticket_uuid,
            seat_label=ticket.seat_label,
            buyer_name=ticket.buyer_name,
            price=ticket.price,
            qr_token=ticket.qr_token,
        )
        attachments.append((f"ticket_{create_short_ticket_code(ticket.ticket_uuid)}.pdf", ticket_pdf))

    subject_event = next(iter(event_titles)) if len(event_titles) == 1 else "несколько мероприятий"
    body_lines = [
        "Ваши билеты сформированы.",
        "",
        f"Количество билетов: {len(attachments)}",
        f"Мероприятие: {subject_event}",
        "",
        "Во вложении PDF-билеты с QR-кодами. Покажите их на входе.",
    ]
    send_email_with_attachments(
        to_email=to_email,
        subject=f"Билеты на мероприятие: {subject_event}",
        body="\n".join(body_lines),
        attachments=attachments,
    )


def decode_jwt(token: str) -> dict:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=401, detail="Invalid token") from exc


def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    payload = decode_jwt(token)
    if payload.get("type") != "access":
        raise HTTPException(status_code=401, detail="Invalid access token type")

    user = db.get(User, int(payload["sub"]))
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


def require_role(*roles: UserRole):
    def checker(user: User = Depends(get_current_user)) -> User:
        if user.role not in [r.value for r in roles]:
            raise HTTPException(status_code=403, detail="Not enough permissions")
        return user

    return checker


def validate_staff_register_role(role: str) -> str | None:
    normalized = role.strip().lower()
    if normalized not in STAFF_REGISTER_ROLES:
        return "Укажите роль: cashier (кассир) или manager (менеджер)"
    return None


def staff_register_code_purpose(role: str) -> str:
    return f"{role.strip().lower()}_register"


def staff_role_label(role: str) -> str:
    mapping = {
        UserRole.cashier.value: "кассир",
        UserRole.manager.value: "менеджер",
        UserRole.admin.value: "администратор",
    }
    return mapping.get(role, role)


def seed_default_users(db: Session) -> None:
    username_taken_by_other = db.scalar(
        select(User).where(User.username == ADMIN_USERNAME, User.role != UserRole.admin.value).limit(1)
    )
    if username_taken_by_other:
        raise RuntimeError(f"ADMIN_USERNAME '{ADMIN_USERNAME}' is already used by non-admin user")

    admin_user = db.scalar(select(User).where(User.role == UserRole.admin.value).limit(1))
    if not admin_user:
        admin_user = User(
            username=ADMIN_USERNAME,
            email=ADMIN_EMAIL or None,
            password_hash=hash_password(ADMIN_PASSWORD),
            role=UserRole.admin.value,
        )
        db.add(admin_user)
        db.commit()
        return

    changed = False
    if admin_user.username != ADMIN_USERNAME:
        admin_user.username = ADMIN_USERNAME
        changed = True
    if ADMIN_EMAIL and admin_user.email != ADMIN_EMAIL:
        admin_user.email = ADMIN_EMAIL
        changed = True
    if not verify_password(ADMIN_PASSWORD, admin_user.password_hash):
        admin_user.password_hash = hash_password(ADMIN_PASSWORD)
        changed = True

    if changed:
        db.commit()


def append_system_audit(
    db: Session,
    *,
    event_type: str,
    actor: str,
    action: str,
    details: str,
) -> None:
    db.add(
        SystemAuditLog(
            event_type=event_type,
            actor=actor,
            action=action,
            details=details,
        )
    )


app = FastAPI(title="Event Security API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def migrate_schema() -> None:
    with engine.begin() as conn:
        conn.execute(
            text(
                "ALTER TABLE cashier_registration_requests "
                "ADD COLUMN IF NOT EXISTS requested_role VARCHAR(20) DEFAULT 'cashier'"
            )
        )


@app.on_event("startup")
def on_startup():
    Base.metadata.create_all(bind=engine)
    migrate_schema()
    with SessionLocal() as db:
        seed_default_users(db)


@app.get("/health")
def healthcheck():
    return {"status": "ok"}


@app.post("/auth/login", response_model=LoginResponse)
def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    username = form_data.username.strip()
    username_key = username.lower()
    lock_seconds = get_login_lock_seconds(username_key)
    if lock_seconds > 0:
        append_system_audit(
            db,
            event_type="login_blocked",
            actor=username or "—",
            action="Вход временно заблокирован",
            details=f"Превышено число попыток входа. Повторите через {lock_seconds} сек.",
        )
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Слишком много попыток входа. Повторите через {lock_seconds} сек.",
        )

    user = db.scalar(select(User).where(User.username == username))
    if not user or not verify_password(form_data.password, user.password_hash):
        register_failed_login(username_key)
        append_system_audit(
            db,
            event_type="login_failed",
            actor=username or "—",
            action="Неудачная попытка входа",
            details="Неверный логин или пароль",
        )
        db.commit()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Неверный логин или пароль")
    clear_login_attempts(username_key)

    try:
        send_login_2fa_code(db, user)
    except HTTPException as exc:
        db.rollback()
        raise exc

    challenge_token = create_login_challenge_token(user.id)
    append_system_audit(
        db,
        event_type="login_2fa_sent",
        actor=user.username,
        action="Отправлен код 2FA для входа",
        details=f"Код отправлен на {user.email}",
    )
    db.commit()
    return LoginResponse(
        requires_2fa=True,
        login_challenge_token=challenge_token,
        message="Введите код из письма для завершения входа",
        email_hint=mask_email(normalize_email(user.email or "")),
    )


@app.post("/auth/login/verify-2fa", response_model=TokenResponse)
def verify_login_2fa(payload: Login2FAVerifyRequest, db: Session = Depends(get_db)):
    user_id = decode_login_challenge_token(payload.login_challenge_token)
    user = db.get(User, user_id)
    if not user or not user.email:
        raise HTTPException(status_code=401, detail="Недействительный запрос входа")

    code_error = verify_and_consume_email_code(
        db,
        email=normalize_email(user.email),
        purpose="login_2fa",
        code=payload.verification_code,
    )
    if code_error:
        append_system_audit(
            db,
            event_type="login_2fa_failed",
            actor=user.username,
            action="Ошибка 2FA при входе",
            details=code_error,
        )
        db.commit()
        raise HTTPException(status_code=400, detail=code_error)

    append_system_audit(
        db,
        event_type="login_success",
        actor=user.username,
        action="Успешный вход в систему",
        details=f"Роль: {user.role}. Двухфакторная проверка пройдена.",
    )
    return issue_token_pair(db, user)


def send_staff_registration_code(db: Session, *, email: str, role: str) -> dict:
    role_error = validate_staff_register_role(role)
    if role_error:
        raise HTTPException(status_code=400, detail=role_error)

    email_error = validate_email_format(email)
    if email_error:
        raise HTTPException(status_code=400, detail=email_error)

    can_send, wait_seconds = can_send_registration_code(email)
    if not can_send:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Слишком много запросов кода. Повторите через {wait_seconds} сек.",
        )

    purpose = staff_register_code_purpose(role)
    verification_code = generate_verification_code()
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(minutes=REGISTRATION_CODE_EXPIRE_MINUTES)

    previous_codes = db.scalars(
        select(EmailVerificationCode).where(
            EmailVerificationCode.email == email,
            EmailVerificationCode.purpose == purpose,
            EmailVerificationCode.consumed_at.is_(None),
        )
    ).all()
    for item in previous_codes:
        item.consumed_at = now

    db.add(
        EmailVerificationCode(
            email=email,
            code_hash=hash_verification_code(verification_code),
            purpose=purpose,
            expires_at=expires_at,
        )
    )

    role_label = staff_role_label(role)
    try:
        send_text_email(
            to_email=email,
            subject="Код подтверждения регистрации — Event Security",
            body=(
                f"Вы запросили регистрацию ({role_label}) в системе Event Security.\n\n"
                f"Код подтверждения: {verification_code}\n"
                f"Код действует {REGISTRATION_CODE_EXPIRE_MINUTES} минут.\n\n"
                "Если вы не запрашивали регистрацию, проигнорируйте это письмо."
            ),
        )
    except HTTPException:
        db.rollback()
        raise

    register_registration_code_send(email)
    append_system_audit(
        db,
        event_type="cashier_register_code_sent",
        actor=email,
        action="Отправлен код подтверждения регистрации",
        details=f"Роль: {role_label}. Код отправлен на {email}",
    )
    db.commit()
    return {"ok": True, "message": f"Код подтверждения отправлен на {email}"}


def register_staff(db: Session, *, payload: StaffRegisterRequest) -> dict:
    role = payload.role.strip().lower()
    role_error = validate_staff_register_role(role)
    email = normalize_email(payload.email)
    username = payload.username.strip()
    email_error = validate_email_format(email)
    username_error = validate_username_letters(username)
    password_error = validate_password_strength(payload.password)
    role_label = staff_role_label(role)

    if role_error:
        raise HTTPException(status_code=400, detail=role_error)
    if email_error:
        raise HTTPException(status_code=400, detail=email_error)
    if username_error:
        raise HTTPException(status_code=400, detail=username_error)
    if password_error:
        raise HTTPException(status_code=400, detail=password_error)

    purpose = staff_register_code_purpose(role)
    code_error = verify_and_consume_email_code(
        db,
        email=email,
        purpose=purpose,
        code=payload.verification_code,
    )
    if code_error:
        append_system_audit(
            db,
            event_type="cashier_register_failed",
            actor=username,
            action="Ошибка регистрации",
            details=f"Роль: {role_label}. {code_error}",
        )
        db.commit()
        raise HTTPException(status_code=400, detail=code_error)

    existing_user = db.scalar(select(User).where(User.username == username))
    if existing_user:
        raise HTTPException(status_code=409, detail="Пользователь с таким логином уже существует")

    existing_request = db.scalar(select(CashierRegistrationRequest).where(CashierRegistrationRequest.username == username))
    if existing_request:
        raise HTTPException(status_code=409, detail="Заявка с таким логином уже отправлена и ожидает подтверждения")

    existing_email_request = db.scalar(
        select(CashierRegistrationRequest).where(CashierRegistrationRequest.email == email)
    )
    if existing_email_request:
        raise HTTPException(status_code=409, detail="Заявка с таким email уже отправлена и ожидает подтверждения")

    try:
        request = CashierRegistrationRequest(
            username=username,
            email=email,
            password_hash=hash_password(payload.password),
            requested_role=role,
        )
        db.add(request)
        append_system_audit(
            db,
            event_type="cashier_register_success",
            actor=username,
            action="Заявка на регистрацию отправлена",
            details=(
                f"Пользователь {username} ({role_label}) отправил заявку (email: {email}). "
                "Ожидает подтверждения администратора."
            ),
        )
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Заявка с таким логином уже существует")
    return {"ok": True, "message": "Заявка отправлена. Дождитесь подтверждения администратора."}


@app.post("/auth/cashier-register/send-code")
def send_cashier_registration_code(payload: CashierRegisterSendCodeRequest, db: Session = Depends(get_db)):
    return send_staff_registration_code(db, email=normalize_email(payload.email), role=UserRole.cashier.value)


@app.post("/auth/manager-register/send-code")
def send_manager_registration_code(payload: CashierRegisterSendCodeRequest, db: Session = Depends(get_db)):
    return send_staff_registration_code(db, email=normalize_email(payload.email), role=UserRole.manager.value)


@app.post("/auth/staff-register/send-code")
def send_staff_registration_code_endpoint(payload: StaffRegisterSendCodeRequest, db: Session = Depends(get_db)):
    return send_staff_registration_code(db, email=normalize_email(payload.email), role=payload.role)


@app.post("/auth/cashier-register", status_code=status.HTTP_201_CREATED)
def register_cashier(payload: CashierRegisterRequest, db: Session = Depends(get_db)):
    staff_payload = StaffRegisterRequest(
        email=payload.email,
        username=payload.username,
        password=payload.password,
        verification_code=payload.verification_code,
        role=UserRole.cashier.value,
    )
    return register_staff(db, payload=staff_payload)


@app.post("/auth/manager-register", status_code=status.HTTP_201_CREATED)
def register_manager(payload: CashierRegisterRequest, db: Session = Depends(get_db)):
    staff_payload = StaffRegisterRequest(
        email=payload.email,
        username=payload.username,
        password=payload.password,
        verification_code=payload.verification_code,
        role=UserRole.manager.value,
    )
    return register_staff(db, payload=staff_payload)


@app.post("/auth/staff-register", status_code=status.HTTP_201_CREATED)
def register_staff_endpoint(payload: StaffRegisterRequest, db: Session = Depends(get_db)):
    return register_staff(db, payload=payload)


@app.post("/auth/refresh", response_model=TokenResponse)
def refresh_access_token(payload: RefreshTokenRequest, db: Session = Depends(get_db)):
    refresh_hash = hash_refresh_token(payload.refresh_token)
    token_record = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == refresh_hash))
    now = datetime.now(timezone.utc)
    if not token_record or token_record.revoked_at is not None or token_record.expires_at < now:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")

    user = db.get(User, token_record.user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

    token_record.revoked_at = now
    access_token = create_access_token(user)
    new_refresh_token = create_refresh_token_record(db, user.id)
    db.commit()
    return TokenResponse(access_token=access_token, refresh_token=new_refresh_token)


@app.get("/auth/me", response_model=UserOut)
def me(current_user: User = Depends(get_current_user)):
    return current_user


@app.get("/admin/cashier-requests", response_model=list[CashierRegistrationRequestOut])
@app.get("/admin/registration-requests", response_model=list[CashierRegistrationRequestOut])
def list_registration_requests(
    db: Session = Depends(get_db),
    _: User = Depends(require_role(UserRole.admin)),
):
    return db.scalars(select(CashierRegistrationRequest).order_by(CashierRegistrationRequest.created_at.asc())).all()


@app.post("/admin/cashier-requests/{request_id}/approve", response_model=UserOut)
@app.post("/admin/registration-requests/{request_id}/approve", response_model=UserOut)
def approve_registration_request(
    request_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.admin)),
):
    request = db.get(CashierRegistrationRequest, request_id)
    if not request:
        raise HTTPException(status_code=404, detail="Заявка не найдена")

    requested_role = (request.requested_role or UserRole.cashier.value).strip().lower()
    if requested_role not in STAFF_REGISTER_ROLES:
        raise HTTPException(status_code=400, detail="Некорректная роль в заявке")

    existing_user = db.scalar(select(User).where(User.username == request.username))
    if existing_user:
        db.delete(request)
        db.commit()
        raise HTTPException(status_code=409, detail="Пользователь с таким логином уже существует")

    role_label = staff_role_label(requested_role)
    user = User(
        username=request.username,
        email=request.email,
        password_hash=request.password_hash,
        role=requested_role,
    )
    db.add(user)
    append_system_audit(
        db,
        event_type="cashier_request_approved",
        actor=current_user.username,
        action="Заявка на регистрацию подтверждена",
        details=(
            f"Администратор {current_user.username} подтвердил заявку "
            f"({role_label}) пользователя {user.username}"
        ),
    )
    db.delete(request)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Не удалось подтвердить заявку: логин уже занят")
    db.refresh(user)
    return user


@app.delete("/admin/cashier-requests/{request_id}")
@app.delete("/admin/registration-requests/{request_id}")
def reject_registration_request(
    request_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.admin)),
):
    request = db.get(CashierRegistrationRequest, request_id)
    if not request:
        raise HTTPException(status_code=404, detail="Заявка не найдена")
    role_label = staff_role_label(request.requested_role or UserRole.cashier.value)
    append_system_audit(
        db,
        event_type="cashier_request_rejected",
        actor=current_user.username,
        action="Заявка на регистрацию отклонена",
        details=f"Администратор отклонил заявку ({role_label}) пользователя {request.username}",
    )
    db.delete(request)
    db.commit()
    return {"ok": True}


@app.post("/events", response_model=EventOut)
def create_event(
    payload: EventCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.manager)),
):
    venue = db.get(Venue, payload.venue_id)
    if not venue:
        raise HTTPException(status_code=404, detail="Venue not found")
    event = Event(
        title=payload.title,
        venue_name=venue.name,
        starts_at=payload.starts_at,
        created_by=current_user.id,
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return EventOut(id=event.id, title=event.title, venue_id=venue.id, venue_name=event.venue_name, starts_at=event.starts_at)


def _yandex_http_get(url: str) -> dict:
    request = urllib.request.Request(url, headers={"User-Agent": "EventSecurity/1.0", "Accept": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="ignore")
        try:
            payload = json.loads(body)
            message = payload.get("message") or body
        except json.JSONDecodeError:
            message = body or str(exc)
        raise HTTPException(status_code=exc.code, detail=message) from exc
    except urllib.error.URLError as exc:
        raise HTTPException(status_code=502, detail=f"Yandex API unavailable: {exc.reason}") from exc


def _parse_yandex_geocode_payload(data: dict) -> YandexGeocodeResultOut | None:
    geo_object = data.get("response", {}).get("GeoObjectCollection", {}).get("featureMember", [{}])[0].get("GeoObject")
    if not geo_object:
        return None
    meta = geo_object.get("metaDataProperty", {}).get("GeocoderMetaData", {})
    address = meta.get("text") or meta.get("Address", {}).get("formatted") or geo_object.get("name")
    pos = geo_object.get("Point", {}).get("pos", "")
    parts = str(pos).split()
    if len(parts) != 2:
        return None
    lon, lat = float(parts[0]), float(parts[1])
    if not address:
        return None
    return YandexGeocodeResultOut(address=address, coords=[lat, lon])


def _parse_yandex_suggest_payload(data: dict) -> list[YandexSuggestItemOut]:
    items: list[YandexSuggestItemOut] = []
    for item in data.get("results", []):
        title = (item.get("title") or {}).get("text", "")
        subtitle = (item.get("subtitle") or {}).get("text", "")
        formatted = (item.get("address") or {}).get("formatted_address", "")
        address = formatted or ", ".join(part for part in [title, subtitle] if part)
        if address:
            items.append(YandexSuggestItemOut(address=address, uri=item.get("uri")))
    return items


@app.get("/yandex/geocode", response_model=YandexGeocodeResultOut)
def yandex_geocode_proxy(
    geocode: str | None = None,
    uri: str | None = None,
    _: User = Depends(require_role(UserRole.manager)),
):
    if not YANDEX_GEOCODER_API_KEY:
        raise HTTPException(status_code=500, detail="YANDEX_GEOCODER_API_KEY не задан в backend/.env")
    if not geocode and not uri:
        raise HTTPException(status_code=400, detail="Укажите geocode или uri")

    params = {
        "apikey": YANDEX_GEOCODER_API_KEY,
        "lang": "ru_RU",
        "format": "json",
        "results": "1",
    }
    if uri:
        params["uri"] = uri
    else:
        params["geocode"] = geocode.strip()

    url = "https://geocode-maps.yandex.ru/v1/?" + urllib.parse.urlencode(params)
    data = _yandex_http_get(url)
    result = _parse_yandex_geocode_payload(data)
    if not result:
        raise HTTPException(status_code=404, detail="Адрес не найден")
    return result


@app.get("/yandex/suggest", response_model=YandexSuggestResponse)
def yandex_suggest_proxy(
    text: str,
    _: User = Depends(require_role(UserRole.manager)),
):
    if not YANDEX_GEOCODER_API_KEY:
        raise HTTPException(status_code=500, detail="YANDEX_GEOCODER_API_KEY не задан в backend/.env")
    query = text.strip()
    if len(query) < 2:
        return YandexSuggestResponse(items=[])

    params = urllib.parse.urlencode(
        {
            "apikey": YANDEX_GEOCODER_API_KEY,
            "text": query,
            "lang": "ru",
            "results": "7",
            "types": "geo,street,house",
            "print_address": "1",
        }
    )
    url = f"https://suggest-maps.yandex.ru/v1/suggest?{params}"
    try:
        data = _yandex_http_get(url)
    except HTTPException as exc:
        if exc.status_code in {403, 404}:
            return YandexSuggestResponse(items=[])
        raise
    return YandexSuggestResponse(items=_parse_yandex_suggest_payload(data))


@app.post("/venues", response_model=VenueOut)
def create_venue(
    payload: VenueCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.manager)),
):
    venue_name = payload.name.strip()
    if not venue_name:
        raise HTTPException(status_code=400, detail="Venue name is required")

    existing = db.scalar(select(Venue).where(Venue.name == venue_name))
    if existing:
        raise HTTPException(status_code=409, detail="Venue with this name already exists")

    venue = Venue(
        name=venue_name,
        address=payload.address.strip() if payload.address else None,
        capacity=payload.capacity,
        created_by=current_user.id,
    )
    db.add(venue)
    db.commit()
    db.refresh(venue)
    return venue


@app.get("/venues", response_model=list[VenueOut])
def list_venues(
    db: Session = Depends(get_db),
    _: User = Depends(require_role(UserRole.manager, UserRole.cashier)),
):
    return db.scalars(select(Venue).order_by(Venue.name.asc())).all()


@app.put("/venues/{venue_id}", response_model=VenueOut)
def update_venue(
    venue_id: int,
    payload: VenueUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_role(UserRole.manager)),
):
    venue = db.get(Venue, venue_id)
    if not venue:
        raise HTTPException(status_code=404, detail="Venue not found")

    venue_name = payload.name.strip()
    if not venue_name:
        raise HTTPException(status_code=400, detail="Venue name is required")

    duplicate = db.scalar(select(Venue).where(Venue.name == venue_name, Venue.id != venue_id))
    if duplicate:
        raise HTTPException(status_code=409, detail="Venue with this name already exists")

    old_name = venue.name
    venue.name = venue_name
    venue.address = payload.address.strip() if payload.address else None
    venue.capacity = payload.capacity

    if old_name != venue_name:
        linked_events = db.scalars(select(Event).where(Event.venue_name == old_name)).all()
        for event in linked_events:
            event.venue_name = venue_name

    db.commit()
    db.refresh(venue)
    return venue


@app.delete("/venues/{venue_id}")
def delete_venue(
    venue_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_role(UserRole.manager)),
):
    venue = db.get(Venue, venue_id)
    if not venue:
        raise HTTPException(status_code=404, detail="Venue not found")

    event_exists = db.scalar(select(Event.id).where(Event.venue_name == venue.name).limit(1))
    if event_exists:
        raise HTTPException(status_code=409, detail="Нельзя удалить площадку, пока с ней связаны мероприятия")

    db.delete(venue)
    db.commit()
    return {"ok": True}


@app.get("/events", response_model=list[EventOut])
def list_events(
    db: Session = Depends(get_db),
    _: User = Depends(require_role(UserRole.manager, UserRole.cashier)),
):
    events = db.scalars(select(Event).order_by(Event.starts_at.asc())).all()
    venues = db.scalars(select(Venue)).all()
    venue_id_by_name = {venue.name: venue.id for venue in venues}
    return [event_to_out(event, venue_id_by_name) for event in events]


@app.put("/events/{event_id}", response_model=EventOut)
def update_event(
    event_id: int,
    payload: EventUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_role(UserRole.manager)),
):
    event = db.get(Event, event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    venue = db.get(Venue, payload.venue_id)
    if not venue:
        raise HTTPException(status_code=404, detail="Venue not found")

    event.title = payload.title
    event.venue_name = venue.name
    event.starts_at = payload.starts_at
    db.commit()
    db.refresh(event)
    return EventOut(id=event.id, title=event.title, venue_id=venue.id, venue_name=event.venue_name, starts_at=event.starts_at)


@app.delete("/events/{event_id}")
def delete_event(
    event_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_role(UserRole.manager)),
):
    event = db.get(Event, event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    ticket_exists = db.scalar(select(Ticket.id).where(Ticket.event_id == event_id).limit(1))
    if ticket_exists:
        raise HTTPException(status_code=409, detail="Нельзя удалить мероприятие, по которому уже есть билеты")

    db.delete(event)
    db.commit()
    return {"ok": True}


@app.post("/tickets/sell", response_model=TicketOut)
def sell_ticket(
    payload: TicketSaleCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.cashier)),
):
    event = db.get(Event, payload.event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    buyer_name = normalize_buyer_name(payload.buyer_name)
    buyer_name_error = validate_buyer_name(buyer_name)
    if buyer_name_error:
        raise HTTPException(status_code=400, detail=buyer_name_error)

    ticket_uuid = str(uuid.uuid4())
    qr_token = create_ticket_token(ticket_uuid=ticket_uuid, event_id=event.id, event_starts_at=event.starts_at)
    ticket = Ticket(
        ticket_uuid=ticket_uuid,
        event_id=event.id,
        seat_label=payload.seat_label,
        buyer_name=buyer_name,
        price=payload.price,
        status=TicketStatus.sold.value,
        qr_token=qr_token,
        sold_by=current_user.id,
    )
    db.add(ticket)
    db.commit()
    db.refresh(ticket)
    return ticket_to_out(ticket)


@app.get("/events/{event_id}/seat-map", response_model=SeatMapResponse)
def get_event_seat_map(
    event_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_role(UserRole.cashier)),
):
    event = db.get(Event, event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    taken = db.scalars(
        select(Ticket.seat_label).where(
            Ticket.event_id == event_id,
            Ticket.seat_label.is_not(None),
        )
    ).all()
    taken_seats = [normalize_seat_label(seat) for seat in taken if seat]
    return SeatMapResponse(rows=8, cols=12, taken_seats=taken_seats)


def compute_stats_counts(db: Session, event_id: int | None = None) -> dict[str, int]:
    ticket_filters = [Ticket.event_id == event_id] if event_id is not None else []

    sold_count = db.scalar(select(func.count(Ticket.id)).where(*ticket_filters)) or 0
    checked_in_count = (
        db.scalar(
            select(func.count(Ticket.id)).where(
                *ticket_filters,
                Ticket.status == TicketStatus.used.value,
            )
        )
        or 0
    )

    def gate_scan_count(*extra_filters) -> int:
        query = select(func.count(GateScanLog.id)).join(Ticket, Ticket.id == GateScanLog.ticket_id)
        if event_id is not None:
            query = query.where(Ticket.event_id == event_id)
        if extra_filters:
            query = query.where(*extra_filters)
        return db.scalar(query) or 0

    gate_allow_count = gate_scan_count(GateScanLog.decision == "allow")
    gate_deny_count = gate_scan_count(GateScanLog.decision == "deny")
    repeated_qr_attempts = gate_scan_count(
        GateScanLog.decision == "deny",
        GateScanLog.reason == "Ticket already used",
    )

    not_checked_in_count = max(sold_count - checked_in_count, 0)
    check_in_rate_percent = round((checked_in_count / sold_count) * 100, 2) if sold_count else 0.0
    return {
        "sold_count": sold_count,
        "checked_in_count": checked_in_count,
        "not_checked_in_count": not_checked_in_count,
        "check_in_rate_percent": check_in_rate_percent,
        "gate_allow_count": gate_allow_count,
        "gate_deny_count": gate_deny_count,
        "repeated_qr_attempts": repeated_qr_attempts,
    }


def compute_stats_by_event(db: Session) -> StatsByEventResponse:
    events = db.scalars(select(Event).order_by(Event.starts_at.desc())).all()
    items: list[EventStatsBreakdownItem] = []
    total_sold = 0
    total_checked_in = 0
    total_not_checked_in = 0

    for event in events:
        counts = compute_stats_counts(db, event.id)
        sold = counts["sold_count"]
        checked_in = counts["checked_in_count"]
        not_checked_in = counts["not_checked_in_count"]
        total_sold += sold
        total_checked_in += checked_in
        total_not_checked_in += not_checked_in
        items.append(
            EventStatsBreakdownItem(
                event_id=event.id,
                event_title=event.title,
                sold_count=sold,
                checked_in_count=checked_in,
                not_checked_in_count=not_checked_in,
                check_in_rate_percent=counts["check_in_rate_percent"],
                sold_share_percent=0.0,
                checked_in_share_percent=0.0,
                not_checked_in_share_percent=0.0,
            )
        )

    for item in items:
        item.sold_share_percent = round((item.sold_count / total_sold) * 100, 2) if total_sold else 0.0
        item.checked_in_share_percent = (
            round((item.checked_in_count / total_checked_in) * 100, 2) if total_checked_in else 0.0
        )
        item.not_checked_in_share_percent = (
            round((item.not_checked_in_count / total_not_checked_in) * 100, 2) if total_not_checked_in else 0.0
        )

    overall_rate = round((total_checked_in / total_sold) * 100, 2) if total_sold else 0.0
    return StatsByEventResponse(
        events_count=len(events),
        total_sold=total_sold,
        total_checked_in=total_checked_in,
        total_not_checked_in=total_not_checked_in,
        check_in_rate_percent=overall_rate,
        items=items,
    )


def build_stat_detail_items(db: Session, category: str, event_id: int | None = None) -> list[EventStatDetailItem]:
    items: list[EventStatDetailItem] = []
    scanner_user = aliased(User)
    all_events = event_id is None

    if category == "sold":
        query = select(Ticket, User.username).join(User, User.id == Ticket.sold_by)
        if all_events:
            query = select(Ticket, User.username, Event.title).join(User, User.id == Ticket.sold_by).join(
                Event, Event.id == Ticket.event_id
            )
        elif event_id is not None:
            query = query.where(Ticket.event_id == event_id)
        query = query.order_by(Ticket.sold_at.desc())
        for row in db.execute(query).all():
            ticket = row[0]
            sold_by_username = row[1]
            event_title = row[2] if all_events else None
            items.append(
                EventStatDetailItem(
                    event_title=event_title,
                    buyer_name=ticket.buyer_name or "—",
                    seat_label=ticket.seat_label or "—",
                    ticket_code=create_short_ticket_code(ticket.ticket_uuid),
                    price=ticket.price,
                    sold_at=ticket.sold_at,
                    sold_by_username=sold_by_username,
                )
            )
    elif category == "checked_in":
        if all_events:
            query = (
                select(Ticket, GateScanLog.scanned_at, scanner_user.username, Event.title)
                .join(Event, Event.id == Ticket.event_id)
            )
        else:
            query = select(Ticket, GateScanLog.scanned_at, scanner_user.username)
        query = (
            query.outerjoin(
                GateScanLog,
                and_(GateScanLog.ticket_id == Ticket.id, GateScanLog.decision == "allow"),
            )
            .outerjoin(scanner_user, GateScanLog.scanned_by == scanner_user.id)
            .where(Ticket.status == TicketStatus.used.value)
        )
        if event_id is not None:
            query = query.where(Ticket.event_id == event_id)
        query = query.order_by(Ticket.used_at.desc())
        for row in db.execute(query).all():
            ticket, scanned_at, scanner_username = row[0], row[1], row[2]
            event_title = row[3] if all_events else None
            items.append(
                EventStatDetailItem(
                    event_title=event_title,
                    buyer_name=ticket.buyer_name or "—",
                    seat_label=ticket.seat_label or "—",
                    ticket_code=create_short_ticket_code(ticket.ticket_uuid),
                    used_at=ticket.used_at,
                    scanned_at=scanned_at,
                    scanner_username=scanner_username or "—",
                )
            )
    elif category == "not_checked_in":
        if all_events:
            query = (
                select(Ticket, Event.title)
                .join(Event, Event.id == Ticket.event_id)
                .where(Ticket.status == TicketStatus.sold.value)
            )
        else:
            query = select(Ticket).where(
                Ticket.event_id == event_id,
                Ticket.status == TicketStatus.sold.value,
            )
        query = query.order_by(Ticket.sold_at.desc())
        for row in db.execute(query).all():
            ticket = row[0]
            event_title = row[1] if all_events else None
            items.append(
                EventStatDetailItem(
                    event_title=event_title,
                    buyer_name=ticket.buyer_name or "—",
                    seat_label=ticket.seat_label or "—",
                    ticket_code=create_short_ticket_code(ticket.ticket_uuid),
                    price=ticket.price,
                    sold_at=ticket.sold_at,
                )
            )
    else:
        if all_events:
            scan_query = (
                select(GateScanLog, Ticket, scanner_user.username, Event.title)
                .join(Ticket, GateScanLog.ticket_id == Ticket.id)
                .join(Event, Event.id == Ticket.event_id)
            )
        else:
            scan_query = (
                select(GateScanLog, Ticket, scanner_user.username)
                .join(Ticket, GateScanLog.ticket_id == Ticket.id)
                .where(Ticket.event_id == event_id)
            )
        scan_query = scan_query.join(scanner_user, GateScanLog.scanned_by == scanner_user.id).order_by(
            GateScanLog.scanned_at.desc()
        )
        if category == "gate_allow":
            scan_query = scan_query.where(GateScanLog.decision == "allow")
        elif category == "gate_deny":
            scan_query = scan_query.where(GateScanLog.decision == "deny")
        else:
            scan_query = scan_query.where(
                GateScanLog.decision == "deny",
                GateScanLog.reason == "Ticket already used",
            )

        for row in db.execute(scan_query).all():
            scan_log, ticket, scanner_username = row[0], row[1], row[2]
            event_title = row[3] if all_events else None
            items.append(
                EventStatDetailItem(
                    event_title=event_title,
                    buyer_name=ticket.buyer_name or "—",
                    seat_label=ticket.seat_label or "—",
                    ticket_code=create_short_ticket_code(ticket.ticket_uuid),
                    scanned_at=scan_log.scanned_at,
                    scanner_username=scanner_username,
                    decision=scan_log.decision,
                    reason=format_gate_reason(scan_log.reason),
                )
            )

    return items


def format_gate_reason(reason: str) -> str:
    mapping = {
        "Ticket accepted": "Проход разрешён",
        "Ticket already used": "QR уже использован",
        "Invalid or broken scan value": "Некорректный код",
        "Invalid or broken QR token": "Некорректный QR-код",
        "Short code not found": "Короткий код не найден",
        "Ticket not found": "Билет не найден",
    }
    return mapping.get(reason, reason)


@app.get("/stats/overview", response_model=StatsOverviewResponse)
def get_stats_overview(
    db: Session = Depends(get_db),
    _: User = Depends(require_role(UserRole.admin, UserRole.cashier)),
):
    events_count = db.scalar(select(func.count(Event.id))) or 0
    counts = compute_stats_counts(db)
    return StatsOverviewResponse(events_count=events_count, **counts)


@app.get("/stats/by-event", response_model=StatsByEventResponse)
def get_stats_by_event(
    db: Session = Depends(get_db),
    _: User = Depends(require_role(UserRole.admin, UserRole.cashier)),
):
    return compute_stats_by_event(db)


@app.get("/stats/details/{category}", response_model=EventStatDetailsResponse)
def get_stats_overview_details(
    category: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_role(UserRole.admin, UserRole.cashier)),
):
    if category not in STAT_DETAIL_CATEGORIES:
        raise HTTPException(status_code=400, detail="Неизвестная категория статистики")
    items = build_stat_detail_items(db, category)
    return EventStatDetailsResponse(category=category, items=items)


@app.get("/events/{event_id}/stats", response_model=EventStatsResponse)
def get_event_stats(
    event_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_role(UserRole.admin, UserRole.cashier)),
):
    event = db.get(Event, event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    counts = compute_stats_counts(db, event_id)
    return EventStatsResponse(event_id=event_id, **counts)


@app.get("/events/{event_id}/stats/details/{category}", response_model=EventStatDetailsResponse)
def get_event_stat_details(
    event_id: int,
    category: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_role(UserRole.admin, UserRole.cashier)),
):
    if category not in STAT_DETAIL_CATEGORIES:
        raise HTTPException(status_code=400, detail="Неизвестная категория статистики")

    event = db.get(Event, event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    items = build_stat_detail_items(db, category, event_id)
    return EventStatDetailsResponse(category=category, items=items)


@app.post("/tickets/sell-batch", response_model=TicketBatchSaleResponse)
def sell_ticket_batch(
    payload: TicketBatchSaleCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.cashier)),
):
    event = db.get(Event, payload.event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if payload.price_per_ticket <= 0:
        raise HTTPException(status_code=400, detail="Price must be greater than zero")
    if len(payload.seat_labels) == 0:
        raise HTTPException(status_code=400, detail="Select at least one seat")

    buyer_name = normalize_buyer_name(payload.buyer_name)
    buyer_name_error = validate_buyer_name(buyer_name)
    if buyer_name_error:
        raise HTTPException(status_code=400, detail=buyer_name_error)

    normalized = [normalize_seat_label(seat) for seat in payload.seat_labels if seat.strip()]
    if len(normalized) != len(payload.seat_labels):
        raise HTTPException(status_code=400, detail="Seat labels must not be empty")
    if len(set(normalized)) != len(normalized):
        raise HTTPException(status_code=400, detail="Duplicate seats in request")

    existing = db.scalars(
        select(Ticket.seat_label).where(
            Ticket.event_id == payload.event_id,
            Ticket.seat_label.in_(normalized),
        )
    ).all()
    if existing:
        occupied = ", ".join(sorted({normalize_seat_label(seat) for seat in existing if seat}))
        raise HTTPException(status_code=409, detail=f"Seats already sold: {occupied}")

    created_tickets: list[Ticket] = []
    for seat_label in normalized:
        ticket_uuid = str(uuid.uuid4())
        qr_token = create_ticket_token(
            ticket_uuid=ticket_uuid,
            event_id=event.id,
            event_starts_at=event.starts_at,
        )
        ticket = Ticket(
            ticket_uuid=ticket_uuid,
            event_id=event.id,
            seat_label=seat_label,
            buyer_name=buyer_name,
            price=payload.price_per_ticket,
            status=TicketStatus.sold.value,
            qr_token=qr_token,
            sold_by=current_user.id,
        )
        db.add(ticket)
        created_tickets.append(ticket)

    db.commit()
    for ticket in created_tickets:
        db.refresh(ticket)

    tickets_out = [ticket_to_out(ticket) for ticket in created_tickets]
    quantity = len(tickets_out)
    return TicketBatchSaleResponse(
        tickets=tickets_out,
        quantity=quantity,
        total_price=round(payload.price_per_ticket * quantity, 2),
    )


@app.get("/tickets/{ticket_id}/qr.png")
def get_ticket_qr_image(
    ticket_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_role(UserRole.cashier)),
):
    ticket = db.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    return StreamingResponse(io.BytesIO(build_qr_png_bytes(ticket.qr_token)), media_type="image/png")


@app.post("/tickets/{ticket_id}/send-email")
def send_ticket_qr_email(
    ticket_id: int,
    payload: TicketEmailRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.cashier)),
):
    ticket = db.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    requested_ids = payload.ticket_ids or []
    target_ids = {ticket_id, *requested_ids}

    tickets = db.scalars(select(Ticket).where(Ticket.id.in_(target_ids)).order_by(Ticket.id.asc())).all()
    if not tickets:
        raise HTTPException(status_code=404, detail="Tickets not found")

    missing_ids = sorted(target_ids - {item.id for item in tickets})
    if missing_ids:
        raise HTTPException(status_code=404, detail=f"Tickets not found: {', '.join(str(item) for item in missing_ids)}")

    events = db.scalars(select(Event).where(Event.id.in_({item.event_id for item in tickets}))).all()
    event_by_id = {event.id: event for event in events}
    tickets_with_events: list[tuple[Ticket, Event]] = []
    for item in tickets:
        event = event_by_id.get(item.event_id)
        if not event:
            raise HTTPException(status_code=404, detail=f"Event not found for ticket {item.id}")
        tickets_with_events.append((item, event))

    can_send, wait_seconds = can_send_ticket_email(current_user.id)
    if not can_send:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Подождите {wait_seconds} сек. перед следующей отправкой.",
        )

    ticket_codes = ", ".join(create_short_ticket_code(ticket.ticket_uuid) for ticket, _ in tickets_with_events)
    event_titles = ", ".join(sorted({event.title for _, event in tickets_with_events}))
    try:
        send_ticket_bundle_email(to_email=payload.email, tickets_with_events=tickets_with_events)
    except HTTPException as exc:
        error_detail = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
        append_system_audit(
            db,
            event_type="email_send_failed",
            actor=current_user.username,
            action="Ошибка отправки билетов на email",
            details=f"Адрес: {payload.email}. {error_detail}",
        )
        db.commit()
        raise

    register_ticket_email_send(current_user.id)

    append_system_audit(
        db,
        event_type="email_sent",
        actor=current_user.username,
        action="Билеты отправлены на email",
        details=(
            f"Адрес: {payload.email}. "
            f"Билетов: {len(tickets_with_events)}. "
            f"Мероприятия: {event_titles}. "
            f"Коды: {ticket_codes}"
        ),
    )
    db.commit()
    if len(tickets_with_events) == 1:
        return {"ok": True, "message": f"PDF-билет отправлен на {payload.email}"}
    return {"ok": True, "message": f"{len(tickets_with_events)} PDF-билета отправлены на {payload.email}"}


@app.get("/audit/feed", response_model=AuditFeedResponse)
def get_audit_feed(
    limit: int = 100,
    db: Session = Depends(get_db),
    _: User = Depends(require_role(UserRole.admin)),
):
    limit = max(1, min(limit, 500))
    audit_items: list[AuditEventOut] = []

    ticket_rows = db.execute(
        select(Ticket, User.username, Event.title)
        .join(User, Ticket.sold_by == User.id)
        .join(Event, Ticket.event_id == Event.id)
        .order_by(Ticket.sold_at.desc())
        .limit(limit)
    ).all()
    for ticket, username, event_title in ticket_rows:
        audit_items.append(
            AuditEventOut(
                timestamp=ticket.sold_at,
                event_type="ticket_sale",
                actor=username,
                action="Продажа билета",
                details=f"{event_title}, место: {ticket.seat_label or '-'}, код: {create_short_ticket_code(ticket.ticket_uuid)}",
                extra={
                    "Кассир": username,
                    "Мероприятие": event_title,
                    "Место": ticket.seat_label or "-",
                    "Код билета": create_short_ticket_code(ticket.ticket_uuid),
                    "Покупатель": ticket.buyer_name or "-",
                    "Цена": f"{ticket.price:.2f}",
                },
            )
        )

    scan_rows = db.execute(
        select(GateScanLog, User.username, Ticket.ticket_uuid, Event.title)
        .join(User, GateScanLog.scanned_by == User.id)
        .outerjoin(Ticket, GateScanLog.ticket_id == Ticket.id)
        .outerjoin(Event, Ticket.event_id == Event.id)
        .order_by(GateScanLog.scanned_at.desc())
        .limit(limit)
    ).all()
    for scan_log, username, ticket_uuid, event_title in scan_rows:
        ticket_code = create_short_ticket_code(ticket_uuid) if ticket_uuid else "-"
        audit_items.append(
            AuditEventOut(
                timestamp=scan_log.scanned_at,
                event_type="gate_scan",
                actor=username,
                action="Сканирование на входе",
                details=(
                    f"Результат: {scan_log.decision}. "
                    f"Причина: {scan_log.reason}. "
                    f"Событие: {event_title or '-'}, код: {ticket_code}"
                ),
                extra={
                    "Сотрудник КПП": username,
                    "Результат": scan_log.decision,
                    "Причина": scan_log.reason,
                    "Мероприятие": event_title or "-",
                    "Код билета": ticket_code,
                },
            )
        )

    system_rows = db.scalars(select(SystemAuditLog).order_by(SystemAuditLog.created_at.desc()).limit(limit)).all()
    for log_item in system_rows:
        extra = None
        if log_item.event_type.startswith("login_"):
            extra = {"Событие": "Авторизация", "Пользователь": log_item.actor}
        elif log_item.event_type.startswith("cashier_register"):
            extra = {"Событие": "Регистрация кассира", "Логин": log_item.actor}
        elif log_item.event_type.startswith("email_"):
            extra = {"Событие": "Email", "Инициатор": log_item.actor}
        elif log_item.event_type.startswith("cashier_request_"):
            extra = {"Событие": "Заявка кассира", "Участник": log_item.actor}

        audit_items.append(
            AuditEventOut(
                timestamp=log_item.created_at,
                event_type=log_item.event_type,
                actor=log_item.actor,
                action=log_item.action,
                details=log_item.details,
                extra=extra,
            )
        )

    audit_items.sort(key=lambda item: item.timestamp, reverse=True)
    return AuditFeedResponse(items=audit_items[:limit])


def log_gate_deny(
    db: Session,
    *,
    current_user: User,
    ticket_id: int | None,
    reason: str,
    message: str,
) -> GateScanResponse:
    register_gate_scan_failure(current_user.id)
    db.add(
        GateScanLog(
            ticket_id=ticket_id,
            scanned_by=current_user.id,
            decision="deny",
            reason=reason,
        )
    )
    db.commit()
    return GateScanResponse(allowed=False, message=message, ticket_id=ticket_id)


@app.post("/gate/scan", response_model=GateScanResponse)
def scan_qr(
    payload: GateScanRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.cashier)),
):
    gate_lock_seconds = get_gate_scan_lock_seconds(current_user.id)
    if gate_lock_seconds > 0:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Слишком много неудачных попыток сканирования. Повторите через {gate_lock_seconds} сек.",
        )

    scan_value = (payload.scan_value or payload.qr_token or "").strip()
    if not scan_value:
        raise HTTPException(status_code=400, detail="Scan value is required")

    ticket = None
    qr_payload: dict | None = None
    invalid_reason = "Invalid or broken scan value"
    if scan_value.isdigit() and len(scan_value) == 8:
        candidates = db.scalars(
            select(Ticket).where(Ticket.status == TicketStatus.sold.value).order_by(Ticket.id.desc()).limit(5000)
        ).all()
        for candidate in candidates:
            if create_short_ticket_code(candidate.ticket_uuid) == scan_value:
                ticket = candidate
                break
        if not ticket:
            invalid_reason = "Short code not found"
    else:
        try:
            qr_payload = decode_jwt(scan_value)
            if qr_payload.get("type") != "ticket":
                raise HTTPException(status_code=400, detail="Invalid QR token type")
            ticket = db.scalar(select(Ticket).where(Ticket.ticket_uuid == qr_payload["ticket_uuid"]))
            if not ticket:
                invalid_reason = "Ticket not found"
        except HTTPException:
            invalid_reason = "Invalid or broken QR token"

    if not ticket:
        return log_gate_deny(
            db,
            current_user=current_user,
            ticket_id=None,
            reason=invalid_reason,
            message="Билет не найден или код недействителен",
        )

    event = db.get(Event, ticket.event_id)
    if not event:
        return log_gate_deny(
            db,
            current_user=current_user,
            ticket_id=ticket.id,
            reason="Event not found",
            message="Мероприятие для билета не найдено",
        )

    binding_error = validate_ticket_for_gate(ticket, event, qr_payload)
    if binding_error:
        return log_gate_deny(
            db,
            current_user=current_user,
            ticket_id=ticket.id,
            reason="Ticket event/time mismatch",
            message=binding_error,
        )

    if ticket.used_at is not None or ticket.status == TicketStatus.used.value:
        return log_gate_deny(
            db,
            current_user=current_user,
            ticket_id=ticket.id,
            reason="Ticket already used",
            message="Этот QR уже был использован",
        )

    clear_gate_scan_failures(current_user.id)
    ticket.status = TicketStatus.used.value
    ticket.used_at = datetime.now(timezone.utc)
    db.add(
        GateScanLog(
            ticket_id=ticket.id,
            scanned_by=current_user.id,
            decision="allow",
            reason="Ticket accepted",
        )
    )
    db.commit()
    return GateScanResponse(allowed=True, message="Проход разрешен", ticket_id=ticket.id)
