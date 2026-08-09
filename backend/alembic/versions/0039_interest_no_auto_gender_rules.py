"""Clear built-in gender exclusion rules from interest categories."""
from alembic import op

revision: str = "0039"
down_revision: str | None = "0038"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE interest_categories
        SET exclude_genders = '[]'::jsonb,
            include_genders = NULL
        WHERE exclude_genders != '[]'::jsonb
           OR include_genders IS NOT NULL
        """
    )


def downgrade() -> None:
    op.execute(
        """
        UPDATE interest_categories
        SET exclude_genders = '["male"]'::jsonb
        WHERE slug = 'beauty'
        """
    )
