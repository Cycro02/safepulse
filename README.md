# 🏥 SafePulse - Sistema de Pulseras NFC de Emergencia

Sistema completo para gestionar pulseras NFC de emergencia médica, con panel de administración y API REST.

## 🚀 Despliegue Rápido

```bash
# 1. Clonar o subir archivos al servidor
git clone <tu-repo> /home/safepulse/app

# 2. Configurar variables
cp .env.example .env
nano .env

# 3. Compilar frontend
cd frontend && npm install && npm run build && cd ..

# 4. Levantar todo
docker compose up -d
```

## 📁 Estructura

```
├── docker-compose.yml    # Orquestación de servicios
├── backend/              # API FastAPI + PostgreSQL
├── frontend/             # React + Vite
├── nginx/                # Servidor web + proxy
└── GUIA-VPS-HETZNER.md   # Guía paso a paso
```

## 🔐 Credenciales por defecto

- **Usuario:** admin
- **Contraseña:** admin

⚠️ **Cambiar en producción**

## 💰 Costo

- VPS Hetzner CX22: **€3.29/mes**
- Dominio (opcional): ~€10/año

## 📖 Documentación

- [Guía completa de despliegue](GUIA-VPS-HETZNER.md)
- API Docs: `http://tu-servidor/docs`

## 🛠️ Tecnologías

- **Frontend:** React, Vite, Recharts
- **Backend:** FastAPI, Python 3.11
- **Base de datos:** PostgreSQL 15
- **Servidor:** Nginx
- **Contenedores:** Docker Compose
