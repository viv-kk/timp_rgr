from enum import Enum
import logging
import os

from dotenv import load_dotenv

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
ADMIN_FULL_NAME = os.getenv("ADMIN_FULL_NAME", "Ильиных Виктория Сергеевна").strip()
LOGIN_2FA_EXPIRE_MINUTES = int(os.getenv("LOGIN_2FA_EXPIRE_MINUTES", "10"))
TICKET_VALID_BEFORE_HOURS = int(os.getenv("TICKET_VALID_BEFORE_HOURS", "2"))
TICKET_VALID_AFTER_HOURS = int(os.getenv("TICKET_VALID_AFTER_HOURS", "6"))
MAX_GATE_SCAN_FAILURES = int(os.getenv("MAX_GATE_SCAN_FAILURES", "15"))
GATE_SCAN_FAILURE_WINDOW_MINUTES = int(os.getenv("GATE_SCAN_FAILURE_WINDOW_MINUTES", "15"))
YANDEX_GEOCODER_API_KEY = os.getenv("YANDEX_GEOCODER_API_KEY", "").strip()
TICKET_EMAIL_MIN_INTERVAL_SECONDS = int(os.getenv("TICKET_EMAIL_MIN_INTERVAL_SECONDS", "50"))
PASSWORD_MIN_LENGTH = 10
REGISTRATION_CODE_LENGTH = 6
REGISTRATION_CODE_EXPIRE_MINUTES = 10
REGISTRATION_CODE_SEND_LIMIT = int(os.getenv("PER_EMAIL_CODE_SEND_LIMIT", "3"))
REGISTRATION_CODE_SEND_WINDOW_MINUTES = int(os.getenv("PER_EMAIL_CODE_SEND_WINDOW_MINUTES", "15"))
GLOBAL_CODE_SEND_LIMIT = int(os.getenv("CODE_SEND_LIMIT", "25"))
GLOBAL_CODE_SEND_WINDOW_MINUTES = int(os.getenv("CODE_SEND_WINDOW_MINUTES", "10"))


class UserRole(str, Enum):
    admin = "admin"
    manager = "manager"
    cashier = "cashier"


STAFF_REGISTER_ROLES = frozenset({UserRole.cashier.value, UserRole.manager.value})


class TicketStatus(str, Enum):
    sold = "sold"
    used = "used"
