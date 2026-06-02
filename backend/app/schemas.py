from datetime import datetime

from pydantic import BaseModel, ConfigDict

from .config import UserRole


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
    full_name: str | None = None
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
    full_name: str
    password: str
    verification_code: str


class StaffRegisterSendCodeRequest(BaseModel):
    email: str
    role: str = UserRole.cashier.value


class StaffRegisterRequest(BaseModel):
    email: str
    username: str
    full_name: str
    password: str
    verification_code: str
    role: str = UserRole.cashier.value


class CashierRegistrationRequestOut(BaseModel):
    id: int
    username: str
    full_name: str
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
