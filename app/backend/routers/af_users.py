import json
import logging
from typing import List, Optional

from datetime import datetime, date

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from services.af_users import Af_usersService

# Set up logging
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/entities/af_users", tags=["af_users"])


# ---------- Pydantic Schemas ----------
class Af_usersData(BaseModel):
    """Entity data schema (for create/update)"""
    email: str
    password_hash: str
    display_name: str
    status: str = None
    last_login_at: str = None


class Af_usersUpdateData(BaseModel):
    """Update entity data (partial updates allowed)"""
    email: Optional[str] = None
    password_hash: Optional[str] = None
    display_name: Optional[str] = None
    status: Optional[str] = None
    last_login_at: Optional[str] = None


class Af_usersResponse(BaseModel):
    """Entity response schema"""
    id: int
    email: str
    password_hash: str
    display_name: str
    status: Optional[str] = None
    last_login_at: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class Af_usersListResponse(BaseModel):
    """List response schema"""
    items: List[Af_usersResponse]
    total: int
    skip: int
    limit: int


class Af_usersBatchCreateRequest(BaseModel):
    """Batch create request"""
    items: List[Af_usersData]


class Af_usersBatchUpdateItem(BaseModel):
    """Batch update item"""
    id: int
    updates: Af_usersUpdateData


class Af_usersBatchUpdateRequest(BaseModel):
    """Batch update request"""
    items: List[Af_usersBatchUpdateItem]


class Af_usersBatchDeleteRequest(BaseModel):
    """Batch delete request"""
    ids: List[int]


