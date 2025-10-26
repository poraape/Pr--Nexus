"""Initial task and report tables."""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "20240615_000001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    dialect_name = bind.dialect.name if bind is not None else "postgresql"
    is_sqlite = dialect_name == "sqlite"

    uuid_type = sa.String(length=36) if is_sqlite else postgresql.UUID(as_uuid=True)
    json_type = sa.JSON() if is_sqlite else postgresql.JSONB()

    def _timestamp_column(name: str) -> sa.Column:
        kwargs: dict[str, sa.sql.elements.TextClause] = {}
        if not is_sqlite:
            kwargs["server_default"] = sa.text("TIMEZONE('utc', NOW())")
            if name == "updated_at":
                kwargs["server_onupdate"] = sa.text("TIMEZONE('utc', NOW())")
        return sa.Column(
            name,
            sa.DateTime(timezone=True),
            nullable=False,
            **kwargs,
        )

    agent_status_default = sa.text("'{}'") if is_sqlite else sa.text("'{}'::jsonb")

    op.create_table(
        "tasks",
        sa.Column("id", uuid_type, primary_key=True, nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="pending"),
        sa.Column("progress", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("original_filename", sa.String(length=255), nullable=True),
        sa.Column("storage_path", sa.String(length=512), nullable=True),
        sa.Column("input_metadata", json_type, nullable=True),
        sa.Column("agent_status", json_type, nullable=False, server_default=agent_status_default),
        sa.Column("error_message", sa.String(length=512), nullable=True),
        _timestamp_column("created_at"),
        _timestamp_column("updated_at"),
    )

    op.create_table(
        "reports",
        sa.Column("id", uuid_type, primary_key=True, nullable=False),
        sa.Column("task_id", uuid_type, nullable=False),
        sa.Column("content", json_type, nullable=False),
        _timestamp_column("created_at"),
        _timestamp_column("updated_at"),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("task_id"),
    )


def downgrade() -> None:
    op.drop_table("reports")
    op.drop_table("tasks")
