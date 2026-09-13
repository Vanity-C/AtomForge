"""Invalidate prior sessions when an account password changes."""
from alembic import op
import sqlalchemy as sa

revision = 'af_session_version'
down_revision = 'af_delivery_v2'
branch_labels = None
depends_on = None


def upgrade():
    if 'session_version' not in {c['name'] for c in sa.inspect(op.get_bind()).get_columns('af_users')}:
        op.add_column('af_users', sa.Column('session_version', sa.Integer(), nullable=False, server_default='0'))


def downgrade():
    op.drop_column('af_users', 'session_version')
