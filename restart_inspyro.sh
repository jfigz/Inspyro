#!/bin/bash

echo "🔄 REINICIANDO INSPYRO - Desarrollo Rápido"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Función para mostrar estado
show_status() {
    echo ""
    echo "📊 ESTADO DE PROCESOS:"
    BACKEND_PID=$(ps aux | grep "python main.py" | grep -v grep | awk '{print $2}' | head -1)
    FRONTEND_PID=$(ps aux | grep "npm.*start" | grep -v grep | awk '{print $2}' | head -1)
    
    if [ ! -z "$BACKEND_PID" ]; then
        echo "🐍 Backend:  ✅ Corriendo (PID: $BACKEND_PID)"
    else
        echo "🐍 Backend:  ❌ Detenido"
    fi
    
    if [ ! -z "$FRONTEND_PID" ]; then
        echo "⚛️  Frontend: ✅ Corriendo (PID: $FRONTEND_PID)"
    else
        echo "⚛️  Frontend: ❌ Detenido"
    fi
}

# Función para liberar un puerto si está ocupado
free_port() {
    PORT="$1"
    [ -z "$PORT" ] && return 0
    echo "🔧 Liberando puerto $PORT si está en uso..."
    if command -v fuser >/dev/null 2>&1; then
        # fuser mata procesos usando el puerto TCP especificado
        fuser -k -n tcp "$PORT" 2>/dev/null || true
    elif command -v lsof >/dev/null 2>&1; then
        PIDS="$(lsof -ti tcp:"$PORT" 2>/dev/null || true)"
        if [ -n "$PIDS" ]; then
            # Intento amable
            kill -TERM $PIDS 2>/dev/null || true
            sleep 1
            # Forzar si aún siguen
            kill -KILL $PIDS 2>/dev/null || true
        fi
    else
        echo "⚠️ Ni 'fuser' ni 'lsof' disponibles; omitiendo liberación del puerto $PORT"
    fi
}

# Asegura que los binarios de node_modules/.bin tengan permiso de ejecución
ensure_node_bin_exec() {
    local BIN_DIR="$PROJECT_ROOT/frontend/node_modules/.bin"
    if [ -d "$BIN_DIR" ]; then
        # Buscar archivos sin bit de ejecución que comiencen con shebang
        while IFS= read -r -d '' f; do
            if [ -f "$f" ] && [ ! -x "$f" ]; then
                # Solo añadir +x si es un script (tiene shebang) o archivo de texto
                if head -1 "$f" 2>/dev/null | grep -q "^#!"; then
                    chmod +x "$f" 2>/dev/null || true
                fi
            fi
        done < <(find "$BIN_DIR" -maxdepth 1 -type f -print0 2>/dev/null)
    fi
}

# Mostrar estado inicial
echo "🔍 Estado inicial:"
show_status

echo ""
echo "🛑 DETENIENDO SERVIDORES..."

# Detener procesos existentes
echo "• Deteniendo Backend..."
pkill -f "python main.py" 2>/dev/null
echo "• Deteniendo Frontend..."
pkill -f "npm.*start" 2>/dev/null

# Esperar a que terminen
sleep 3

echo "✅ Servidores detenidos"

echo ""
echo "🔓 LIBERANDO PUERTOS (8000 y 3000)..."
free_port 8000
free_port 3000
sleep 1

echo ""
echo "🚀 INICIANDO SERVIDORES OPTIMIZADOS..."

# Directorio del proyecto
PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_ROOT"

# Cargar NVM (Node Version Manager) para disponer de node/npm en este script
if [ -z "$NVM_DIR" ]; then
    export NVM_DIR="$HOME/.nvm"
fi
if [ -s "$NVM_DIR/nvm.sh" ]; then
    . "$NVM_DIR/nvm.sh"
    nvm use --lts >/dev/null 2>&1 || true
fi

# Iniciar Backend en segundo plano
echo "• Iniciando Backend (FastAPI)..."
(cd "$PROJECT_ROOT" && source venv_inspyro/bin/activate && cd backend && python main.py) &
BACKEND_PID=$!

# Esperar un poco para que el backend inicie
sleep 2

# Verificar y preparar Frontend
echo "• Verificando Frontend..."
if [ ! -d "$PROJECT_ROOT/frontend" ]; then
    echo "❌ ERROR: Directorio frontend no encontrado"
    exit 1
fi

if [ ! -f "$PROJECT_ROOT/frontend/package.json" ]; then
    echo "❌ ERROR: package.json no encontrado en frontend"
    exit 1
fi

# Verificar si node_modules existe
if [ ! -d "$PROJECT_ROOT/frontend/node_modules" ]; then
    echo "⚠️ Instalando dependencias de npm..."
    (cd "$PROJECT_ROOT/frontend" && npm install)
fi

# Asegurar permisos ejecutables tras instalación (previene 'Permission denied')
echo "• Verificando permisos de binarios npm..."
ensure_node_bin_exec

# Iniciar Frontend en segundo plano
echo "• Iniciando Frontend (React)..."
(cd "$PROJECT_ROOT/frontend" && npm start) &
FRONTEND_PID=$!

echo ""
echo "⏳ ESPERANDO INICIO COMPLETO..."
sleep 8

echo ""
echo "🧪 VERIFICANDO CONECTIVIDAD..."

# Verificar Backend
if curl -s http://localhost:8000/health >/dev/null 2>&1; then
    echo "✅ Backend: http://localhost:8000 - FUNCIONANDO"
else
    echo "⚠️ Backend: Aún iniciando..."
fi

# Verificar Frontend
if curl -s http://localhost:3000/ >/dev/null 2>&1; then
    echo "✅ Frontend: http://localhost:3000 - FUNCIONANDO"
else
    echo "⚠️ Frontend: Aún compilando..."
fi

echo ""
echo "📊 ESTADO FINAL:"
show_status

echo ""
echo "🎉 ¡INSPYRO REINICIADO!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🌐 URLs DISPONIBLES:"
echo "• Frontend: http://localhost:3000"
echo "• Backend:  http://localhost:8000" 
echo "• API Docs: http://localhost:8000/docs"
echo ""
echo "💡 CONSEJOS:"
echo "• Usa 'Ctrl+C' en las terminales para detener individualmente"
echo "• Usa './restart_inspyro.sh' para reiniciar rápidamente"
echo "• Revisa los logs en las terminales de backend/frontend"
echo ""
echo "🚀 ¡Listo para desarrollo!"