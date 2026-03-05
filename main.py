"""
SafePulse API - Backend Python con FastAPI
==========================================
API REST completa para gestión de pulseras médicas de emergencia
"""

from fastapi import FastAPI, HTTPException, Depends, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime, timedelta
import hashlib
import secrets
import os
from contextlib import asynccontextmanager

# Database
import asyncpg
from asyncpg import Pool

# ═══════════════════════════════════════════
#  CONFIGURACIÓN
# ═══════════════════════════════════════════

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://user:password@localhost:5432/safepulse")
SECRET_KEY = os.getenv("SECRET_KEY", "tu-clave-secreta-cambiar-en-produccion")
ADMIN_PASSWORD_HASH = "8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918"  # "admin"

# Pool de conexiones global
db_pool: Pool = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manejo del ciclo de vida de la aplicación"""
    global db_pool
    # Startup
    db_pool = await asyncpg.create_pool(DATABASE_URL, min_size=2, max_size=10)
    await init_database()
    yield
    # Shutdown
    await db_pool.close()

app = FastAPI(
    title="SafePulse API",
    description="API para gestión de pulseras médicas de emergencia",
    version="1.0.0",
    lifespan=lifespan
)

# CORS - Permitir frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # En producción, especifica tu dominio
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

security = HTTPBearer()

# ═══════════════════════════════════════════
#  MODELOS PYDANTIC
# ═══════════════════════════════════════════

class Contact(BaseModel):
    name: str
    relation: str
    phone: str
    emoji: str = "👤"

class UserCreate(BaseModel):
    name: str
    dni: str
    photo: str = "👤"
    bloodType: str
    condition: str
    allergies: List[str] = []
    meds: List[str] = []
    observation: str = ""
    contacts: List[Contact] = []
    braceletColor: str = "Negro"

class UserUpdate(BaseModel):
    name: Optional[str] = None
    dni: Optional[str] = None
    photo: Optional[str] = None
    bloodType: Optional[str] = None
    condition: Optional[str] = None
    allergies: Optional[List[str]] = None
    meds: Optional[List[str]] = None
    observation: Optional[str] = None
    contacts: Optional[List[Contact]] = None
    braceletColor: Optional[str] = None
    status: Optional[str] = None

class UserResponse(BaseModel):
    id: str
    nfcId: str
    name: str
    dni: str
    photo: str
    bloodType: str
    condition: str
    allergies: List[str]
    meds: List[str]
    observation: str
    contacts: List[Contact]
    braceletColor: str
    status: str
    createdAt: str

class ScanCreate(BaseModel):
    userId: str
    type: str  # emergency, lost, info
    location: str
    scannerPhone: str = ""
    notes: str = ""

class ScanResponse(BaseModel):
    id: str
    userId: str
    ts: str
    type: str
    location: str
    scannerPhone: str
    notes: str

class LoginRequest(BaseModel):
    password: str

class TokenResponse(BaseModel):
    token: str
    expiresIn: int

class AuditEntry(BaseModel):
    id: str
    action: str
    detail: str
    ts: str

# ═══════════════════════════════════════════
#  BASE DE DATOS
# ═══════════════════════════════════════════

async def init_database():
    """Crear tablas si no existen"""
    async with db_pool.acquire() as conn:
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id VARCHAR(50) PRIMARY KEY,
                nfc_id VARCHAR(20) UNIQUE NOT NULL,
                name VARCHAR(200) NOT NULL,
                dni VARCHAR(30) NOT NULL,
                photo VARCHAR(10) DEFAULT '👤',
                blood_type VARCHAR(10) NOT NULL,
                condition VARCHAR(200) NOT NULL,
                allergies JSONB DEFAULT '[]',
                meds JSONB DEFAULT '[]',
                observation TEXT DEFAULT '',
                contacts JSONB DEFAULT '[]',
                bracelet_color VARCHAR(50) DEFAULT 'Negro',
                status VARCHAR(20) DEFAULT 'active',
                created_at TIMESTAMP DEFAULT NOW()
            );
            
            CREATE TABLE IF NOT EXISTS scans (
                id VARCHAR(50) PRIMARY KEY,
                user_id VARCHAR(50) REFERENCES users(id) ON DELETE CASCADE,
                ts TIMESTAMP DEFAULT NOW(),
                type VARCHAR(20) NOT NULL,
                location VARCHAR(500),
                scanner_phone VARCHAR(50),
                notes TEXT
            );
            
            CREATE TABLE IF NOT EXISTS audit (
                id VARCHAR(50) PRIMARY KEY,
                action VARCHAR(100) NOT NULL,
                detail TEXT,
                ts TIMESTAMP DEFAULT NOW()
            );
            
            CREATE TABLE IF NOT EXISTS sessions (
                token VARCHAR(100) PRIMARY KEY,
                created_at TIMESTAMP DEFAULT NOW(),
                expires_at TIMESTAMP NOT NULL
            );
            
            CREATE INDEX IF NOT EXISTS idx_users_nfc ON users(nfc_id);
            CREATE INDEX IF NOT EXISTS idx_scans_user ON scans(user_id);
            CREATE INDEX IF NOT EXISTS idx_scans_ts ON scans(ts DESC);
            CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit(ts DESC);
        """)

