import React from 'react';
import './SkeletonLoader.css';

/**
 * SkeletonLoader Component
 * 
 * Un componente visual moderno para indicar cargas asíncronas de documentos.
 * Simula la estructura de una página de documento de texto con animaciones de pulso suave.
 */
const SkeletonLoader = ({ message = "Procesando documento..." }) => {
    return (
        <div className="skeleton-container">
            <div className="skeleton-page">
                {/* Cabecera simulada */}
                <div className="skeleton-header">
                    <div className="skeleton-title"></div>
                    <div className="skeleton-subtitle"></div>
                </div>

                {/* Contenido principal simulado */}
                <div className="skeleton-content">
                    {/* Párrafo 1 */}
                    <div className="skeleton-paragraph">
                        <div className="skeleton-line full"></div>
                        <div className="skeleton-line full"></div>
                        <div className="skeleton-line partial-80"></div>
                    </div>

                    {/* Espacio para simulacro de imagen o tabla */}
                    <div className="skeleton-block"></div>

                    {/* Párrafo 2 */}
                    <div className="skeleton-paragraph">
                        <div className="skeleton-line full"></div>
                        <div className="skeleton-line full"></div>
                        <div className="skeleton-line full"></div>
                        <div className="skeleton-line partial-60"></div>
                    </div>
                </div>
            </div>
            {message && <div className="skeleton-message">{message}</div>}
        </div>
    );
};

export default SkeletonLoader;
