"""add trip destination and destination guide cache

Revision ID: d52b8e3f1a20
Revises: c41a7d2e9f10
Create Date: 2026-09-19 19:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd52b8e3f1a20'
down_revision: Union[str, Sequence[str], None] = 'c41a7d2e9f10'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table('trips', schema=None) as batch_op:
        batch_op.add_column(sa.Column('geoname_id', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('city', sa.String(), nullable=True))
        batch_op.add_column(sa.Column('state', sa.String(), nullable=True))
        batch_op.add_column(sa.Column('country', sa.String(), nullable=True))
        batch_op.add_column(sa.Column('country_code', sa.String(), nullable=True))
        batch_op.add_column(sa.Column('latitude', sa.Float(), nullable=True))
        batch_op.add_column(sa.Column('longitude', sa.Float(), nullable=True))

    op.create_table('destination_guides',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('geoname_id', sa.Integer(), nullable=False),
    sa.Column('status', sa.String(), nullable=False),
    sa.Column('payload', sa.Text(), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('destination_guides', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_destination_guides_geoname_id'), ['geoname_id'], unique=True)


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('destination_guides', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_destination_guides_geoname_id'))
    op.drop_table('destination_guides')

    with op.batch_alter_table('trips', schema=None) as batch_op:
        batch_op.drop_column('longitude')
        batch_op.drop_column('latitude')
        batch_op.drop_column('country_code')
        batch_op.drop_column('country')
        batch_op.drop_column('state')
        batch_op.drop_column('city')
        batch_op.drop_column('geoname_id')