async def get_db():
    """Obtener conexión de la pool"""
    async with db_pool.acquire() as conn:
        yield conn

# ═══════════════════════════════════════════
#  AUTENTICACIÓN
# ═══════════════════════════════════════════

def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()

def generate_token() -> str:
    return secrets.token_urlsafe(32)

async def verify_token(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Verificar token de sesión"""
    token = credentials.credentials
    async with db_pool.acquire() as conn:
        session = await conn.fetchrow(
            "SELECT * FROM sessions WHERE token = $1 AND expires_at > NOW()",
            token
        )
        if not session:
            raise HTTPException(status_code=401, detail="Token inválido o expirado")
    return token

async def add_audit(action: str, detail: str):
    """Agregar entrada de auditoría"""
    async with db_pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO audit (id, action, detail) VALUES ($1, $2, $3)",
            f"a_{secrets.token_hex(8)}", action, detail
        )

# ═══════════════════════════════════════════
#  ENDPOINTS: AUTENTICACIÓN
# ═══════════════════════════════════════════

@app.post("/api/auth/login", response_model=TokenResponse)
async def login(request: LoginRequest):
    """Iniciar sesión"""
    password_hash = hash_password(request.password)
    
    if password_hash != ADMIN_PASSWORD_HASH:
        raise HTTPException(status_code=401, detail="Contraseña incorrecta")
    
    token = generate_token()
    expires_at = datetime.now() + timedelta(hours=24)
    
    async with db_pool.acquire() as conn:
        # Limpiar sesiones expiradas
        await conn.execute("DELETE FROM sessions WHERE expires_at < NOW()")
        # Crear nueva sesión
        await conn.execute(
            "INSERT INTO sessions (token, expires_at) VALUES ($1, $2)",
            token, expires_at
        )
    
    await add_audit("LOGIN", "Inicio de sesión exitoso")
    
    return TokenResponse(token=token, expiresIn=86400)

@app.post("/api/auth/logout")
async def logout(token: str = Depends(verify_token)):
    """Cerrar sesión"""
    async with db_pool.acquire() as conn:
        await conn.execute("DELETE FROM sessions WHERE token = $1", token)
    return {"message": "Sesión cerrada"}

# ═══════════════════════════════════════════
#  ENDPOINTS: USUARIOS
# ═══════════════════════════════════════════

@app.get("/api/users", response_model=List[UserResponse])
async def get_users(token: str = Depends(verify_token)):
    """Obtener todos los usuarios"""
    async with db_pool.acquire() as conn:
        rows = await conn.fetch("SELECT * FROM users ORDER BY created_at DESC")
        return [
            UserResponse(
                id=r["id"],
                nfcId=r["nfc_id"],
                name=r["name"],
                dni=r["dni"],
                photo=r["photo"],
                bloodType=r["blood_type"],
                condition=r["condition"],
                allergies=r["allergies"] or [],
                meds=r["meds"] or [],
                observation=r["observation"] or "",
                contacts=r["contacts"] or [],
                braceletColor=r["bracelet_color"],
                status=r["status"],
                createdAt=r["created_at"].isoformat()
            ) for r in rows
        ]

@app.get("/api/users/{user_id}", response_model=UserResponse)
async def get_user(user_id: str, token: str = Depends(verify_token)):
    """Obtener usuario por ID"""
    async with db_pool.acquire() as conn:
        r = await conn.fetchrow("SELECT * FROM users WHERE id = $1", user_id)
        if not r:
            raise HTTPException(status_code=404, detail="Usuario no encontrado")
        return UserResponse(
            id=r["id"],
            nfcId=r["nfc_id"],
            name=r["name"],
            dni=r["dni"],
            photo=r["photo"],
            bloodType=r["blood_type"],
            condition=r["condition"],
            allergies=r["allergies"] or [],
            meds=r["meds"] or [],
            observation=r["observation"] or "",
            contacts=r["contacts"] or [],
            braceletColor=r["bracelet_color"],
            status=r["status"],
            createdAt=r["created_at"].isoformat()
        )

@app.post("/api/users", response_model=UserResponse)
async def create_user(user: UserCreate, token: str = Depends(verify_token)):
    """Crear nuevo usuario"""
    async with db_pool.acquire() as conn:
        # Generar NFC ID
        count = await conn.fetchval("SELECT COUNT(*) FROM users")
        nfc_id = f"NFC-{str(count + 1).zfill(4)}"
        user_id = f"p_{secrets.token_hex(8)}"
        
        await conn.execute("""
            INSERT INTO users (id, nfc_id, name, dni, photo, blood_type, condition, 
                             allergies, meds, observation, contacts, bracelet_color)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        """, user_id, nfc_id, user.name, user.dni, user.photo, user.bloodType,
            user.condition, user.allergies, user.meds, user.observation,
            [c.dict() for c in user.contacts], user.braceletColor)
        
        await add_audit("REGISTRO", f"Nueva pulsera: {user.name} ({nfc_id})")
        
        r = await conn.fetchrow("SELECT * FROM users WHERE id = $1", user_id)
        return UserResponse(
            id=r["id"],
            nfcId=r["nfc_id"],
            name=r["name"],
            dni=r["dni"],
            photo=r["photo"],
            bloodType=r["blood_type"],
            condition=r["condition"],
            allergies=r["allergies"] or [],
            meds=r["meds"] or [],
            observation=r["observation"] or "",
            contacts=r["contacts"] or [],
            braceletColor=r["bracelet_color"],
            status=r["status"],
            createdAt=r["created_at"].isoformat()
        )

@app.put("/api/users/{user_id}", response_model=UserResponse)
async def update_user(user_id: str, user: UserUpdate, token: str = Depends(verify_token)):
    """Actualizar usuario"""
    async with db_pool.acquire() as conn:
        existing = await conn.fetchrow("SELECT * FROM users WHERE id = $1", user_id)
        if not existing:
            raise HTTPException(status_code=404, detail="Usuario no encontrado")
        
        # Construir query dinámico
        updates = []
        values = []
        idx = 1
        
        field_mapping = {
            "name": "name", "dni": "dni", "photo": "photo",
            "bloodType": "blood_type", "condition": "condition",
            "allergies": "allergies", "meds": "meds",
            "observation": "observation", "braceletColor": "bracelet_color",
            "status": "status"
        }
        
        for field, column in field_mapping.items():
            value = getattr(user, field, None)
            if value is not None:
                updates.append(f"{column} = ${idx}")
                values.append(value)
                idx += 1
        
        if user.contacts is not None:
            updates.append(f"contacts = ${idx}")
            values.append([c.dict() for c in user.contacts])
            idx += 1
        
        if updates:
            values.append(user_id)
            await conn.execute(
                f"UPDATE users SET {', '.join(updates)} WHERE id = ${idx}",
                *values
            )
        
        await add_audit("EDICIÓN", f"Actualizado: {user.name or existing['name']}")
        
        r = await conn.fetchrow("SELECT * FROM users WHERE id = $1", user_id)
        return UserResponse(
            id=r["id"],
            nfcId=r["nfc_id"],
            name=r["name"],
            dni=r["dni"],
            photo=r["photo"],
            bloodType=r["blood_type"],
            condition=r["condition"],
            allergies=r["allergies"] or [],
            meds=r["meds"] or [],
            observation=r["observation"] or "",
            contacts=r["contacts"] or [],
            braceletColor=r["bracelet_color"],
            status=r["status"],
            createdAt=r["created_at"].isoformat()
        )

@app.delete("/api/users/{user_id}")
async def delete_user(user_id: str, token: str = Depends(verify_token)):
    """Eliminar usuario"""
    async with db_pool.acquire() as conn:
        user = await conn.fetchrow("SELECT name FROM users WHERE id = $1", user_id)
        if not user:
            raise HTTPException(status_code=404, detail="Usuario no encontrado")
        
        await conn.execute("DELETE FROM users WHERE id = $1", user_id)
        await add_audit("ELIMINADO", f"Pulsera desactivada: {user['name']}")
        
    return {"message": "Usuario eliminado"}

@app.patch("/api/users/{user_id}/toggle-status")
async def toggle_user_status(user_id: str, token: str = Depends(verify_token)):
    """Cambiar estado activo/inactivo"""
    async with db_pool.acquire() as conn:
        user = await conn.fetchrow("SELECT name, status FROM users WHERE id = $1", user_id)
        if not user:
            raise HTTPException(status_code=404, detail="Usuario no encontrado")
        
        new_status = "inactive" if user["status"] == "active" else "active"
        await conn.execute("UPDATE users SET status = $1 WHERE id = $2", new_status, user_id)
        await add_audit("ESTADO", f"{user['name']} → {'Activa' if new_status == 'active' else 'Desactivada'}")
        
    return {"status": new_status}

# ═══════════════════════════════════════════
#  ENDPOINTS: ESCANEOS
# ═══════════════════════════════════════════

@app.get("/api/scans", response_model=List[ScanResponse])
async def get_scans(token: str = Depends(verify_token)):
    """Obtener todos los escaneos"""
    async with db_pool.acquire() as conn:
        rows = await conn.fetch("SELECT * FROM scans ORDER BY ts DESC")
        return [
            ScanResponse(
                id=r["id"],
                userId=r["user_id"],
                ts=r["ts"].isoformat(),
                type=r["type"],
                location=r["location"] or "",
                scannerPhone=r["scanner_phone"] or "",
                notes=r["notes"] or ""
            ) for r in rows
        ]

@app.post("/api/scans", response_model=ScanResponse)
async def create_scan(scan: ScanCreate, token: str = Depends(verify_token)):
    """Registrar nuevo escaneo"""
    scan_id = f"s_{secrets.token_hex(8)}"
    
    async with db_pool.acquire() as conn:
        await conn.execute("""
            INSERT INTO scans (id, user_id, type, location, scanner_phone, notes)
            VALUES ($1, $2, $3, $4, $5, $6)
        """, scan_id, scan.userId, scan.type, scan.location, scan.scannerPhone, scan.notes)
        
        r = await conn.fetchrow("SELECT * FROM scans WHERE id = $1", scan_id)
        return ScanResponse(
            id=r["id"],
            userId=r["user_id"],
            ts=r["ts"].isoformat(),
            type=r["type"],
            location=r["location"] or "",
            scannerPhone=r["scanner_phone"] or "",
            notes=r["notes"] or ""
        )

# ═══════════════════════════════════════════
#  ENDPOINTS: AUDITORÍA Y ESTADÍSTICAS
# ═══════════════════════════════════════════

@app.get("/api/audit", response_model=List[AuditEntry])
async def get_audit(limit: int = 100, token: str = Depends(verify_token)):
    """Obtener log de auditoría"""
    async with db_pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT * FROM audit ORDER BY ts DESC LIMIT $1", limit
        )
        return [
            AuditEntry(
                id=r["id"],
                action=r["action"],
                detail=r["detail"] or "",
                ts=r["ts"].isoformat()
            ) for r in rows
        ]

@app.get("/api/stats")
async def get_stats(token: str = Depends(verify_token)):
    """Obtener estadísticas del dashboard"""
    async with db_pool.acquire() as conn:
        # Conteos básicos
        total_users = await conn.fetchval("SELECT COUNT(*) FROM users")
        active_users = await conn.fetchval("SELECT COUNT(*) FROM users WHERE status = 'active'")
        total_scans = await conn.fetchval("SELECT COUNT(*) FROM scans")
        emergencies = await conn.fetchval("SELECT COUNT(*) FROM scans WHERE type = 'emergency'")
        lost = await conn.fetchval("SELECT COUNT(*) FROM scans WHERE type = 'lost'")
        
        # Tipos de sangre
        blood_types = await conn.fetch("""
            SELECT blood_type as name, COUNT(*) as value 
            FROM users GROUP BY blood_type ORDER BY value DESC
        """)
        
        # Condiciones
        conditions = await conn.fetch("""
            SELECT condition as name, COUNT(*) as value 
            FROM users GROUP BY condition ORDER BY value DESC
        """)
        
        return {
            "total": total_users,
            "active": active_users,
            "inactive": total_users - active_users,
            "totalScans": total_scans,
            "emergencies": emergencies,
            "lost": lost,
            "info": total_scans - emergencies - lost,
            "bloodTypes": [{"name": r["name"], "value": r["value"]} for r in blood_types],
            "conditions": [{"name": r["name"], "value": r["value"]} for r in conditions]
        }

# ═══════════════════════════════════════════
#  ENDPOINT PÚBLICO: ESCANEO NFC
# ═══════════════════════════════════════════

@app.get("/api/public/scan/{nfc_id}")
async def public_scan(nfc_id: str):
    """
    Endpoint público para cuando alguien escanea una pulsera NFC.
    No requiere autenticación - es lo que ve el rescatista.
    """
    async with db_pool.acquire() as conn:
        user = await conn.fetchrow(
            "SELECT * FROM users WHERE nfc_id = $1 AND status = 'active'",
            nfc_id
        )
        
        if not user:
            raise HTTPException(status_code=404, detail="Pulsera no encontrada o inactiva")
        
        # Retornar solo información médica esencial
        return {
            "name": user["name"],
            "photo": user["photo"],
            "bloodType": user["blood_type"],
            "condition": user["condition"],
            "allergies": user["allergies"] or [],
            "meds": user["meds"] or [],
            "observation": user["observation"],
            "contacts": user["contacts"] or [],
            "braceletColor": user["bracelet_color"]
        }

# ═══════════════════════════════════════════
#  HEALTH CHECK
# ═══════════════════════════════════════════

@app.get("/health")
async def health_check():
    """Verificar estado del servicio"""
    return {"status": "healthy", "service": "SafePulse API"}

@app.get("/")
async def root():
    """Raíz de la API"""
    return {
        "service": "SafePulse API",
        "version": "1.0.0",
        "docs": "/docs"
    }
