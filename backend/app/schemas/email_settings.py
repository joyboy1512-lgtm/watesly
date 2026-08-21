from pydantic import BaseModel, Field


class EmailSettingsResponse(BaseModel):
    email_notifications_enabled: bool
    notification_emails: list[str]
    catalog_order_emails: list[str]
    email_configured: bool
    brevo_configured: bool
    smtp_configured: bool


class EmailSettingsUpdate(BaseModel):
    email_notifications_enabled: bool | None = None
    notification_emails: list[str] | None = None
    catalog_order_emails: list[str] | None = None


class EmailTestRequest(BaseModel):
    target: str = Field(default="notification", pattern=r"^(notification|catalog_order)$")
