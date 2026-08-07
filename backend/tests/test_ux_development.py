"""UX pages and ecommerce webhook tests."""

from app.services.ecommerce_integrations import ORDER_EVENT_TYPES


def test_order_event_types_defined() -> None:
    assert "order_shipped" in ORDER_EVENT_TYPES
    assert "abandoned_cart" in ORDER_EVENT_TYPES


def test_growth_webhook_route_registered() -> None:
    from app.api.routes import growth_webhooks

    routes = [route.path for route in growth_webhooks.router.routes]
    assert "/{provider}/{connection_id}" in routes
