"""add auth attempts for rate limiting

Revision ID: e63c9f2a7b31
Revises: d52b8e3f1a20
Create Date: 2026-09-20 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e63c9f2a7b31'
down_revision: Union[str, Sequence[str], None] = 'd52b8e3f1a20'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('auth_attempts',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('kind', sa.String(), nullable=False),
    sa.Column('email_hash', sa.String(), nullable=True),
    sa.Column('address_hash', sa.String(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('auth_attempts', schema=None) as batch_op:
        batch_op.create_index('ix_auth_attempts_kind_address_created', ['kind', 'address_hash', 'created_at'], unique=False)
        batch_op.create_index('ix_auth_attempts_kind_email_address', ['kind', 'email_hash', 'address_hash'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('auth_attempts', schema=None) as batch_op:
        batch_op.drop_index('ix_auth_attempts_kind_email_address')
        batch_op.drop_index('ix_auth_attempts_kind_address_created')
    op.drop_table('auth_attempts')
