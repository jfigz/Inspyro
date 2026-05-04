"""
Parser de Anotaciones para el Analizador de Dependencias.

Extrae metadatos de comentarios tipo decorador:
    # @desc: Descripción del símbolo
    # @unit: Unidad física (kN, m, MPa, etc.)
    # @range: [min, max] - Rango válido
    # @category: material | geometry | load | result | factor
    # @ref: Referencia normativa (ACI 318-19 §9.5)
    # @check: Marca como nodo de verificación
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple


# -----------------------------------------------------------------------------
# Regex patterns para cada decorador
# -----------------------------------------------------------------------------

# Patrón base: # @key: value
ANNOTATION_PATTERN = re.compile(
    r'^\s*#\s*@(\w+)\s*:\s*(.+?)\s*$',
    re.MULTILINE
)

# Patrón para @range: [min, max] o (min, max)
RANGE_PATTERN = re.compile(
    r'[\[\(]\s*(-?[\d.eE+-]+|None)\s*,\s*(-?[\d.eE+-]+|None)\s*[\]\)]'
)

# Categorías válidas
VALID_CATEGORIES = frozenset({
    'material',   # Propiedades del material (E, fy, fc)
    'geometry',   # Geometría (b, h, L, A)
    'load',       # Cargas (P, w, M, V)
    'result',     # Resultados (sigma, epsilon, delta)
    'factor',     # Factores de seguridad (phi, gamma, FS)
    'input',      # Dato de entrada
    'output',     # Resultado final
    'check',      # Verificación
})


# -----------------------------------------------------------------------------
# Estructuras de Datos
# -----------------------------------------------------------------------------

@dataclass
class AnnotationData:
    """Metadatos extraídos de los decoradores de un símbolo."""
    
    description: Optional[str] = None
    unit: Optional[str] = None
    valid_range: Optional[Tuple[Optional[float], Optional[float]]] = None
    category: Optional[str] = None
    category_inferred: bool = False  # True si fue detectado por heurística
    reference: Optional[str] = None
    is_check: bool = False
    check_message: Optional[str] = None
    
    def to_dict(self) -> Dict:
        """Serializa a diccionario para JSON."""
        return {
            'description': self.description,
            'unit': self.unit,
            'valid_range': list(self.valid_range) if self.valid_range else None,
            'category': self.category,
            'category_inferred': self.category_inferred,
            'reference': self.reference,
            'is_check': self.is_check,
            'check_message': self.check_message,
        }
    
    def is_empty(self) -> bool:
        """Retorna True si no tiene ninguna anotación."""
        return (
            self.description is None and
            self.unit is None and
            self.valid_range is None and
            self.category is None and
            self.reference is None and
            not self.is_check
        )


# -----------------------------------------------------------------------------
# Heurísticas de Categorización
# -----------------------------------------------------------------------------

# Patrones para auto-detección de categorías
CATEGORY_HEURISTICS: List[Tuple[str, re.Pattern]] = [
    # Material: módulos elásticos, resistencias
    ('material', re.compile(
        r'^(E|Es|Ec|fy|fu|fc|fck|fyk|G|nu|rho|gamma_m)(_\w+)?$', re.IGNORECASE
    )),
    # Geometría: dimensiones
    ('geometry', re.compile(
        r'^(L|b|h|d|t|A|I|S|Z|r|D|e|s|c|a)(_\w+)?$', re.IGNORECASE
    )),
    # Cargas: fuerzas, momentos
    ('load', re.compile(
        r'^(P|F|M|V|N|T|w|q|W|Q|R)(_\w+)?$', re.IGNORECASE
    )),
    # Resultados: esfuerzos, deformaciones, desplazamientos
    ('result', re.compile(
        r'^(sigma|epsilon|delta|tau|phi|theta|psi|def|disp|stress|strain)(_\w+)?$',
        re.IGNORECASE
    )),
    # Factores: coeficientes de seguridad
    ('factor', re.compile(
        r'^(FS|phi|gamma|psi|alpha|beta|eta|lambda|omega|factor|coef)(_\w+)?$',
        re.IGNORECASE
    )),
]


def infer_category(symbol_name: str) -> Optional[str]:
    """
    Intenta inferir la categoría de un símbolo basándose en su nombre.
    
    Returns:
        Nombre de categoría o None si no se puede inferir.
    """
    for category, pattern in CATEGORY_HEURISTICS:
        if pattern.match(symbol_name):
            return category
    return None


# -----------------------------------------------------------------------------
# Parser Principal
# -----------------------------------------------------------------------------

def parse_range(range_str: str) -> Optional[Tuple[Optional[float], Optional[float]]]:
    """
    Parsea un string de rango a una tupla (min, max).
    
    Soporta:
        - [0, 100]
        - (0.5, 1.5)
        - [None, 500] (sin límite inferior)
        - [0, None] (sin límite superior)
    """
    match = RANGE_PATTERN.search(range_str)
    if not match:
        return None
    
    min_str, max_str = match.groups()
    
    min_val = None if min_str.lower() == 'none' else float(min_str)
    max_val = None if max_str.lower() == 'none' else float(max_str)
    
    return (min_val, max_val)


def extract_annotations(
    source_lines: List[str],
    target_line: int
) -> AnnotationData:
    """
    Extrae anotaciones de los comentarios que preceden a una línea de código.
    
    Args:
        source_lines: Lista de líneas del código fuente
        target_line: Número de línea (1-indexed) del símbolo
        
    Returns:
        AnnotationData con los metadatos extraídos
    """
    annotations = AnnotationData()
    
    if target_line < 1 or target_line > len(source_lines):
        return annotations
    
    # Buscar comentarios en las líneas anteriores (hasta 10 líneas arriba o línea vacía)
    start_search = max(0, target_line - 10)
    
    # Recolectar comentarios contiguos antes de la línea objetivo
    comment_block: List[str] = []
    for i in range(target_line - 2, start_search - 1, -1):  # -2 porque es 0-indexed
        line = source_lines[i].strip()
        if line.startswith('#'):
            comment_block.insert(0, line)
        elif line == '':
            continue  # Ignorar líneas vacías
        else:
            break  # Encontramos código, parar
    
    # Parsear cada línea del bloque de comentarios
    for comment_line in comment_block:
        match = ANNOTATION_PATTERN.match(comment_line)
        if not match:
            continue
        
        key, value = match.groups()
        key = key.lower()
        value = value.strip()
        
        if key == 'desc' or key == 'description':
            annotations.description = value
        elif key == 'unit' or key == 'units':
            annotations.unit = value
        elif key == 'range':
            annotations.valid_range = parse_range(value)
        elif key == 'category' or key == 'cat':
            if value.lower() in VALID_CATEGORIES:
                annotations.category = value.lower()
        elif key == 'ref' or key == 'reference':
            annotations.reference = value
        elif key == 'check':
            annotations.is_check = True
            if value:
                annotations.check_message = value
    
    return annotations


def extract_annotations_for_symbol(
    source_code: str,
    symbol_name: str,
    line: int,
    apply_heuristics: bool = True
) -> AnnotationData:
    """
    Extrae anotaciones para un símbolo específico.
    
    Args:
        source_code: Código fuente completo
        symbol_name: Nombre del símbolo
        line: Línea donde está definido (1-indexed)
        apply_heuristics: Si aplicar categorización automática
        
    Returns:
        AnnotationData con los metadatos
    """
    lines = source_code.splitlines()
    annotations = extract_annotations(lines, line)
    
    # Aplicar heurística de categoría si no hay una explícita
    if apply_heuristics and annotations.category is None:
        inferred = infer_category(symbol_name)
        if inferred:
            annotations.category = inferred
            annotations.category_inferred = True  # Marcar como inferida
    
    return annotations


# -----------------------------------------------------------------------------
# Utilidades
# -----------------------------------------------------------------------------

def check_value_in_range(
    value: float,
    valid_range: Optional[Tuple[Optional[float], Optional[float]]]
) -> Optional[str]:
    """
    Verifica si un valor está dentro del rango válido.
    
    Returns:
        'ok' - Dentro del rango
        'warning' - Cerca del límite (< 10% de margen)
        'error' - Fuera del rango
        None - No hay rango definido
    """
    if valid_range is None:
        return None
    
    min_val, max_val = valid_range
    
    # Verificar si está fuera del rango
    if min_val is not None and value < min_val:
        return 'error'
    if max_val is not None and value > max_val:
        return 'error'
    
    # Verificar si está cerca del límite (10% de margen)
    if min_val is not None and max_val is not None:
        range_size = max_val - min_val
        margin = range_size * 0.1
        
        if value < min_val + margin or value > max_val - margin:
            return 'warning'
    
    return 'ok'


def format_unit(unit: Optional[str]) -> str:
    """Formatea una unidad para display."""
    if not unit:
        return ''
    
    # Reemplazos comunes para display bonito
    replacements = {
        'kN.m': 'kN·m',
        'kN*m': 'kN·m',
        'kN-m': 'kN·m',
        'm2': 'm²',
        'm3': 'm³',
        'm^2': 'm²',
        'm^3': 'm³',
        'cm2': 'cm²',
        'cm3': 'cm³',
        'mm2': 'mm²',
        'mm3': 'mm³',
    }
    
    result = unit
    for old, new in replacements.items():
        result = result.replace(old, new)
    
    return result
