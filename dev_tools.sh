#!/bin/bash

# HERRAMIENTAS DE DESARROLLO PARA INSPYRO

case "$1" in
    "deps"|"sync"|"dependencies")
        echo "📦 Sincronizando dependencias en entornos virtuales..."
        REQUIREMENTS_FILE="backend/requirements.txt"
        if [ ! -f "$REQUIREMENTS_FILE" ]; then
            echo "❌ No se encontró $REQUIREMENTS_FILE"; exit 1; fi

        echo "🔍 Leyendo $REQUIREMENTS_FILE"; echo "--------------------------------------------------"; head -n 5 "$REQUIREMENTS_FILE"; echo "..."

        # Candidatos de entornos virtuales (orden de prioridad)
    VENV_CANDIDATES=("venv_inspyro" "backend/.venv" ".venv" "venv")
        UPDATED_ANY=0
        for VPATH in "${VENV_CANDIDATES[@]}"; do
            if [ -d "$VPATH/bin" ]; then
                echo "🐍 Actualizando entorno: $VPATH"
                (
                  set -e
                  # shellcheck disable=SC1090
                  source "$VPATH/bin/activate"
                  python -m pip install --upgrade pip >/dev/null 2>&1 || true
                  echo "   → Instalando requirements..."
                  pip install -r "$REQUIREMENTS_FILE"
                  echo "   ✔ Listo ($VPATH)"
                ) || echo "   ⚠️ Falló instalación en $VPATH"
                UPDATED_ANY=1
            fi
        done

        if [ $UPDATED_ANY -eq 0 ]; then
            echo "⚠️ No se detectaron entornos virtuales locales. Crea uno con: python -m venv venv_inspyro"
        fi

        # Actualizar imagen Docker backend (opcional) si docker-compose.yml existe
        if [ -f "docker-compose.yml" ]; then
            if command -v docker >/dev/null 2>&1; then
                echo "� (Opcional) Reconstruyendo imagen backend para reflejar cambios en requirements (cache layer)."
                echo "    Puedes omitir este paso con: ./dev_tools.sh deps --no-docker"
                if [ "$2" != "--no-docker" ]; then
                    docker compose build backend && echo "   ✔ Imagen backend reconstruida"
                else
                    echo "   ⏭️  Saltado rebuild Docker por --no-docker"
                fi
            else
                echo "⚠️ Docker no está instalado/disponible, se omite rebuild de imagen."
            fi
        fi

        echo "✅ Sincronización de dependencias completada."
        ;;
    "restart"|"r")
        echo "�🔄 Reiniciando Inspyro..."
        ./restart_inspyro.sh
        ;;
    "quick"|"q")
        echo "⚡ Reinicio rápido..."
        ./quick_restart.sh
        ;;
    "stop"|"s")
        echo "🛑 Deteniendo servidores..."
        pkill -f "python main.py" 2>/dev/null
        pkill -f "npm.*start" 2>/dev/null
        echo "✅ Servidores detenidos"
        ;;
    "status"|"st")
        echo "📊 ESTADO DE INSPYRO:"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        
        BACKEND_PID=$(ps aux | grep "python main.py" | grep -v grep | awk '{print $2}' | head -1)
        FRONTEND_PID=$(ps aux | grep "npm.*start" | grep -v grep | awk '{print $2}' | head -1)
        
        if [ ! -z "$BACKEND_PID" ]; then
            echo "🐍 Backend:  ✅ Corriendo (PID: $BACKEND_PID)"
            curl -s http://localhost:8000/health >/dev/null 2>&1 && echo "  └─ ✅ API Respondiendo" || echo "  └─ ⚠️ API No responde"
        else
            echo "🐍 Backend:  ❌ Detenido"
        fi
        
        if [ ! -z "$FRONTEND_PID" ]; then
            echo "⚛️  Frontend: ✅ Corriendo (PID: $FRONTEND_PID)"
            curl -s http://localhost:3000/ >/dev/null 2>&1 && echo "  └─ ✅ Web Disponible" || echo "  └─ ⚠️ Web No disponible"
        else
            echo "⚛️  Frontend: ❌ Detenido"
        fi
        
        echo ""
        echo "🌐 URLs:"
        echo "• Frontend: http://localhost:3000"
        echo "• Backend:  http://localhost:8000"
        echo "• API Docs: http://localhost:8000/docs"
        ;;
    "logs"|"l")
        echo "📋 LOGS RECIENTES:"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo "🐍 Backend logs (últimas 10 líneas):"
        tail -n 10 /tmp/inspyro_backend.log 2>/dev/null || echo "No hay logs de backend"
        echo ""
        echo "⚛️ Frontend logs - ejecuta: cd frontend && npm start"
        ;;
    "test"|"t")
        echo "🧪 PRUEBA RÁPIDA DE CONECTIVIDAD:"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        
        echo -n "🐍 Backend (8000): "
        if curl -s http://localhost:8000/health >/dev/null 2>&1; then
            echo "✅ OK"
        else
            echo "❌ NO RESPONDE"
        fi
        
        echo -n "⚛️ Frontend (3000): "
        if curl -s http://localhost:3000/ >/dev/null 2>&1; then
            echo "✅ OK"
        else
            echo "❌ NO RESPONDE"
        fi
        ;;
    "setup"|"setup-frontend"|"sf")
        echo "⚙️ CONFIGURANDO FRONTEND..."
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        
        if [ ! -d "frontend" ]; then
            echo "❌ ERROR: Directorio frontend no encontrado"
            exit 1
        fi
        
        echo "📦 Instalando dependencias de npm..."
        cd frontend && npm install
        echo "✅ Dependencias instaladas"
        
        echo "🧪 Verificando instalación..."
        if [ -d "node_modules" ]; then
            echo "✅ node_modules creado correctamente"
        else
            echo "❌ ERROR: Falló la instalación de dependencias"
            exit 1
        fi
        
        cd ..
        echo "🎉 ¡Frontend configurado correctamente!"
        ;;
    "clean"|"cl")
        echo "🧹 LIMPIEZA PROFUNDA..."
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        
        # Detener procesos
        echo "🛑 Deteniendo servidores..."
        pkill -f "python main.py" 2>/dev/null
        pkill -f "npm.*start" 2>/dev/null
        
        # Limpiar caché del frontend
        if [ -d "frontend/node_modules" ]; then
            echo "🗑️ Eliminando node_modules..."
            rm -rf frontend/node_modules
        fi
        
        if [ -d "frontend/.next" ]; then
            echo "🗑️ Eliminando caché .next..."
            rm -rf frontend/.next
        fi
        
        if [ -d "frontend/build" ]; then
            echo "🗑️ Eliminando directorio build..."
            rm -rf frontend/build
        fi
        
        echo "📦 Reinstalando dependencias..."
        cd frontend && npm install && cd ..
        
        echo "✅ Limpieza completada"
        ;;
    "help"|"h"|*)
        echo "🛠️  HERRAMIENTAS DE DESARROLLO INSPYRO"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo ""
        echo "📋 COMANDOS DISPONIBLES:"
        echo ""
        echo "🔄 REINICIO:"
        echo "  ./dev_tools.sh restart  (r)  - Reinicio completo con verificaciones"
        echo "  ./dev_tools.sh quick    (q)  - Reinicio ultra rápido"
        echo ""
        echo "🔧 CONTROL:"
        echo "  ./dev_tools.sh stop     (s)  - Detener todos los servidores"
        echo "  ./dev_tools.sh status   (st) - Ver estado de servidores"
        echo ""
        echo "🧪 DIAGNÓSTICO:"
        echo "  ./dev_tools.sh test     (t)  - Probar conectividad"
        echo "  ./dev_tools.sh logs     (l)  - Ver logs recientes"
        echo ""
        echo "⚙️ CONFIGURACIÓN:"
        echo "  ./dev_tools.sh setup    (sf) - Configurar frontend"
    echo "  ./dev_tools.sh deps     (sync) - Instalar/actualizar requirements en TODOS los venv locales y (opcional) rebuild Docker"
        echo "  ./dev_tools.sh clean    (cl) - Limpieza profunda"
        echo ""
        echo "💡 EJEMPLOS:"
        echo "  ./dev_tools.sh r        # Reinicio completo"
        echo "  ./dev_tools.sh q        # Reinicio rápido"
    echo "  ./dev_tools.sh deps     # Sincronizar dependencias locales y backend"
        echo "  ./dev_tools.sh st       # Ver estado"
        echo "  ./dev_tools.sh sf       # Configurar frontend"
        echo "  ./dev_tools.sh cl       # Limpiar y reinstalar"
        echo ""
        echo "🚀 PARA USO RÁPIDO:"
        echo "  alias inspyro='./dev_tools.sh'"
        echo "  inspyro r               # Reinicio"
        echo "  inspyro st              # Estado"
        ;;
esac