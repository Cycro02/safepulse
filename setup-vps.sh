#!/bin/bash

# ═══════════════════════════════════════════════════════════════
# SafePulse - Script de Instalación para VPS Ubuntu 22.04/24.04
# ═══════════════════════════════════════════════════════════════
# Ejecutar como root: sudo bash setup-vps.sh

set -e  # Detener si hay errores

echo "╔═══════════════════════════════════════════════════════════╗"
echo "║     🏥 SafePulse - Instalación en VPS                     ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo ""

# Colores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # Sin color

# ─────────────────────────────────────────────
# 1. ACTUALIZAR SISTEMA
# ─────────────────────────────────────────────
echo -e "${YELLOW}[1/6]${NC} Actualizando sistema..."
apt update && apt upgrade -y

# ─────────────────────────────────────────────
# 2. INSTALAR DOCKER
# ─────────────────────────────────────────────
echo -e "${YELLOW}[2/6]${NC} Instalando Docker..."

if ! command -v docker &> /dev/null; then
    # Dependencias
    apt install -y ca-certificates curl gnupg lsb-release

    # Agregar repositorio oficial de Docker
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg

    echo \
      "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
      $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
      tee /etc/apt/sources.list.d/docker.list > /dev/null

    apt update
    apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

    # Habilitar Docker al inicio
    systemctl enable docker
    systemctl start docker
    
    echo -e "${GREEN}✓ Docker instalado${NC}"
else
    echo -e "${GREEN}✓ Docker ya está instalado${NC}"
fi

# ─────────────────────────────────────────────
# 3. INSTALAR NODE.JS (para compilar frontend)
# ─────────────────────────────────────────────
echo -e "${YELLOW}[3/6]${NC} Instalando Node.js..."

if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt install -y nodejs
    echo -e "${GREEN}✓ Node.js instalado: $(node -v)${NC}"
else
    echo -e "${GREEN}✓ Node.js ya está instalado: $(node -v)${NC}"
fi

# ─────────────────────────────────────────────
# 4. CONFIGURAR FIREWALL
# ─────────────────────────────────────────────
echo -e "${YELLOW}[4/6]${NC} Configurando firewall..."

apt install -y ufw
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo -e "${GREEN}✓ Firewall configurado (SSH, HTTP, HTTPS)${NC}"

# ─────────────────────────────────────────────
# 5. CREAR USUARIO PARA LA APP
# ─────────────────────────────────────────────
echo -e "${YELLOW}[5/6]${NC} Creando usuario safepulse..."

if ! id "safepulse" &>/dev/null; then
    useradd -m -s /bin/bash safepulse
    usermod -aG docker safepulse
    echo -e "${GREEN}✓ Usuario 'safepulse' creado${NC}"
else
    echo -e "${GREEN}✓ Usuario 'safepulse' ya existe${NC}"
fi

# ─────────────────────────────────────────────
# 6. CREAR DIRECTORIO DE LA APP
# ─────────────────────────────────────────────
echo -e "${YELLOW}[6/6]${NC} Preparando directorio de la aplicación..."

APP_DIR="/home/safepulse/app"
mkdir -p $APP_DIR
chown -R safepulse:safepulse /home/safepulse

echo ""
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║     ✅ INSTALACIÓN COMPLETADA                             ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo ""
echo -e "${GREEN}Próximos pasos:${NC}"
echo ""
echo "1. Sube los archivos del proyecto a: $APP_DIR"
echo ""
echo "2. Crea el archivo .env:"
echo "   cd $APP_DIR"
echo "   cp .env.example .env"
echo "   nano .env  # Edita las contraseñas"
echo ""
echo "3. Compila el frontend:"
echo "   cd $APP_DIR/frontend"
echo "   npm install && npm run build"
echo ""
echo "4. Inicia los servicios:"
echo "   cd $APP_DIR"
echo "   docker compose up -d"
echo ""
echo "5. Verifica que todo funciona:"
echo "   docker compose ps"
echo "   curl http://localhost/health"
echo ""
echo -e "${YELLOW}Tu aplicación estará disponible en:${NC}"
echo "   http://$(curl -s ifconfig.me)"
echo ""
