# 🚀 Guía: SafePulse en VPS Hetzner con Docker

## Costo Total: ~€3.29/mes 🔥

---

## PASO 1: Crear VPS en Hetzner (5 minutos)

### 1.1 Crear cuenta
1. Ve a [hetzner.com/cloud](https://www.hetzner.com/cloud)
2. Crea una cuenta (necesitas tarjeta de crédito)

### 1.2 Crear servidor
1. Click en **"Add Server"**
2. Configuración:

| Opción | Selección |
|--------|-----------|
| **Location** | Nuremberg o Helsinki (más baratos) |
| **Image** | Ubuntu 24.04 |
| **Type** | CX22 (€3.29/mes) - 2 vCPU, 4GB RAM |
| **SSH Key** | Añade tu clave SSH (recomendado) |
| **Name** | `safepulse` |

3. Click **"Create & Buy now"**

### 1.3 Obtener IP
Una vez creado, copia la **IP pública** (ej: `65.108.xxx.xxx`)

---

## PASO 2: Conectar al servidor (2 minutos)

### Desde tu computadora:

```bash
# Con SSH key
ssh root@TU_IP_DEL_SERVIDOR

# O con contraseña (te la envían por email)
ssh root@TU_IP_DEL_SERVIDOR
```

---

## PASO 3: Instalar dependencias (5 minutos)

### 3.1 Subir el script de instalación

Desde tu computadora local:
```bash
scp setup-vps.sh root@TU_IP:/root/
```

### 3.2 Ejecutar instalación

En el servidor:
```bash
chmod +x setup-vps.sh
./setup-vps.sh
```

Esto instala: Docker, Node.js, Firewall configurado.

---

## PASO 4: Subir los archivos del proyecto (3 minutos)

### Desde tu computadora local:

```bash
# Subir todo el proyecto
scp -r safepulse-vps/* root@TU_IP:/home/safepulse/app/
```

### O con Git (recomendado):

```bash
# En el servidor
cd /home/safepulse/app
git clone https://github.com/tu-usuario/safepulse.git .
```

---

## PASO 5: Configurar variables de entorno (2 minutos)

En el servidor:
```bash
cd /home/safepulse/app

# Crear archivo .env
cp .env.example .env

# Editar contraseñas
nano .env
```

Cambia estos valores:
```env
DB_PASSWORD=UnaContraseñaMuySegura123!
SECRET_KEY=genera-una-clave-aleatoria-de-32-caracteres-minimo
```

**Generar clave aleatoria:**
```bash
openssl rand -hex 32
```

---

## PASO 6: Compilar el Frontend (2 minutos)

```bash
cd /home/safepulse/app/frontend

# Instalar dependencias
npm install

# Compilar para producción
npm run build
```

Esto crea la carpeta `dist/` con los archivos estáticos.

---

## PASO 7: Levantar los servicios (1 minuto)

```bash
cd /home/safepulse/app

# Levantar todo
docker compose up -d

# Ver logs
docker compose logs -f

# Verificar que todo está corriendo
docker compose ps
```

Deberías ver:
```
NAME              STATUS
safepulse-db      running (healthy)
safepulse-api     running
safepulse-web     running
```

---

## PASO 8: ¡Probar! 🎉

Abre en tu navegador:
```
http://TU_IP_DEL_SERVIDOR
```

**Login:** admin / admin

---

## PASO 9: Configurar Dominio + SSL (Opcional pero recomendado)

### 9.1 Comprar dominio
- [Namecheap](https://namecheap.com) - ~$10/año
- [Cloudflare](https://cloudflare.com) - ~$10/año

### 9.2 Configurar DNS
En tu proveedor de dominio, añade:
```
Tipo: A
Nombre: @ (o safepulse)
Valor: TU_IP_DEL_SERVIDOR
TTL: 3600
```

### 9.3 Configurar SSL con Let's Encrypt

```bash
cd /home/safepulse/app

# Crear directorios para certificados
mkdir -p certbot/conf certbot/www

# Obtener certificado
docker compose run --rm certbot certonly \
  --webroot \
  --webroot-path=/var/www/certbot \
  -d tu-dominio.com \
  --email tu@email.com \
  --agree-tos

# Editar nginx.conf para habilitar HTTPS
nano nginx/nginx.conf
# Descomentar la sección del servidor HTTPS

# Reiniciar nginx
docker compose restart nginx
```

---

## 📋 Comandos Útiles

### Ver logs en tiempo real
```bash
docker compose logs -f
```

### Reiniciar servicios
```bash
docker compose restart
```

### Ver uso de recursos
```bash
docker stats
```

### Backup de la base de datos
```bash
docker compose exec db pg_dump -U safepulse safepulse > backup.sql
```

### Restaurar backup
```bash
cat backup.sql | docker compose exec -T db psql -U safepulse safepulse
```

### Actualizar la aplicación
```bash
cd /home/safepulse/app
git pull
cd frontend && npm run build && cd ..
docker compose up -d --build
```

### Ver espacio en disco
```bash
df -h
docker system df
```

### Limpiar espacio (imágenes no usadas)
```bash
docker system prune -a
```

---

## 🔒 Seguridad Adicional

### Cambiar contraseña de admin
Edita `backend/main.py` y cambia el hash:

```python
# Genera nuevo hash
import hashlib
print(hashlib.sha256("tu-nueva-contraseña".encode()).hexdigest())

# Reemplaza ADMIN_PASSWORD_HASH
```

Luego:
```bash
docker compose up -d --build backend
```

### Configurar fail2ban (protección contra ataques)
```bash
apt install fail2ban
systemctl enable fail2ban
```

### Actualizaciones automáticas de seguridad
```bash
apt install unattended-upgrades
dpkg-reconfigure unattended-upgrades
```

---

## 🐛 Solución de Problemas

### "Connection refused"
```bash
# Verificar que los contenedores están corriendo
docker compose ps

# Ver logs de error
docker compose logs backend
```

### "Database connection error"
```bash
# Verificar que la DB está lista
docker compose logs db

# Reiniciar la DB
docker compose restart db
```

### "502 Bad Gateway"
```bash
# El backend no está listo, espera unos segundos
docker compose logs backend

# O reinicia todo
docker compose down && docker compose up -d
```

### Página en blanco
```bash
# Verifica que el frontend está compilado
ls frontend/dist/

# Si no hay archivos:
cd frontend && npm run build
```

---

## 📊 Monitoreo

### Instalar Uptime Kuma (monitor gratuito)
```bash
docker run -d \
  --name uptime-kuma \
  -p 3001:3001 \
  --restart always \
  louislam/uptime-kuma:1
```

Accede en `http://TU_IP:3001`

---

## 📁 Estructura Final

```
/home/safepulse/app/
├── docker-compose.yml
├── .env
├── setup-vps.sh
├── backend/
│   ├── Dockerfile
│   ├── main.py
│   └── requirements.txt
├── frontend/
│   ├── dist/          # Archivos compilados
│   ├── src/
│   │   ├── SafePulse.jsx
│   │   ├── App.jsx
│   │   └── main.jsx
│   ├── package.json
│   └── vite.config.js
├── nginx/
│   └── nginx.conf
└── certbot/           # Certificados SSL
    ├── conf/
    └── www/
```

---

## ✅ Checklist Final

- [ ] VPS creado en Hetzner
- [ ] Script de instalación ejecutado
- [ ] Archivos subidos al servidor
- [ ] Variables de entorno configuradas (.env)
- [ ] Frontend compilado (npm run build)
- [ ] Docker Compose levantado
- [ ] Acceso web funcionando
- [ ] Login con admin/admin exitoso
- [ ] Crear/editar usuarios funciona
- [ ] (Opcional) Dominio configurado
- [ ] (Opcional) SSL habilitado
- [ ] Contraseña de admin cambiada

---

¡Listo! 🎉 Tu SafePulse está corriendo en tu propio servidor por €3.29/mes.
