"""add users and trip ownership

Revision ID: c41a7d2e9f10
Revises: b6c22ddcec02
Create Date: 2026-09-19 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c41a7d2e9f10'
down_revision: Union[str, Sequence[str], None] = 'b6c22ddcec02'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Owns any trips that existed before accounts did. It has no password and no
# Google identity, so nobody can sign in as it; the rows are kept, not lost.
LEGACY_EMAIL = 'legacy-owner@invalid.local'


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('users',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('email', sa.String(), nullable=False),
    sa.Column('password_hash', sa.String(), nullable=True),
    sa.Column('google_sub', sa.String(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('email'),
    sa.UniqueConstraint('google_sub')
    )

    # Add as nullable first so existing rows can be backfilled, then tighten.
    with op.batch_alter_table('trips', schema=None) as batch_op:
        batch_op.add_column(sa.Column('user_id', sa.Integer(), nullable=True))

    bind = op.get_bind()
    has_trips = bind.execute(sa.text('SELECT COUNT(*) FROM trips')).scalar() > 0
    if has_trips:
        bind.execute(sa.text('INSERT INTO users (email) VALUES (:email)'), {'email': LEGACY_EMAIL})
        legacy_id = bind.execute(
            sa.text('SELECT id FROM users WHERE email = :email'), {'email': LEGACY_EMAIL}
        ).scalar()
        bind.execute(sa.text('UPDATE trips SET user_id = :uid'), {'uid': legacy_id})

    with op.batch_alter_table('trips', schema=None) as batch_op:
        batch_op.alter_column('user_id', existing_type=sa.Integer(), nullable=False)
        batch_op.create_index(batch_op.f('ix_trips_user_id'), ['user_id'], unique=False)
        batch_op.create_foreign_key('fk_trips_user_id_users', 'users', ['user_id'], ['id'], ondelete='CASCADE')


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('trips', schema=None) as batch_op:
        batch_op.drop_constraint('fk_trips_user_id_users', type_='foreignkey')
        batch_op.drop_index(batch_op.f('ix_trips_user_id'))
        batch_op.drop_column('user_id')

    op.drop_table('users')
