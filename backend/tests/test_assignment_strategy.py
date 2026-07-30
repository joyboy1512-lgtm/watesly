from app.models.assignment_rule import AssignmentStrategy


def test_assignment_strategy_values() -> None:
    assert AssignmentStrategy.ROUND_ROBIN.value == "round_robin"
    assert AssignmentStrategy.LEAST_OPEN.value == "least_open"
