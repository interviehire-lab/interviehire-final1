import datetime
from typing import Optional
import jwt
from fastapi import Depends, HTTPException, Request, status
from passlib.context import CryptContext
from sqlalchemy.orm import Session
from uuid import UUID

from app.config import settings
from app.database import get_db
from app.models.user import User, UserStatus, UserType

import bcrypt

# JWT configuration
SECRET_KEY = settings.SECRET_KEY
ALGORITHM = "HS256"
# Shorter session window shrinks the blast radius of a leaked cookie/token. A
# hiring dashboard re-login once a day is acceptable; bump this back up (or add
# refresh-token rotation) if longer sessions are needed. Keep the auth-cookie
# `max_age` in `routers/auth.py` in sync with this value.
ACCESS_TOKEN_EXPIRE_DAYS = 1

# Pin the bcrypt work factor explicitly rather than relying on the library
# default, so the cost is auditable and can be raised deliberately over time.
BCRYPT_ROUNDS = 12


def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        return bcrypt.checkpw(plain_password.encode('utf-8'), hashed_password.encode('utf-8'))
    except Exception:
        return False


def get_password_hash(password: str) -> str:
    salt = bcrypt.gensalt(rounds=BCRYPT_ROUNDS)
    return bcrypt.hashpw(password.encode('utf-8'), salt).decode('utf-8')


def create_access_token(data: dict, expires_delta: Optional[datetime.timedelta] = None) -> str:
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.datetime.utcnow() + expires_delta
    else:
        expire = datetime.datetime.utcnow() + datetime.timedelta(days=ACCESS_TOKEN_EXPIRE_DAYS)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


def get_current_user(request: Request, db: Session = Depends(get_db)) -> User:
    token = request.cookies.get("token")
    
    if not token:
        auth_header = request.headers.get("Authorization")
        if auth_header and auth_header.startswith("Bearer "):
            token = auth_header.split(" ")[1]

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: str = payload.get("sub")
        if user_id is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid credentials token",
            )
    except jwt.PyJWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
        )

    user = db.query(User).filter(User.id == UUID(user_id)).first()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
        )
    # A superadmin can suspend a user OR their whole organisation mid-session (see
    # platform.py) — either must actually revoke access, not just block a future
    # login, or an already-issued cookie would keep working for up to
    # ACCESS_TOKEN_EXPIRE_DAYS regardless. Checked here (every authenticated
    # request), not just at login.
    if user.status == UserStatus.inactive:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This account has been suspended.",
        )
    # super_admins have no organisation_id (or one only incidentally), so this
    # never blocks them.
    if user.organisation_id and user.user_type != UserType.super_admin:
        from app.models.organisation import Organisation, OrganisationStatus
        org = db.query(Organisation).filter(Organisation.id == user.organisation_id).first()
        if org and org.status == OrganisationStatus.suspended:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="This organisation has been suspended.",
            )
    return user


def require_super_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.user_type != UserType.super_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only Super Admins can access this.",
        )
    return current_user


def get_active_org_id(request: Request, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> Optional[UUID]:
    if current_user.user_type == UserType.super_admin:
        # 1. Explicit per-browser selection (switch-context / login).
        org_id_cookie = request.cookies.get("active_org_id")
        if org_id_cookie:
            try:
                return UUID(org_id_cookie)
            except Exception:
                pass
        # 2. Durable server-side choice — survives cookie loss and re-login.
        if current_user.last_active_org_id:
            return current_user.last_active_org_id
        # 3. A super_admin that happens to own an org.
        if current_user.organisation_id:
            return current_user.organisation_id
        # 4. Deterministic last resort (was an arbitrary .first() = "devasri-tech").
        from app.models.organisation import Organisation
        first_org = (
            db.query(Organisation)
            .order_by(Organisation.created_at.asc(), Organisation.id.asc())
            .first()
        )
        return first_org.id if first_org else None
    return current_user.organisation_id
