"""Add external identities, single-use OAuth flows and delivery history."""
from alembic import op
from models.delivery import ExternalIdentity, OAuthFlow, Delivery

revision='af_delivery_v2'
down_revision='80d920d8a4c7'
branch_labels=None
depends_on=None

def upgrade():
    bind=op.get_bind()
    for model in [ExternalIdentity,OAuthFlow,Delivery]:model.__table__.create(bind,checkfirst=True)

def downgrade():
    bind=op.get_bind()
    for model in [Delivery,OAuthFlow,ExternalIdentity]:model.__table__.drop(bind,checkfirst=True)
