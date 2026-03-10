# WAME — WhatsApp Sender Microservice

Microservicio minimalista para enviar mensajes de WhatsApp de forma programática a través de una API REST. Soporta múltiples instancias, sesiones persistentes y un dashboard web para administración.

## Características

- **API REST** con autenticación por API Key
- **Multi-instancia**: conecta múltiples números de WhatsApp simultáneamente
- **Sesiones persistentes**: las sesiones sobreviven reinicios del servidor
- **Tipos de mensaje**: texto, imágenes, audio, notas de voz y documentos
- **Soporte de grupos**: envío a grupos y listado de participantes
- **Registro de mensajes**: logging automático en Supabase
- **Dashboard web**: panel de control con interfaz visual para gestión de instancias
- **Docker ready**: despliegue con un solo comando
- **Seguridad**: Helmet, rate limiting, CORS, validación de inputs, comparación timing-safe de API keys
- **Monitor de actualizaciones**: verifica nuevas versiones de Baileys y dependencias críticas al iniciar
- **Apagado limpio**: cierra conexiones de WhatsApp correctamente con SIGTERM/SIGINT

## Requisitos previos

- Node.js 20+
- Cuenta de [Supabase](https://supabase.com) (para logging de mensajes)
- Docker y Docker Compose (opcional, para despliegue containerizado)

## Instalación

### Con Docker (recomendado)

1. Clona el repositorio:

```bash
git clone https://github.com/tu-usuario/wame.git
cd wame
```

2. Crea el archivo `.env` a partir del ejemplo:

```bash
cp .env.example .env
```

3. Edita `.env` con tus valores:

```env
API_KEY=tu-api-key-segura
PORT=3000
SESSION_DIR=/data/sessions
SUPABASE_URL=https://tu-proyecto.supabase.co
SUPABASE_SERVICE_ROLE_KEY=tu-service-role-key
```

4. Levanta el servicio:

```bash
docker compose up -d
```

### Sin Docker

1. Clona el repositorio e instala dependencias:

```bash
git clone https://github.com/tu-usuario/wame.git
cd wame
npm install
```

2. Crea y configura el archivo `.env` (ver paso anterior).

3. Inicia el servidor:

```bash
npm start
```

Para desarrollo con recarga automática:

```bash
npm run dev
```

## Variables de entorno

| Variable | Descripción | Valor por defecto |
|----------|-------------|-------------------|
| `API_KEY` | Clave secreta para autenticación de la API | — (obligatorio) |
| `PORT` | Puerto del servidor | `3000` |
| `SESSION_DIR` | Directorio para almacenar sesiones de WhatsApp | `/data/sessions` |
| `SUPABASE_URL` | URL de tu proyecto Supabase | — (obligatorio) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key de Supabase | — (obligatorio) |
| `RATE_LIMIT` | Máximo de peticiones por minuto (global) | `100` |
| `SEND_RATE_LIMIT` | Máximo de envíos por minuto por IP | `30` |
| `CORS_ORIGIN` | Origen permitido para CORS | `*` |

## Esquema de base de datos (Supabase)

Crea la tabla `whatsapp_logs` en tu proyecto Supabase:

```sql
CREATE TABLE whatsapp_logs (
  id BIGSERIAL PRIMARY KEY,
  instance TEXT NOT NULL,
  "to" TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

## Uso rápido

### 1. Conectar una instancia

```bash
curl -X POST http://localhost:3000/instances/mi-whatsapp/connect \
  -H "x-api-key: tu-api-key"
```

La respuesta incluirá un código QR en base64. Escanéalo con WhatsApp para vincular el dispositivo.

### 2. Enviar un mensaje de texto

```bash
curl -X POST http://localhost:3000/instances/mi-whatsapp/send \
  -H "x-api-key: tu-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "5491155551234",
    "type": "text",
    "text": "Hola desde WAME!"
  }'
```

### 3. Dashboard web

Accede a `http://localhost:3000` en tu navegador para usar el panel de administración visual.

## Endpoints de la API

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/health` | Health check (sin auth, para load balancers) |
| `GET` | `/status` | Estado de todas las instancias |
| `POST` | `/instances/:name/connect` | Conectar/reconectar instancia |
| `GET` | `/instances/:name/status` | Estado y QR de una instancia |
| `POST` | `/instances/:name/send` | Enviar mensaje |
| `GET` | `/instances/:name/groups` | Listar grupos |
| `DELETE` | `/instances/:name` | Desconectar y eliminar instancia |
| `GET` | `/logs` | Obtener registros de mensajes |

> Para documentación completa de la API con ejemplos de integración, consulta [API_DOCS.md](./API_DOCS.md).

## Tecnologías

- [Express](https://expressjs.com/) — Framework HTTP
- [Baileys](https://github.com/WhiskeySockets/Baileys) — Cliente de WhatsApp Web
- [Supabase](https://supabase.com/) — Base de datos para logging
- [Docker](https://www.docker.com/) — Containerización

## Licencia

MIT
