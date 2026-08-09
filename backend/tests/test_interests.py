from app.services.interests import merge_interest_gender_rules


class _Category:
    def __init__(self, exclude_genders=None, include_genders=None):
        self.exclude_genders = exclude_genders or []
        self.include_genders = include_genders


def test_merge_interest_gender_rules_collects_excludes() -> None:
    exclude, include = merge_interest_gender_rules([
        _Category(exclude_genders=["male"]),
        _Category(exclude_genders=["female"]),
    ])
    assert exclude == {"male", "female"}
    assert include == set()


def test_merge_interest_gender_rules_collects_includes() -> None:
    exclude, include = merge_interest_gender_rules([
        _Category(include_genders=["female"]),
    ])
    assert include == {"female"}
    assert exclude == set()