# ---------- Routes ----------
@router.get("", response_model=Af_usersListResponse)
async def query_af_userss(
    query: str = Query(None, description='Query conditions as JSON, e.g. {"id":2} or {"id":{"$gte":2}}'),
    sort: str = Query(None, description="Sort field (prefix with '-' for descending)"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(20, ge=1, le=2000, description="Max number of records to return"),
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    db: AsyncSession = Depends(get_db),
):
    """Query af_userss with filtering, sorting, and pagination"""
    logger.debug(f"Querying af_userss: query={query}, sort={sort}, skip={skip}, limit={limit}, fields={fields}")
    
    service = Af_usersService(db)
    try:
        # Parse query JSON if provided
        query_dict = None
        if query:
            try:
                query_dict = json.loads(query)
            except json.JSONDecodeError:
                raise HTTPException(status_code=400, detail="Invalid query JSON format")
        
        result = await service.get_list(
            skip=skip, 
            limit=limit,
            query_dict=query_dict,
            sort=sort,
        )
        logger.debug(f"Found {result['total']} af_userss")
        return result
    except HTTPException:
        raise
    except ValueError as e:
        logger.warning(f"Invalid af_users query: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error querying af_userss: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/all", response_model=Af_usersListResponse)
async def query_af_userss_all(
    query: str = Query(None, description='Query conditions as JSON, e.g. {"id":2} or {"id":{"$gte":2}}'),
    sort: str = Query(None, description="Sort field (prefix with '-' for descending)"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(20, ge=1, le=2000, description="Max number of records to return"),
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    db: AsyncSession = Depends(get_db),
):
    # Query af_userss with filtering, sorting, and pagination without user limitation
    logger.debug(f"Querying af_userss: query={query}, sort={sort}, skip={skip}, limit={limit}, fields={fields}")

    service = Af_usersService(db)
    try:
        # Parse query JSON if provided
        query_dict = None
        if query:
            try:
                query_dict = json.loads(query)
            except json.JSONDecodeError:
                raise HTTPException(status_code=400, detail="Invalid query JSON format")

        result = await service.get_list(
            skip=skip,
            limit=limit,
            query_dict=query_dict,
            sort=sort
        )
        logger.debug(f"Found {result['total']} af_userss")
        return result
    except HTTPException:
        raise
    except ValueError as e:
        logger.warning(f"Invalid af_users query: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error querying af_userss: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/{id}", response_model=Af_usersResponse)
async def get_af_users(
    id: int,
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    db: AsyncSession = Depends(get_db),
):
    """Get a single af_users by ID"""
    logger.debug(f"Fetching af_users with id: {id}, fields={fields}")
    
    service = Af_usersService(db)
    try:
        result = await service.get_by_id(id)
        if not result:
            logger.warning(f"Af_users with id {id} not found")
            raise HTTPException(status_code=404, detail="Af_users not found")
        
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching af_users {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("", response_model=Af_usersResponse, status_code=201)
async def create_af_users(
    data: Af_usersData,
    db: AsyncSession = Depends(get_db),
):
    """Create a new af_users"""
    logger.debug(f"Creating new af_users with data: {data}")
    
    service = Af_usersService(db)
    try:
        result = await service.create(data.model_dump())
        if not result:
            raise HTTPException(status_code=400, detail="Failed to create af_users")
        
        logger.info(f"Af_users created successfully with id: {result.id}")
        return result
    except ValueError as e:
        logger.error(f"Validation error creating af_users: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error creating af_users: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("/batch", response_model=List[Af_usersResponse], status_code=201)
async def create_af_userss_batch(
    request: Af_usersBatchCreateRequest,
    db: AsyncSession = Depends(get_db),
):
    """Create multiple af_userss in a single request"""
    logger.debug(f"Batch creating {len(request.items)} af_userss")
    
    service = Af_usersService(db)
    results = []
    
    try:
        for item_data in request.items:
            result = await service.create(item_data.model_dump())
            if result:
                results.append(result)
        
        logger.info(f"Batch created {len(results)} af_userss successfully")
        return results
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch create: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch create failed: {str(e)}")


@router.put("/batch", response_model=List[Af_usersResponse])
async def update_af_userss_batch(
    request: Af_usersBatchUpdateRequest,
    db: AsyncSession = Depends(get_db),
):
    """Update multiple af_userss in a single request"""
    logger.debug(f"Batch updating {len(request.items)} af_userss")
    
    service = Af_usersService(db)
    results = []
    
    try:
        for item in request.items:
            # Only include non-None values for partial updates
            update_dict = {k: v for k, v in item.updates.model_dump().items() if v is not None}
            result = await service.update(item.id, update_dict)
            if result:
                results.append(result)
        
        logger.info(f"Batch updated {len(results)} af_userss successfully")
        return results
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch update: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch update failed: {str(e)}")


@router.put("/{id}", response_model=Af_usersResponse)
async def update_af_users(
    id: int,
    data: Af_usersUpdateData,
    db: AsyncSession = Depends(get_db),
):
    """Update an existing af_users"""
    logger.debug(f"Updating af_users {id} with data: {data}")

    service = Af_usersService(db)
    try:
        # Only include non-None values for partial updates
        update_dict = {k: v for k, v in data.model_dump().items() if v is not None}
        result = await service.update(id, update_dict)
        if not result:
            logger.warning(f"Af_users with id {id} not found for update")
            raise HTTPException(status_code=404, detail="Af_users not found")
        
        logger.info(f"Af_users {id} updated successfully")
        return result
    except HTTPException:
        raise
    except ValueError as e:
        logger.error(f"Validation error updating af_users {id}: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error updating af_users {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.delete("/batch")
async def delete_af_userss_batch(
    request: Af_usersBatchDeleteRequest,
    db: AsyncSession = Depends(get_db),
):
    """Delete multiple af_userss by their IDs"""
    logger.debug(f"Batch deleting {len(request.ids)} af_userss")
    
    service = Af_usersService(db)
    deleted_count = 0
    
    try:
        for item_id in request.ids:
            success = await service.delete(item_id)
            if success:
                deleted_count += 1
        
        logger.info(f"Batch deleted {deleted_count} af_userss successfully")
        return {"message": f"Successfully deleted {deleted_count} af_userss", "deleted_count": deleted_count}
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch delete: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch delete failed: {str(e)}")


@router.delete("/{id}")
async def delete_af_users(
    id: int,
    db: AsyncSession = Depends(get_db),
):
    """Delete a single af_users by ID"""
    logger.debug(f"Deleting af_users with id: {id}")
    
    service = Af_usersService(db)
    try:
        success = await service.delete(id)
        if not success:
            logger.warning(f"Af_users with id {id} not found for deletion")
            raise HTTPException(status_code=404, detail="Af_users not found")
        
        logger.info(f"Af_users {id} deleted successfully")
        return {"message": "Af_users deleted successfully", "id": id}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting af_users {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")