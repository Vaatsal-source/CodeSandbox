import os
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import declarative_base

# 1. Clean your DATABASE_URL if it contains '?sslmode=require'
DATABASE_URL = os.getenv("DATABASE_URL")

if DATABASE_URL and "?sslmode=" in DATABASE_URL:
    # Strip the query parameter from the URL to prevent asyncpg from choking
    DATABASE_URL = DATABASE_URL.split("?")[0]

# 2. Configure the async engine properly
engine = create_async_engine(
    DATABASE_URL,
    echo=True,
    connect_args={
        "ssl": "require"  # <-- This is how asyncpg prefers SSL handles!
    }
)

# 3. Session and Base boilerplate remain identical
AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False
)

Base = declarative_base()

async def get_db_context():
    """Asynchronous context manager yielding scoped database connection loops."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise