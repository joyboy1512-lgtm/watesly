from fastapi import Depends, HTTPException, status

from app.api.dependencies.auth import AuthContext, get_auth_context


async def require_super_admin(
    context: AuthContext = Depends(get_auth_context),
) -> AuthContext:
    if not context.user.is_super_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Super admin access is required",
        )
    return context
