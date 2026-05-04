

"""
Enhanced Mathematical Expression Parser v6.0
============================================

Convierte expresiones matemáticas avanzadas a formato OMML para documentos Word.
Incluye soporte para funciones trigonométricas, logarítmicas, sumatorias, límites, 
matrices, vectores y mucho más.

Autor: Sistema de Parsing Matemático Avanzado
Versión: 6.0 - Implementación completa con todas las mejoras
"""

import logging
import sys
import os
from collections import OrderedDict
from pathlib import Path
from functools import lru_cache
from contextlib import contextmanager
from typing import Dict, List, Any, Optional, Tuple, Union
import traceback
import json
import hashlib
from datetime import datetime
import re

_logger = logging.getLogger(__name__)

# Importaciones condicionales (para manejar dependencias faltantes)
try:
    import docx
    from docx import Document
    from docx.shared import RGBColor
    from docx.oxml import OxmlElement
    HAS_DOCX = True
except ImportError:
    _logger.debug("python-docx no disponible. Funcionalidad de Word limitada.")
    HAS_DOCX = False

try:
    from lxml import etree
    HAS_LXML = True
except ImportError:
    _logger.debug("lxml no disponible. Funcionalidad OMML limitada.")
    HAS_LXML = False

try:
    from lark import Lark, Transformer, v_args, LarkError
    HAS_LARK = True
except ImportError:
    _logger.debug("lark no disponible. Usando parser manual simplificado.")
    HAS_LARK = False
    # Crear dummies cuando Lark no está disponible
    class Transformer:
        pass
    
    class LarkError(Exception):
        pass
    
    def v_args(*dargs, **dkwargs):  # decorador no-op
        def decorator(func):
            return func
        return decorator

try:
    import numpy as np
    HAS_NUMPY = True
except ImportError:
    _logger.debug("numpy no disponible. Funcionalidad matemática limitada.")
    HAS_NUMPY = False

try:
    import sympy as sp
    HAS_SYMPY = True
except ImportError:
    _logger.debug("sympy no disponible. Funcionalidad simbólica limitada.")
    HAS_SYMPY = False

# --- CONFIGURACIÓN DEL SISTEMA ---
class MathConfig:
    """Configuración global del sistema de parsing matemático."""
    
    def __init__(self):
        self.decimal_separator = "."
        self.thousand_separator = ","
        self.angle_unit = "rad"  # "rad" o "deg"
        self.matrix_style = "pmatrix"  # "pmatrix", "bmatrix", "vmatrix", etc.
        self.fraction_style = "built-up"  # "built-up" o "linear"
        self.greek_mode = "auto"  # "names", "symbols", "auto"
        self.implicit_multiplication = True
        self.function_parentheses_required = False
        self.cache_enabled = True
        self.cache_size = 1000
        self.debug_mode = False
        self.color_errors = True
        
    def load_from_file(self, config_path: str):
        """Carga configuración desde archivo JSON."""
        try:
            with open(config_path, 'r', encoding='utf-8') as f:
                config_data = json.load(f)
                for key, value in config_data.items():
                    if hasattr(self, key):
                        setattr(self, key, value)
        except FileNotFoundError:
            if self.debug_mode:
                _logger.debug("Archivo de configuración no encontrado: %s", config_path)
        except Exception as e:
            _logger.warning("Error cargando configuración: %s", e)
    
    def save_to_file(self, config_path: str):
        """Guarda configuración actual a archivo JSON."""
        config_data = {
            key: value for key, value in self.__dict__.items()
            if not key.startswith('_')
        }
        try:
            with open(config_path, 'w', encoding='utf-8') as f:
                json.dump(config_data, f, indent=2, ensure_ascii=False)
        except Exception as e:
            _logger.warning("Error guardando configuración: %s", e)

# Instancia global de configuración
CONFIG = MathConfig()

# --- MAPEO DE SÍMBOLOS GRIEGOS EXTENDIDO ---
GREEK_MAP = {
    # Letras griegas minúsculas
    "alpha": "α", "beta": "β", "gamma": "γ", "delta": "δ", "epsilon": "ε",
    "zeta": "ζ", "eta": "η", "theta": "θ", "iota": "ι", "kappa": "κ",
    "lambda": "λ", "mu": "μ", "nu": "ν", "xi": "ξ", "omicron": "ο",
    "pi": "π", "rho": "ρ", "sigma": "σ", "tau": "τ", "upsilon": "υ",
    "phi": "φ", "chi": "χ", "psi": "ψ", "omega": "ω",
    
    # Letras griegas mayúsculas
    "Alpha": "Α", "Beta": "Β", "Gamma": "Γ", "Delta": "Δ", "Epsilon": "Ε",
    "Zeta": "Ζ", "Eta": "Η", "Theta": "Θ", "Iota": "Ι", "Kappa": "Κ",
    "Lambda": "Λ", "Mu": "Μ", "Nu": "Ν", "Xi": "Ξ", "Omicron": "Ο",
    "Pi": "Π", "Rho": "Ρ", "Sigma": "Σ", "Tau": "Τ", "Upsilon": "Υ",
    "Phi": "Φ", "Chi": "Χ", "Psi": "Ψ", "Omega": "Ω",
    
    # Variantes especiales
    "varepsilon": "ε", "vartheta": "ϑ", "varpi": "ϖ", "varrho": "ϱ",
    "varsigma": "ς", "varphi": "ϕ", "varUpsilon": "ϒ",
    # Letras griegas transliteradas comunes
    "delta": "δ", "Delta": "Δ",
}

# Constantes matemáticas comunes
MATH_CONSTANTS = {
    "e": "e", "pi": "π", "inf": "∞", "infinity": "∞",
    "i": "i", "j": "j",  # unidades imaginarias
    "hbar": "ℏ", "planck": "h",
    "c": "c",  # velocidad de la luz
    "boltzmann": "k", "avogadro": "Nₐ",
}

# Operadores especiales
SPECIAL_OPERATORS = {
    "pm": "±", "mp": "∓", "times": "×", "div": "÷",
    "cdot": "⋅", "bullet": "∙", "cap": "∩", "cup": "∪",
    "subset": "⊂", "supset": "⊃", "subseteq": "⊆", "supseteq": "⊇",
    "in": "∈", "notin": "∉", "ni": "∋", "exists": "∃", "forall": "∀",
    "partial": "∂", "nabla": "∇", "sum": "∑", "prod": "∏",
    "int": "∫", "oint": "∮", "iint": "∬", "iiint": "∭",
    "lim": "lim", "max": "max", "min": "min", "sup": "sup", "inf": "inf",
    "approx": "≈", "equiv": "≡", "neq": "≠", "leq": "≤", "geq": "≥",
    "ll": "≪", "gg": "≫", "propto": "∝", "sim": "∼",
    "leftarrow": "←", "rightarrow": "→", "leftrightarrow": "↔",
    "Leftarrow": "⇐", "Rightarrow": "⇒", "Leftrightarrow": "⇔",
}

# --- GRAMÁTICA EXTENDIDA PARA LARK ---
# Gramática extendida que soporta más operadores
ENHANCED_MATH_GRAMMAR = r"""
    start: equation
    
    equation: expr_chain
    
    expr_chain: expr_chain EQ comparison
              | comparison
    
    comparison: comparison COMP_OP expr
              | expr
    
    expr: expr PLUS term
        | expr MINUS term
        | term
    
    term: term STAR factor
        | term SLASH factor
        | factor
    
    factor: (PLUS | MINUS) factor
          | power
    
    power: sub CARET factor
         | sub
    
    sub: atom UNDERSCORE atom
       | atom
    
    atom: NUMBER
        | VAR "(" expr_list ")"
        | VAR "(" expr PIPE expr ")"   -> cond_call
        | VAR
        | "(" expr ")"
        | "[" matrix_rows "]"
        | "<" expr_list ">"
        | "||" expr "||" -> norm_expr
        | "|" expr "|"   -> abs_value
        | "cases" "(" cases_rows ")" -> cases_expr
    
    expr_list: expr (COMMA expr)*
    matrix_rows: matrix_row (SEMICOLON matrix_row)*
    matrix_row: expr_list
    cases_rows: case_row (SEMICOLON case_row)*
    case_condition: comparison | expr EQ expr
    case_row: expr COMMA case_condition
    
    EQ: "="
    PLUS: "+"
    MINUS: "-"
    STAR: "*"
    SLASH: "/"
    CARET: "^"
    UNDERSCORE: "_"
    COMMA: ","
    SEMICOLON: ";"
    PIPE: "|"
    COMP_OP: ">=" | "<=" | "!=" | ">" | "<"
    ARROW: "->"
    
    VAR: /[a-zA-Zα-ωΑ-Ω][a-zA-Z0-9α-ωΑ-Ωπ_]*/
    NUMBER: /\d+(\.\d+)?/
    
    %import common.WS
    %ignore WS
"""

# --- SISTEMA DE CACHE LRU ---
class MathCache:
    """Sistema de cache LRU para expresiones parseadas.
    
    Usa OrderedDict para mantener el orden de acceso y eliminar
    los elementos menos recientemente usados (LRU).
    """
    
    def __init__(self, max_size: int = 1000):
        self.cache: OrderedDict[str, Any] = OrderedDict()
        self.max_size = max_size
        self.hits = 0
        self.misses = 0
    
    def _hash_expression(self, expr: str) -> str:
        """Genera hash único para una expresión."""
        return hashlib.md5(expr.encode('utf-8')).hexdigest()
    
    def get(self, expr: str) -> Optional[Any]:
        """Obtiene resultado cacheado y lo mueve al final (LRU)."""
        if not CONFIG.cache_enabled:
            return None
            
        key = self._hash_expression(expr)
        if key in self.cache:
            self.hits += 1
            # Mover al final para marcar como recientemente usado
            self.cache.move_to_end(key)
            return self.cache[key]
        
        self.misses += 1
        return None
    
    def put(self, expr: str, result: Any):
        """Guarda resultado en cache con política LRU."""
        if not CONFIG.cache_enabled:
            return
        
        key = self._hash_expression(expr)
        
        # Si ya existe, actualizar y mover al final
        if key in self.cache:
            self.cache[key] = result
            self.cache.move_to_end(key)
            return
            
        # Eliminar el elemento menos recientemente usado si está lleno
        while len(self.cache) >= self.max_size:
            try:
                self.cache.popitem(last=False)  # Eliminar el primero (LRU)
            except KeyError:
                break
        
        self.cache[key] = result
    
    def clear(self):
        """Limpia el cache."""
        self.cache.clear()
        self.hits = 0
        self.misses = 0
    
    def stats(self) -> Dict[str, Any]:
        """Retorna estadísticas del cache."""
        total = self.hits + self.misses
        hit_rate = (self.hits / total * 100) if total > 0 else 0.0
        return {
            'hits': self.hits,
            'misses': self.misses,
            'hit_rate': hit_rate,
            'cache_size': len(self.cache)
        }

# Instancia global de cache
CACHE = MathCache(CONFIG.cache_size)

# --- CLASE DE RESULTADOS ---
class ParseResult:
    """Representa el resultado de parsear una expresión."""
    
    def __init__(self):
        self.success = False
        self.omml_element = None
        self.ast = None
        self.warnings = []
        self.suggestions = []
        self.parse_time = 0.0
        self.error_message = ""
        self.error_position = -1
        self.error_context = ""

# --- PARSER MANUAL SIMPLIFICADO (FALLBACK) ---
class SimpleMathParser:
    """Parser matemático simplificado como fallback cuando Lark no está disponible."""
    
    def __init__(self, text: str):
        self.text = self._preprocess(text)
        self.pos = 0
        self.length = len(self.text)
    
    def _preprocess(self, text: str) -> str:
        """Preprocesa el texto para facilitar el parsing."""
        # Reemplazar multiplicación implícita
        if CONFIG.implicit_multiplication:
            text = re.sub(r'(\d)([a-zA-Z])', r'\1*\2', text)  # 2x -> 2*x
            text = re.sub(r'([a-zA-Z])(\d)', r'\1*\2', text)  # x2 -> x*2
            text = re.sub(r'\)(\w)', r')*\1', text)  # )(x) -> )*(x)
            # Evitar forzar multiplicación antes de '(', para no romper llamadas como f(x)
            #text = re.sub(r'(\w)\(', r'\1*(', text)  # x( -> x*(
        
        # Reemplazar símbolos griegos (palabras completas o seguidas de _)
        # Ej.: delta_ij -> δ_ij
        for name, symbol in GREEK_MAP.items():
            pattern = r'(?<!\w)' + re.escape(name) + r'(?=\b|_)'
            text = re.sub(pattern, symbol, text)
        
        # Reemplazar constantes matemáticas (palabras completas o seguidas de _)
        for name, symbol in MATH_CONSTANTS.items():
            pattern = r'(?<!\w)' + re.escape(name) + r'(?=\b|_)'
            text = re.sub(pattern, symbol, text)
        
        return text
    
    def peek(self) -> str:
        """Mira el siguiente carácter sin avanzar."""
        return self.text[self.pos] if self.pos < self.length else ''
    
    def next(self) -> str:
        """Obtiene el siguiente carácter y avanza."""
        ch = self.peek()
        self.pos += 1
        return ch

    def _skip_ws(self):
        """Avanza el puntero saltando espacios en blanco."""
        while self.peek() and self.peek().isspace():
            self.pos += 1

    def _starts_implicit_factor(self, ch: str) -> bool:
        """Determina si un carácter puede iniciar un nuevo factor tras espacios."""
        if not ch:
            return False
        if ch.isalnum():
            return True
        if ch in '([<|':
            return True
        if ch in {'√', '∑', '∏', '∫'}:
            return True
        return False
    
    def parse_expression(self):
        """Parsea una expresión completa."""
        try:
            node = self.parse_equality()
            self._skip_ws()
            if self.pos < self.length:
                remaining = self.text[self.pos:self.pos + 20]
                if self.length - self.pos > 20:
                    remaining = remaining + "..."
                raise Exception(f"entrada no reconocida cerca de '{remaining}'")
            return node
        except Exception as e:
            raise Exception(f"Error de parsing en posición {self.pos}: {e}")
    
    def parse_equality(self):
        """Parsea expresiones con igualdad."""
        node = self.parse_addition()
        self._skip_ws()
        while self.peek() == '=':
            op = self.next()
            self._skip_ws()
            right = self.parse_addition()
            node = ('binop', op, node, right)
            self._skip_ws()
        return node
    
    def parse_addition(self):
        """Parsea suma y resta."""
        node = self.parse_multiplication()
        while True:
            self._skip_ws()
            ch = self.peek()
            if ch in '+-':
                op = self.next()
                self._skip_ws()
                right = self.parse_multiplication()
                node = ('binop', op, node, right)
            else:
                break
        return node
    
    def parse_multiplication(self):
        """Parsea multiplicación, división y multiplicación implícita."""
        node = self.parse_power()
        while True:
            prev_pos = self.pos
            self._skip_ws()
            consumed_ws = self.pos > prev_pos
            prev_char = self.text[prev_pos - 1] if prev_pos - 1 >= 0 else ''
            ch = self.peek()
            if not ch:
                break
            had_ws = consumed_ws or (prev_char and prev_char.isspace())
            if ch in '*/':
                op = self.next()
                self._skip_ws()
                right = self.parse_power()
                node = ('binop', op, node, right)
            elif had_ws and self._starts_implicit_factor(ch):
                right = self.parse_power()
                node = ('implicit_mul', ' ', node, right)
            else:
                break
        return node
    
    def parse_power(self):
        """Parsea exponenciación y subíndices."""
        node = self.parse_atom()
        self._skip_ws()
        if self.peek() and self.peek() in '^_':
            op = self.next()
            self._skip_ws()
            right = self.parse_power()  # Asociatividad derecha
            if op == '^':
                node = ('power', node, right)
            else:  # op == '_'
                node = ('subscript', node, right)
        return node
    
    def parse_atom(self):
        """Parsea átomos: números, variables, funciones, paréntesis."""
        # Saltar espacios
        self._skip_ws()
        
        if not self.peek():
            raise Exception("Expresión incompleta")
        
        # Números
        if self.peek().isdigit() or self.peek() == '.':
            return self.parse_number()
        
        # Variables y funciones
        if self.peek().isalpha() or self.peek() in GREEK_MAP.values():
            return self.parse_variable_or_function()
        
        # Paréntesis
        if self.peek() == '(':
            self.next()  # consumir '('
            node = self.parse_expression()
            self._skip_ws()
            if self.peek() == ')':
                self.next()  # consumir ')'
            return node
        
        # Operadores unarios
        if self.peek() in '+-':
            op = self.next()
            operand = self.parse_atom()
            return ('unaryop', op, operand)
        
        # Fallback: consumir carácter como variable
        return ('var', self.next())
    
    def parse_number(self):
        """Parsea un número (entero o decimal)."""
        num = ''
        while self.peek() and (self.peek().isdigit() or self.peek() == '.'):
            num += self.next()
        return ('num', num)
    
    def parse_variable_or_function(self):
        """Parsea una variable o función."""
        name = ''
        
        # Recoger el nombre completo
        while (self.peek() and 
               (self.peek().isalnum() or 
                self.peek() in GREEK_MAP.values() or 
                self.peek() == '_')):
            name += self.next()
        self._skip_ws()
        
        # Manejo especial para casos como P(A|B)
        if self.peek() == '(':
            self.next()  # consumir '('
            args = []
            
            # Parsear argumentos - incluyendo manejo especial para |
            if self.peek() != ')':
                # Parsear primer argumento
                arg_parts = []
                paren_count = 0
                
                while self.peek() and (self.peek() != ')' or paren_count > 0):
                    if self.peek() == '(':
                        paren_count += 1
                    elif self.peek() == ')':
                        paren_count -= 1
                    elif self.peek() == ',' and paren_count == 0:
                        # Fin de argumento
                        break
                    
                    char = self.next()
                    if char == '|':
                        # Crear una sub-expresión con el pipe
                        if arg_parts:
                            left_part = ''.join(arg_parts)
                            # Parsear la parte derecha hasta la coma o paréntesis
                            right_parts = []
                            while self.peek() and self.peek() not in ',)':
                                right_parts.append(self.next())
                            right_part = ''.join(right_parts)
                            
                            # Crear una función especial para condicionales
                            args.append(('conditional', left_part, right_part))
                            arg_parts = []
                            break
                    else:
                        arg_parts.append(char)
                
                # Si no encontramos pipe, parsear normalmente
                if arg_parts:
                    # Retroceder y parsear normalmente
                    self.pos -= len(arg_parts)
                    self._skip_ws()
                    args.append(self.parse_expression())
                    
                    while self.peek() == ',':
                        self.next()  # consumir ','
                        self._skip_ws()
                        args.append(self.parse_expression())
            
            self._skip_ws()
            if self.peek() == ')':
                self.next()  # consumir ')'
            
            return ('call', name, args)
        
        # Es una variable simple
        return ('var', name)

# --- TRANSFORMER MEJORADO ---
class EnhancedMathTransformer(Transformer):
    """Transformer mejorado para el AST de Lark."""
    
    def number(self, children):
        return ('num', str(children[0]))
    
    def var(self, children):
        var_name = str(children[0])
        # Aplicar mapeo de símbolos griegos si está configurado
        if CONFIG.greek_mode in ['auto', 'symbols']:
            var_name = GREEK_MAP.get(var_name, var_name)
        return ('var', var_name)
    
    def special_op(self, children):
        """Maneja operadores especiales como \\alpha, \\sum, etc."""
        op_name = str(children[0])[1:]  # Remover el backslash
        symbol = GREEK_MAP.get(op_name) or SPECIAL_OPERATORS.get(op_name) or op_name
        return ('var', symbol)
    
    def binop(self, children):
        return ('binop', str(children[1]), children[0], children[2])
    
    def implicit_mult(self, children):
        """Maneja multiplicación implícita."""
        return ('binop', '*', children[0], children[1])
    
    def unaryop(self, children):
        op = str(children[0])
        operand = children[1]
        return ('unaryop', op, operand)
    
    def power_op(self, children):
        return ('power', children[0], children[2])
    
    def subscript(self, children):
        return ('subscript', children[0], children[2])
    
    def equation_chain(self, children):
        """Maneja múltiples igualdades como a = b = c."""
        if len(children) == 3:  # left EQ right
            return ('equation', children[0], children[2])
        else:
            # Para múltiples igualdades, crear una cadena
            return ('equation_chain', children)
    
    def comp_op(self, children):
        """Maneja operadores de comparación."""
        op = str(children[1])
        left = children[0]
        right = children[2]
        return ('comparison', op, left, right)
    
    def funcall(self, children):
        func_name = str(children[0])
        args_list = children[1] if len(children) > 1 else []
        return ('call', func_name, args_list)
    
    def expr_list(self, children):
        """Lista de expresiones separadas por comas."""
        return [child for child in children if isinstance(child, tuple)]
    
    def matrix(self, children):
        """Maneja matrices."""
        return ('matrix', children[0] if children else [])
    
    def matrix_rows(self, children):
        return list(children) if children else []
    
    def matrix_row(self, children):
        return children[0] if children else []  # expr_list
    def case_row(self, children):
        # Filtrar token COMMA; mantener [expr, condition]
        elems = [c for c in children if not (hasattr(c, 'type') and c.type == 'COMMA')]
        if len(elems) == 2:
            return ('case_row', elems[0], elems[1])
        return ('case_row', None, None)

    def cases_rows(self, children):
        # children ya es lista de case_row; devolver tal cual
        return children

    
    def vector(self, children):
        """Maneja vectores."""
        return ('vector', children[0] if children else [])
    
    def abs_value(self, children):
        """Valor absoluto."""
        return ('abs', children[0])
    
    def norm(self, children):
        """Norma de vector."""
        return ('norm', children[0])
    
    @v_args(inline=True)
    def norm_expr(self, expr):
        """Maneja ||expr||."""
        return ('norm', expr)

    def cases_expr(self, children):
        """Normaliza cases(...) a ('cases', [(expr, cond), ...])."""
        items = children[0] if (len(children) == 1 and isinstance(children[0], list)) else children
        rows = []
        for item in items:
            if isinstance(item, tuple) and item and item[0] == 'case_row':
                rows.append((item[1], item[2]))
        return ('cases', rows)

    def cond_call(self, children):
        """Maneja F(A|B) de forma robusta (sin inline)."""
        if not children:
            return ('call', '', [])
        first = children[0]
        func_name = str(getattr(first, 'value', first))
        left_expr = None
        right_expr = None
        try:
            from lark.tree import Tree
        except Exception:
            Tree = tuple  # Fallback no-op
        for ch in children[1:]:
            node = None
            if isinstance(ch, tuple):
                node = ch
            elif 'Tree' in str(type(ch)):
                # Transformar el subtree para obtener AST
                try:
                    node = self.transform(ch)
                except Exception:
                    node = None
            if node is not None:
                if left_expr is None:
                    left_expr = node
                elif right_expr is None:
                    right_expr = node
        if left_expr is None:
            left_expr = ('var', 'A')
        if right_expr is None:
            right_expr = ('var', 'B')
        return ('call', func_name, [('conditional', left_expr, right_expr)])
    
    def tuple_atom(self, children):
        return ('tuple', children[0])
    
    @v_args(inline=True)
    def start(self, equation):
        """Punto de entrada del parser."""
        return equation
    
    @v_args(inline=True) 
    def equation(self, expr_chain):
        """Ecuación principal."""
        return expr_chain
    
    @v_args(inline=True)
    def expr_chain(self, *args):
        """Cadena de expresiones."""
        if len(args) == 1:
            return args[0]
        elif len(args) == 3:  # expr EQ expr
            return ('equation', args[0], args[2])
        else:
            return ('equation_chain', list(args))
    
    @v_args(inline=True)
    def comparison(self, *args):
        """Comparación."""
        if len(args) == 1:
            return args[0]
        elif len(args) == 3:  # left op right
            return ('comparison', str(args[1]), args[0], args[2])
        else:
            return args[0]

    @v_args(inline=True)
    def case_condition(self, *args):
        """Normaliza la condición de cases: comparison | expr EQ expr."""
        if len(args) == 1:
            return args[0]
        elif len(args) == 3:
            return ('comparison', '=', args[0], args[2])
        return args[0]
    
    @v_args(inline=True)
    def expr(self, *args):
        """Expresión aritmética."""
        if len(args) == 1:
            return args[0]
        elif len(args) == 3:  # left op right
            return ('binop', str(args[1]), args[0], args[2])
        else:
            return args[0]
    
    @v_args(inline=True) 
    def term(self, *args):
        """Término (multiplicación/división)."""
        if len(args) == 1:
            return args[0]
        elif len(args) == 3:  # left op right
            return ('binop', str(args[1]), args[0], args[2])
        else:
            return args[0]
    
    @v_args(inline=True)
    def factor(self, *args):
        """Factor (operadores unarios)."""
        if len(args) == 1:
            return args[0]
        elif len(args) == 2:  # unary op operand
            return ('unaryop', str(args[0]), args[1])
        else:
            return args[0]
    
    @v_args(inline=True)
    def power(self, *args):
        """Potencia."""
        if len(args) == 1:
            return args[0]
        elif len(args) == 3:  # base ^ exp
            return ('power', args[0], args[2])
        else:
            return args[0]
    
    @v_args(inline=True)
    def sub(self, *args):
        """Subíndice."""
        if len(args) == 1:
            return args[0]
        elif len(args) == 3:  # base _ sub
            return ('subscript', args[0], args[2])
        else:
            return args[0]
    
    @v_args(inline=True)
    def atom(self, *args):
        """Átomo."""
        # Si es una función (VAR seguido de paréntesis con args)
        if (len(args) >= 2 and 
            hasattr(args[0], 'type') and args[0].type == 'VAR' and
            isinstance(args[1], list)):  # lista de argumentos
            func_name = str(args[0].value)
            arg_list = args[1] if args[1] else []
            return ('call', func_name, arg_list)
        else:
            return args[0]
    
    @v_args(inline=True)
    def expr_list(self, *args):
        """Lista de expresiones."""
        # Filtrar tokens de coma
        return [arg for arg in args if not (hasattr(arg, 'type') and arg.type == 'COMMA')]

# --- GENERADOR OMML MEJORADO ---
if HAS_LXML:
    MATH_NS = "http://schemas.openxmlformats.org/officeDocument/2006/math"
    M = "{%s}" % MATH_NS

    def create_omml_run(text_content: str, is_operator: bool = False, 
                       style: str = None) -> etree._Element:
        """Crea un nodo OMML <m:r><m:t>...</m:t></m:r> con estilos opcionales."""
        m_r = etree.Element(M + "r")
        
        # Añadir propiedades de estilo si se especifican
        if style:
            m_rPr = etree.SubElement(m_r, M + "rPr")
            if style == "bold":
                m_b = etree.SubElement(m_rPr, M + "b")
                m_b.set(M + "val", "on")
            elif style == "italic":
                m_i = etree.SubElement(m_rPr, M + "i")
                m_i.set(M + "val", "on")
            elif style == "script":
                m_scr = etree.SubElement(m_rPr, M + "scr")
                m_scr.set(M + "val", "script")
        
        m_t = etree.SubElement(m_r, M + "t")
        if text_content.strip() != text_content:
            m_t.set(etree.QName("http://www.w3.org/XML/1998/namespace", "space"), "preserve")
        m_t.text = text_content
        return m_r

    def build_plain_omml_from_text(text: str) -> etree._Element:
        """Genera un oMath sencillo con corridas preservando los espacios."""
        m_oMath = etree.Element(M + "oMath")
        for part in re.split(r'(\s+)', text):
            if part == "":
                continue
            if part.isspace():
                m_oMath.append(create_omml_run(part))
            else:
                style = "italic" if re.match(r'^[A-Za-zΑ-Ωα-ω][A-Za-z0-9Α-Ωα-ω_]*$', part) else None
                m_oMath.append(create_omml_run(part, style=style))
        if not list(m_oMath):
            m_oMath.append(create_omml_run(""))
        return m_oMath

    def generate_enhanced_omml(ast_node) -> List[etree._Element]:
        """Generador OMML mejorado con soporte para nuevas estructuras."""
        if not isinstance(ast_node, tuple) or not ast_node:
            # Manejar listas que podrían ser matrices/vectores sin procesar
            if isinstance(ast_node, list):
                # Detectar si es una matriz: contiene SEMICOLON
                has_semicolon = any(hasattr(item, 'type') and item.type == 'SEMICOLON' for item in ast_node)
                
                if has_semicolon:
                    # Es una matriz sin procesar
                    return generate_enhanced_omml(('matrix', ast_node))
                else:
                    # Es un vector sin procesar
                    return generate_enhanced_omml(('vector', ast_node))
            
            # Manejar tokens de Lark directamente
            if hasattr(ast_node, 'type') and hasattr(ast_node, 'value'):
                var_name = str(ast_node.value)
                if ast_node.type == 'VAR':
                    # Detectar subíndices en variables con tokens de Lark
                    if '_' in var_name and not var_name.startswith('_') and not var_name.endswith('_'):
                        parts = var_name.split('_', 1)
                        if len(parts) == 2:
                            base_name, subscript_text = parts
                            # Mapear base a símbolo griego si aplica
                            if CONFIG.greek_mode in ['auto', 'symbols']:
                                base_name = GREEK_MAP.get(base_name, base_name)
                            # Crear subíndice OMML
                            m_sSub = etree.Element(M + "sSub")
                            m_e = etree.SubElement(m_sSub, M + "e")
                            m_sub = etree.SubElement(m_sSub, M + "sub")
                            
                            # Base en cursiva si es una letra
                            base_style = "italic" if len(base_name) == 1 and base_name.isalpha() else None
                            m_e.append(create_omml_run(base_name, style=base_style))
                            m_sub.append(create_omml_run(subscript_text))
                            
                            return [m_sSub]
                    
                    # Variable normal (aplicar mapeo griego si procede)
                    display_name = var_name
                    if CONFIG.greek_mode in ['auto', 'symbols']:
                        display_name = GREEK_MAP.get(display_name, display_name)
                    style = "italic" if len(display_name) == 1 and display_name.isalpha() else None
                    return [create_omml_run(display_name, style=style)]
                elif ast_node.type == 'NUMBER':
                    return [create_omml_run(str(ast_node.value))]
                else:
                    return [create_omml_run(str(ast_node.value))]
            if CONFIG.debug_mode:
                _logger.debug("Nodo AST inesperado: %r", ast_node)
            return [create_omml_run(str(ast_node))]
        
        node_type = ast_node[0]
        
        # Números
        if node_type == 'num':
            return [create_omml_run(ast_node[1])]
        
        # Variables
        elif node_type == 'var':
            var_name = ast_node[1]
            # Detectar subíndices en el nombre de variable (como x_1, x_2)
            if '_' in var_name and not var_name.startswith('_') and not var_name.endswith('_'):
                parts = var_name.split('_', 1)  # Solo el primer underscore
                if len(parts) == 2:
                    base_name, subscript_text = parts
                    # Mapear base a símbolo griego si aplica
                    if CONFIG.greek_mode in ['auto', 'symbols']:
                        base_name = GREEK_MAP.get(base_name, base_name)
                    # Crear subíndice OMML
                    m_sSub = etree.Element(M + "sSub")
                    m_e = etree.SubElement(m_sSub, M + "e")
                    m_sub = etree.SubElement(m_sSub, M + "sub")
                    
                    # Base en cursiva si es una letra
                    base_style = "italic" if len(base_name) == 1 and base_name.isalpha() else None
                    m_e.append(create_omml_run(base_name, style=base_style))
                    m_sub.append(create_omml_run(subscript_text))
                    
                    return [m_sSub]
            
            # Variable normal - aplicar mapeo griego si procede y estilos
            display_name = var_name
            if CONFIG.greek_mode in ['auto', 'symbols']:
                display_name = GREEK_MAP.get(display_name, display_name)
            style = None
            if len(display_name) == 1 and display_name.isalpha():
                style = "italic"  # Variables de una letra en cursiva
            return [create_omml_run(display_name, style=style)]
        
        # Operadores unarios
        elif node_type == 'unaryop':
            op = ast_node[1]
            operand = ast_node[2]
            op_run = create_omml_run(op, is_operator=True)
            operand_omml = generate_enhanced_omml(operand)
            return [op_run] + operand_omml
        
        # Operadores binarios
        elif node_type == 'binop':
            op = ast_node[1]
            left = ast_node[2]
            right = ast_node[3]
            
            left_omml = generate_enhanced_omml(left)
            right_omml = generate_enhanced_omml(right)
            
            # Símbolos de operadores mejorados
            op_symbols = {
                '+': '+', '-': '-', '*': '⋅', '/': '/', '=': '=', '|': '|'
            }
            op_symbol = op_symbols.get(op, op)
            
            # Manejo especial de división
            if op == '/':
                m_f = etree.Element(M + "f")
                m_num = etree.SubElement(m_f, M + "num")
                m_den = etree.SubElement(m_f, M + "den")
                m_num.extend(left_omml)
                m_den.extend(right_omml)
                return [m_f]
            
            op_run = create_omml_run(op_symbol, is_operator=True)
            return left_omml + [op_run] + right_omml
        elif node_type == 'implicit_mul':
            space = ast_node[1] if len(ast_node) > 1 else ' '
            if not space:
                space = ' '
            left = ast_node[2] if len(ast_node) > 2 else None
            right = ast_node[3] if len(ast_node) > 3 else None
            left_omml = generate_enhanced_omml(left) if left is not None else []
            right_omml = generate_enhanced_omml(right) if right is not None else []
            space_run = create_omml_run(space)
            return left_omml + [space_run] + right_omml
        
        # Exponentes
        elif node_type == 'power':
            base = ast_node[1]
            exponent = ast_node[2]
            
            m_sSup = etree.Element(M + "sSup")
            m_e = etree.SubElement(m_sSup, M + "e")
            m_sup = etree.SubElement(m_sSup, M + "sup")
            
            m_e.extend(generate_enhanced_omml(base))
            m_sup.extend(generate_enhanced_omml(exponent))
            
            return [m_sSup]
        
        # Subíndices
        elif node_type == 'subscript':
            base = ast_node[1]
            subscript = ast_node[2]
            
            m_sSub = etree.Element(M + "sSub")
            m_e = etree.SubElement(m_sSub, M + "e")
            m_sub = etree.SubElement(m_sSub, M + "sub")
            
            m_e.extend(generate_enhanced_omml(base))
            
            # Manejo de subíndices múltiples
            if isinstance(subscript, tuple) and subscript[0] == 'tuple':
                items = subscript[1]
                for i, item in enumerate(items):
                    if i > 0:
                        m_sub.append(create_omml_run(","))
                    m_sub.extend(generate_enhanced_omml(item))
            else:
                m_sub.extend(generate_enhanced_omml(subscript))
            
            return [m_sSub]
        
        # Llamadas a funciones
        elif node_type == 'call':
            func_name = ast_node[1]
            args = ast_node[2]
            
            # Funciones especiales
            # Sumatorias y productos: sum_i_from_a_to_b(expr), prod_i_from_a_to_b(expr)
            if isinstance(func_name, str) and (func_name.startswith('sum_') or func_name.startswith('prod_')):
                try:
                    parts = func_name.split('_')
                    if len(parts) >= 5 and parts[2] == 'from' and 'to' in parts:
                        var_symbol = parts[1]
                        to_index = parts.index('to')
                        lower_bound_text = parts[3]
                        upper_bound_text = parts[to_index + 1] if to_index + 1 < len(parts) else ''
                        nary_char = '∑' if parts[0] == 'sum' else '∏'

                        m_nary = etree.Element(M + 'nary')
                        m_naryPr = etree.SubElement(m_nary, M + 'naryPr')
                        m_chr = etree.SubElement(m_naryPr, M + 'chr')
                        m_chr.set(M + 'val', nary_char)
                        m_limLoc = etree.SubElement(m_naryPr, M + 'limLoc')
                        m_limLoc.set(M + 'val', 'subSup')

                        # sub: i = lower
                        m_sub = etree.SubElement(m_nary, M + 'sub')
                        # Usar estructura OMML con runs separados
                        m_sub.append(create_omml_run(var_symbol))
                        m_sub.append(create_omml_run(' = '))
                        # Renderizar el límite inferior como OMML si es AST
                        # Renderizado simple del límite inferior (sin re-parse interno)
                        m_sub.append(create_omml_run(lower_bound_text))

                        # sup: upper
                        m_sup = etree.SubElement(m_nary, M + 'sup')
                        # Renderizado simple del límite superior
                        m_sup.append(create_omml_run(upper_bound_text))

                        # expression
                        m_e = etree.SubElement(m_nary, M + 'e')
                        if args:
                            # Filtrar tokens de coma
                            filtered_args = [arg for arg in args if not (hasattr(arg, 'type') and arg.type == 'COMMA')]
                            if filtered_args:
                                m_e.extend(generate_enhanced_omml(filtered_args[0]))
                        return [m_nary]
                except Exception:
                    # Si algo falla, continuar con procesamiento genérico
                    pass

            # Límites: lim_x_to_a(expr)
            if isinstance(func_name, str) and func_name.startswith('lim_'):
                try:
                    parts = func_name.split('_')
                    if len(parts) >= 4 and parts[2] == 'to':
                        var_symbol = parts[1]
                        approach_text = parts[3]

                        # Crear subíndice lim_{x→a}
                        m_sSub = etree.Element(M + 'sSub')
                        m_e = etree.SubElement(m_sSub, M + 'e')
                        m_sub = etree.SubElement(m_sSub, M + 'sub')
                        m_e.append(create_omml_run('lim'))
                        m_sub.append(create_omml_run(var_symbol))
                        m_sub.append(create_omml_run(' → '))
                        m_sub.append(create_omml_run(approach_text))

                        result = [m_sSub]
                        if args:
                            filtered_args = [arg for arg in args if not (hasattr(arg, 'type') and arg.type == 'COMMA')]
                            if filtered_args:
                                result.extend(generate_enhanced_omml(filtered_args[0]))
                        return result
                except Exception:
                    # Fallback a genérico si falla
                    pass

            if func_name == 'sqrt':
                if len(args) != 1:
                    raise ValueError(f"sqrt requiere exactamente 1 argumento, recibió {len(args)}")
                
                m_rad = etree.Element(M + "rad")
                m_radPr = etree.SubElement(m_rad, M + "radPr")
                m_degHide = etree.SubElement(m_radPr, M + "degHide")
                m_degHide.set(M + "val", "on")
                m_e = etree.SubElement(m_rad, M + "e")
                m_e.extend(generate_enhanced_omml(args[0]))
                return [m_rad]
            
            elif func_name == 'frac':
                if len(args) != 2:
                    raise ValueError(f"frac requiere exactamente 2 argumentos, recibió {len(args)}")
                
                m_f = etree.Element(M + "f")
                m_num = etree.SubElement(m_f, M + "num")
                m_den = etree.SubElement(m_f, M + "den")
                m_num.extend(generate_enhanced_omml(args[0]))
                m_den.extend(generate_enhanced_omml(args[1]))
                return [m_f]
            
            elif func_name == 'integral':
                # Integral definida: integral(expr, lower, upper)
                if len(args) == 3:
                    m_nary = etree.Element(M + "nary")
                    m_naryPr = etree.SubElement(m_nary, M + "naryPr")
                    m_chr = etree.SubElement(m_naryPr, M + "chr")
                    m_chr.set(M + "val", "∫")
                    
                    m_limLoc = etree.SubElement(m_naryPr, M + "limLoc")
                    m_limLoc.set(M + "val", "subSup")
                    
                    m_sub = etree.SubElement(m_nary, M + "sub")
                    m_sub.extend(generate_enhanced_omml(args[1]))
                    
                    m_sup = etree.SubElement(m_nary, M + "sup")
                    m_sup.extend(generate_enhanced_omml(args[2]))
                    
                    m_e = etree.SubElement(m_nary, M + "e")
                    m_e.extend(generate_enhanced_omml(args[0]))
                    
                    return [m_nary]
                # Integral indefinida: integral(expr)
                elif len(args) == 1:
                    result = [create_omml_run("∫")]
                    result.extend(generate_enhanced_omml(args[0]))
                    result.append(create_omml_run(" dx"))
                    return result
                else:
                    raise ValueError(f"integral requiere 1 o 3 argumentos, recibió {len(args)}")
            
            # Funciones trigonométricas y otras funciones matemáticas
            elif func_name in ['sin', 'cos', 'tan', 'sinh', 'cosh', 'tanh', 'log', 'ln', 'exp']:
                result = [create_omml_run(func_name)]
                if args:
                    result.append(create_omml_run("("))
                    # Filtrar tokens de coma
                    filtered_args = [arg for arg in args if not (hasattr(arg, 'type') and arg.type == 'COMMA')]
                    for i, arg in enumerate(filtered_args):
                        if i > 0:
                            result.append(create_omml_run(", "))
                        result.extend(generate_enhanced_omml(arg))
                    result.append(create_omml_run(")"))
                return result
            
            # Función cases especial
            elif func_name == 'cases':
                # Crear estructura de casos usando matrices
                m_d = etree.Element(M + "d")
                m_dPr = etree.SubElement(m_d, M + "dPr")
                m_begChr = etree.SubElement(m_dPr, M + "begChr")
                m_begChr.set(M + "val", "{")
                m_endChr = etree.SubElement(m_dPr, M + "endChr")
                m_endChr.set(M + "val", "")  # Sin delimitador derecho
                
                # Crear matriz interna para los casos
                m_m = etree.Element(M + "m")
                m_mPr = etree.SubElement(m_m, M + "mPr")
                m_mcs = etree.SubElement(m_mPr, M + "mcs")
                
                # Dos columnas: expresión y condición
                for _ in range(2):
                    m_mc = etree.SubElement(m_mcs, M + "mc")
                    m_mcPr = etree.SubElement(m_mc, M + "mcPr")
                    m_count = etree.SubElement(m_mcPr, M + "count")
                    m_count.set(M + "val", "1")
                
                # Procesar argumentos de cases (debería ser el contenido preprocesado)
                if args:
                    # args[0] debería contener el contenido preprocesado con __
                    cases_content = str(args[0]) if args else ""
                    # Parsear casos separados por __
                    cases_parts = cases_content.split('__')
                    
                    for case_part in cases_parts:
                        if '_when_' in case_part:
                            expr_part, cond_part = case_part.split('_when_', 1)
                        else:
                            expr_part = case_part
                            cond_part = ""
                        
                        # Crear fila de matriz
                        m_mr = etree.SubElement(m_m, M + "mr")
                        
                        # Columna de expresión
                        m_e1 = etree.SubElement(m_mr, M + "e")
                        m_e1.append(create_omml_run(expr_part.replace('_eq_', '=')))
                        
                        # Columna de condición
                        m_e2 = etree.SubElement(m_mr, M + "e")
                        if cond_part:
                            cond_text = cond_part.replace('_geq_', '≥').replace('_leq_', '≤').replace('_eq_', '=').replace('_neq_', '≠')
                            m_e2.append(create_omml_run(cond_text))
                
                m_e_outer = etree.SubElement(m_d, M + "e")
                m_e_outer.append(m_m)
                
                return [m_d]
            
            # Función genérica
            else:
                result = [create_omml_run(func_name)]
                result.append(create_omml_run("("))
                
                # Filtrar tokens de coma
                filtered_args = [arg for arg in args if not (hasattr(arg, 'type') and arg.type == 'COMMA')]
                for i, arg in enumerate(filtered_args):
                    if i > 0:
                        result.append(create_omml_run(", "))
                    result.extend(generate_enhanced_omml(arg))
                
                result.append(create_omml_run(")"))
                return result
        
        # Matrices (manejo especial para listas de tokens de Lark)
        elif node_type == 'matrix':
            rows_data = ast_node[1]
            # Normalizar a lista de filas (lista de listas de celdas)
            processed_rows = []
            current_row = []
            if isinstance(rows_data, list):
                for item in rows_data:
                    if hasattr(item, 'type') and item.type == 'SEMICOLON':
                        if current_row:
                            processed_rows.append(current_row)
                            current_row = []
                    elif hasattr(item, 'type') and item.type == 'COMMA':
                        continue
                    elif isinstance(item, list):
                        subrow = []
                        for subitem in item:
                            if not (hasattr(subitem, 'type') and subitem.type == 'COMMA'):
                                subrow.append(subitem)
                        current_row.extend(subrow)
                    else:
                        current_row.append(item)
                if current_row:
                    processed_rows.append(current_row)
            else:
                processed_rows = [[rows_data]]

            # Determinar número de columnas máximo
            num_cols = max((len(r) for r in processed_rows), default=0)

            # Construir matriz OMML m:m
            m_m = etree.Element(M + 'm')
            m_mPr = etree.SubElement(m_m, M + 'mPr')
            m_mcs = etree.SubElement(m_mPr, M + 'mcs')
            for _ in range(max(1, num_cols)):
                m_mc = etree.SubElement(m_mcs, M + 'mc')
                m_mcPr = etree.SubElement(m_mc, M + 'mcPr')
                m_count = etree.SubElement(m_mcPr, M + 'count')
                m_count.set(M + 'val', '1')

            for row in processed_rows:
                m_mr = etree.SubElement(m_m, M + 'mr')
                for col_index in range(num_cols):
                    m_e = etree.SubElement(m_mr, M + 'e')
                    if col_index < len(row):
                        m_e.extend(generate_enhanced_omml(row[col_index]))

            # Envolver con delimitadores según configuración
            style_map = {
                'pmatrix': ('(', ')'),
                'bmatrix': ('[', ']'),
                'Bmatrix': ('{', '}'),
                'vmatrix': ('|', '|'),
                'Vmatrix': ('∥', '∥'),
            }
            beg, end = style_map.get(CONFIG.matrix_style, ('[', ']'))
            m_d = etree.Element(M + 'd')
            m_dPr = etree.SubElement(m_d, M + 'dPr')
            m_begChr = etree.SubElement(m_dPr, M + 'begChr')
            m_begChr.set(M + 'val', beg)
            m_endChr = etree.SubElement(m_dPr, M + 'endChr')
            m_endChr.set(M + 'val', end)
            m_e_outer = etree.SubElement(m_d, M + 'e')
            m_e_outer.append(m_m)
            return [m_d]
        
        # Vectores (manejo especial para listas de tokens de Lark)
        elif node_type == 'vector':
            elements_data = ast_node[1]
            processed_elements = []
            if isinstance(elements_data, list):
                for item in elements_data:
                    if not (hasattr(item, 'type') and item.type == 'COMMA'):
                        processed_elements.append(item)
            else:
                processed_elements = [elements_data]

            # Usar delimitadores OMML ⟨ ⟩ y contenido separado por comas
            m_d = etree.Element(M + 'd')
            m_dPr = etree.SubElement(m_d, M + 'dPr')
            m_begChr = etree.SubElement(m_dPr, M + 'begChr')
            m_begChr.set(M + 'val', '⟨')
            m_endChr = etree.SubElement(m_dPr, M + 'endChr')
            m_endChr.set(M + 'val', '⟩')

            m_e = etree.SubElement(m_d, M + 'e')
            for i, elem in enumerate(processed_elements):
                if i > 0:
                    m_e.append(create_omml_run(', '))
                m_e.extend(generate_enhanced_omml(elem))

            return [m_d]
        
        # Valor absoluto
        elif node_type == 'abs':
            expr = ast_node[1]
            
            m_d = etree.Element(M + "d")
            m_dPr = etree.SubElement(m_d, M + "dPr")
            m_begChr = etree.SubElement(m_dPr, M + "begChr")
            m_begChr.set(M + "val", "|")
            m_endChr = etree.SubElement(m_dPr, M + "endChr")
            m_endChr.set(M + "val", "|")
            
            m_e = etree.SubElement(m_d, M + "e")
            m_e.extend(generate_enhanced_omml(expr))
            
            return [m_d]
        
        # Norma (barras dobles)
        elif node_type == 'norm':
            expr = ast_node[1]
            
            m_d = etree.Element(M + "d")
            m_dPr = etree.SubElement(m_d, M + "dPr")
            m_begChr = etree.SubElement(m_dPr, M + "begChr")
            m_begChr.set(M + "val", "∥")
            m_endChr = etree.SubElement(m_dPr, M + "endChr")
            m_endChr.set(M + "val", "∥")
            
            m_e = etree.SubElement(m_d, M + "e")
            m_e.extend(generate_enhanced_omml(expr))
            
            return [m_d]
        
        # Integral
        elif node_type == 'integral':
            args = ast_node[1]
            
            m_nary = etree.Element(M + "nary")
            m_naryPr = etree.SubElement(m_nary, M + "naryPr")
            m_chr = etree.SubElement(m_naryPr, M + "chr")
            m_chr.set(M + "val", "∫")
            
            if len(args) == 3:  # Integral definida
                m_limLoc = etree.SubElement(m_naryPr, M + "limLoc")
                m_limLoc.set(M + "val", "subSup")
                
                m_sub = etree.SubElement(m_nary, M + "sub")
                m_sub.extend(generate_enhanced_omml(args[1]))
                
                m_sup = etree.SubElement(m_nary, M + "sup")
                m_sup.extend(generate_enhanced_omml(args[2]))
            
            m_e = etree.SubElement(m_nary, M + "e")
            m_e.extend(generate_enhanced_omml(args[0]))
            
            return [m_nary]
        
        # Límites
        elif node_type == 'limit':
            var = ast_node[1]
            approach = ast_node[2]
            expr = ast_node[3]
            
            result = [create_omml_run("lim")]
            
            # Subíndice con la variable y el punto de aproximación
            m_sSub = etree.Element(M + "sSub")
            m_e = etree.SubElement(m_sSub, M + "e")
            m_sub = etree.SubElement(m_sSub, M + "sub")
            
            m_e.append(create_omml_run("lim"))
            m_sub.extend([create_omml_run(var), create_omml_run("→")] + 
                        generate_enhanced_omml(approach))
            
            result = [m_sSub]
            result.extend(generate_enhanced_omml(expr))
            
            return result
        
        # Tuplas
        elif node_type == 'tuple':
            elements = ast_node[1]
            result = [create_omml_run("(")]
            for i, elem in enumerate(elements):
                if i > 0:
                    result.append(create_omml_run(", "))
                result.extend(generate_enhanced_omml(elem))
            result.append(create_omml_run(")"))
            return result
        
        # Ecuaciones
        elif node_type == 'equation':
            left = ast_node[1]
            right = ast_node[2]
            
            left_omml = generate_enhanced_omml(left)
            right_omml = generate_enhanced_omml(right)
            eq_run = create_omml_run("=", is_operator=True)
            
            return left_omml + [eq_run] + right_omml
        
        # Cadenas de ecuaciones (a = b = c)
        elif node_type == 'equation_chain':
            items = ast_node[1]
            result = []
            for i, item in enumerate(items):
                if i > 0:
                    result.append(create_omml_run("=", is_operator=True))
                result.extend(generate_enhanced_omml(item))
            return result
        
        # Operadores de comparación
        elif node_type == 'comparison':
            op = ast_node[1]
            left = ast_node[2]
            right = ast_node[3]
            
            left_omml = generate_enhanced_omml(left)
            right_omml = generate_enhanced_omml(right)
            
            # Mapear operadores de comparación a símbolos
            comp_symbols = {
                '>': '>', '<': '<', '>=': '≥', '<=': '≤', '!=': '≠'
            }
            op_symbol = comp_symbols.get(op, op)
            op_run = create_omml_run(op_symbol, is_operator=True)
            
            return left_omml + [op_run] + right_omml
        
        # Expresiones condicionales (para P(A|B))
        elif node_type == 'conditional':
            left_part = ast_node[1]
            right_part = ast_node[2]
            
            result = []
            # Si vienen como AST, renderizarlos; si son strings, crear run directo
            if isinstance(left_part, tuple):
                result.extend(generate_enhanced_omml(left_part))
            else:
                result.append(create_omml_run(str(left_part)))
            result.append(create_omml_run("|"))
            if isinstance(right_part, tuple):
                result.extend(generate_enhanced_omml(right_part))
            else:
                result.append(create_omml_run(str(right_part)))
            
            return result

        # Cases: ('cases', [(expr, cond), ...])
        elif node_type == 'cases':
            rows = ast_node[1] if len(ast_node) > 1 else []

            m_d = etree.Element(M + 'd')
            m_dPr = etree.SubElement(m_d, M + 'dPr')
            m_begChr = etree.SubElement(m_dPr, M + 'begChr')
            m_begChr.set(M + 'val', '{')
            m_endChr = etree.SubElement(m_dPr, M + 'endChr')
            m_endChr.set(M + 'val', '')

            m_m = etree.Element(M + 'm')
            m_mPr = etree.SubElement(m_m, M + 'mPr')
            m_mcs = etree.SubElement(m_mPr, M + 'mcs')
            # Dos columnas: valor y condición
            for _ in range(2):
                m_mc = etree.SubElement(m_mcs, M + 'mc')
                m_mcPr = etree.SubElement(m_mc, M + 'mcPr')
                m_count = etree.SubElement(m_mcPr, M + 'count')
                m_count.set(M + 'val', '1')

            for row in rows:
                m_mr = etree.SubElement(m_m, M + 'mr')
                m_e1 = etree.SubElement(m_mr, M + 'e')
                expr_node = row[0] if isinstance(row, (list, tuple)) and len(row) > 0 else row
                cond_node = row[1] if isinstance(row, (list, tuple)) and len(row) > 1 else None
                if expr_node is not None:
                    m_e1.extend(generate_enhanced_omml(expr_node))
                m_e2 = etree.SubElement(m_mr, M + 'e')
                if cond_node is not None:
                    m_e2.extend(generate_enhanced_omml(cond_node))

            m_e_outer = etree.SubElement(m_d, M + 'e')
            m_e_outer.append(m_m)
            return [m_d]
        
        else:
            if CONFIG.debug_mode:
                _logger.debug("Tipo de nodo AST no reconocido: %s", node_type)
            return [create_omml_run(f"<?{node_type}?>")]

    def build_enhanced_omml_element(ast_root) -> etree._Element:
        """Construye el elemento OMML completo."""
        m_oMath = etree.Element(M + "oMath")
        omml_content = generate_enhanced_omml(ast_root)
        m_oMath.extend(omml_content)
        return m_oMath

else:
    # Versiones dummy cuando lxml no está disponible
    def create_omml_run(text_content: str, **kwargs):
        return f"<m:r><m:t>{text_content}</m:t></m:r>"

    def build_plain_omml_from_text(text: str):
        return text
    
    def generate_enhanced_omml(ast_node):
        """Versión simplificada que genera representación textual."""
        if not isinstance(ast_node, tuple) or not ast_node:
            return [str(ast_node)]
        
        node_type = ast_node[0]
        
        if node_type == 'num':
            return [ast_node[1]]
        elif node_type == 'var':
            return [ast_node[1]]
        elif node_type == 'binop':
            op = ast_node[1]
            left = generate_enhanced_omml(ast_node[2])
            right = generate_enhanced_omml(ast_node[3])
            return left + [f" {op} "] + right
        elif node_type == 'implicit_mul':
            space = ast_node[1] if len(ast_node) > 1 else ' '
            if not space.strip():
                space = ' '
            left = generate_enhanced_omml(ast_node[2]) if len(ast_node) > 2 else []
            right = generate_enhanced_omml(ast_node[3]) if len(ast_node) > 3 else []
            return left + [space] + right
        elif node_type == 'power':
            base = generate_enhanced_omml(ast_node[1])
            exp = generate_enhanced_omml(ast_node[2])
            return base + ["^("] + exp + [")"]
        elif node_type == 'subscript':
            base = generate_enhanced_omml(ast_node[1])
            sub = generate_enhanced_omml(ast_node[2])
            return base + ["_("] + sub + [")"]
        elif node_type == 'call':
            func_name = ast_node[1]
            args = ast_node[2]
            result = [func_name, "("]
            for i, arg in enumerate(args):
                if i > 0:
                    result.append(", ")
                result.extend(generate_enhanced_omml(arg))
            result.append(")")
            return result
        elif node_type == 'equation':
            left = generate_enhanced_omml(ast_node[1])
            right = generate_enhanced_omml(ast_node[2])
            return left + [" = "] + right
        elif node_type == 'equation_chain':
            items = ast_node[1]
            result = []
            for i, item in enumerate(items):
                if i > 0:
                    result.append(" = ")
                result.extend(generate_enhanced_omml(item))
            return result
        elif node_type == 'comparison':
            op = ast_node[1]
            left = generate_enhanced_omml(ast_node[2])
            right = generate_enhanced_omml(ast_node[3])
            comp_symbols = {
                '>': '>', '<': '<', '>=': '≥', '<=': '≤', '!=': '≠'
            }
            op_symbol = comp_symbols.get(op, op)
            return left + [f" {op_symbol} "] + right
        elif node_type == 'matrix':
            rows = ast_node[1]
            result = ["["]
            for i, row in enumerate(rows):
                if i > 0:
                    result.append("; ")
                for j, cell in enumerate(row):
                    if j > 0:
                        result.append(", ")
                    result.extend(generate_enhanced_omml(cell))
            result.append("]")
            return result
        elif node_type == 'vector':
            elements = ast_node[1]
            result = ["⟨"]
            for i, elem in enumerate(elements):
                if i > 0:
                    result.append(", ")
                result.extend(generate_enhanced_omml(elem))
            result.append("⟩")
            return result
        elif node_type == 'abs':
            expr = generate_enhanced_omml(ast_node[1])
            return ["|"] + expr + ["|"]
        elif node_type == 'norm':
            expr = generate_enhanced_omml(ast_node[1])
            return ["||"] + expr + ["||"]
        else:
            return [f"[{node_type}]"]
    
    def build_enhanced_omml_element(ast_root):
        """Versión que retorna representación textual."""
        parts = generate_enhanced_omml(ast_root)
        return "".join(parts)

# --- GRAMÁTICA LARK COMPILADA (SINGLETON) ---
_COMPILED_LARK_PARSER: Optional[Any] = None
_LARK_COMPILE_ERROR: Optional[str] = None


def _get_compiled_lark_parser():
    """Obtiene el parser Lark compilado (singleton, lazy initialization)."""
    global _COMPILED_LARK_PARSER, _LARK_COMPILE_ERROR
    
    if _COMPILED_LARK_PARSER is not None:
        return _COMPILED_LARK_PARSER
    
    if _LARK_COMPILE_ERROR is not None:
        return None  # Ya intentamos y falló
    
    if not HAS_LARK:
        _LARK_COMPILE_ERROR = "Lark no disponible"
        return None
    
    try:
        _COMPILED_LARK_PARSER = Lark(ENHANCED_MATH_GRAMMAR, start='equation')
        _logger.debug("Parser Lark inicializado correctamente")
        return _COMPILED_LARK_PARSER
    except Exception as e:
        _LARK_COMPILE_ERROR = str(e)
        _logger.warning("Error inicializando Lark parser: %s", e)
        return None


# --- CLASE PRINCIPAL DEL PARSER ---
class EnhancedMathParser:
    """Parser matemático mejorado con todas las funcionalidades."""
    
    def __init__(self):
        self.lark_parser = _get_compiled_lark_parser()  # Usa singleton
        self.transformer = EnhancedMathTransformer() if self.lark_parser else None
    
    def _initialize_parser(self):
        """Inicializa el parser apropiado (deprecated, usa singleton)."""
        self.lark_parser = _get_compiled_lark_parser()
        if self.lark_parser:
            self.transformer = EnhancedMathTransformer()
        
        if not self.lark_parser and CONFIG.debug_mode:
            _logger.info("Usando parser manual simplificado")
    
    def parse_expression(self, expression: str) -> ParseResult:
        """Parsea una expresión matemática."""
        start_time = datetime.now()
        result = ParseResult()
        
        try:
            # Verificar cache primero
            cached_result = CACHE.get(expression)
            if cached_result is not None:
                result.success = True
                result.omml_element = cached_result
                result.parse_time = 0.0
                return result
            
            # Preprocesar expresión
            processed_expr = self._preprocess_expression(expression)
            
            # Detectar si necesitamos parser manual para casos especiales
            # Con nueva regla Lark cond_call, ya no necesitamos parser manual para condicionales
            needs_manual_parser = False
            
            # Parsear con Lark si está disponible y no es un caso especial
            if self.lark_parser and not needs_manual_parser:
                try:
                    parse_tree = self.lark_parser.parse(processed_expr)
                    ast = self.transformer.transform(parse_tree)
                    
                    # Verificar si el AST es válido - si sigue siendo un Tree, algo salió mal
                    if hasattr(ast, '__class__') and 'Tree' in str(ast.__class__):
                        if CONFIG.debug_mode:
                            _logger.debug("Transformer devolvió Tree, usando parser manual para: %s", processed_expr)
                        manual_parser = SimpleMathParser(processed_expr)
                        ast = manual_parser.parse_expression()
                        
                except LarkError as e:
                    # Si Lark falla, intentar con parser manual
                    if CONFIG.debug_mode:
                        _logger.debug("Lark falló, usando parser manual: %s", e)
                    manual_parser = SimpleMathParser(processed_expr)
                    ast = manual_parser.parse_expression()
            else:
                # Usar parser manual para casos especiales o cuando Lark no está disponible
                manual_parser = SimpleMathParser(processed_expr)
                ast = manual_parser.parse_expression()
            
            # Generar OMML
            if HAS_LXML:
                omml_element = build_enhanced_omml_element(ast)
                result.omml_element = omml_element
                # Guardar en cache
                CACHE.put(expression, omml_element)
            else:
                result.omml_element = f"<dummy>{ast}</dummy>"
            
            result.success = True
            result.ast = ast
            
        except Exception as e:
            error_text = str(e) if e else ""
            error_lower = error_text.lower()
            has_whitespace = bool(re.search(r"\s", expression))
            fallback_keywords = (
                "entrada no reconocida",
                "expresión incompleta",
                "unexpected",
                "carácter inesperado",
            )
            fallback_allowed = has_whitespace and any(keyword in error_lower for keyword in fallback_keywords)
            if fallback_allowed:
                try:
                    fallback_element = build_plain_omml_from_text(expression)
                    result.omml_element = fallback_element
                    result.success = True
                    result.ast = ('plain_text', expression)
                    result.warnings.append('fallback_plain_text')
                    CACHE.put(expression, fallback_element)
                    result.error_message = ""
                except Exception as fb_exc:
                    result.error_message = error_text or str(fb_exc)
                    if CONFIG.debug_mode:
                        traceback.print_exc()
            else:
                result.error_message = error_text
                if CONFIG.debug_mode:
                    traceback.print_exc()
        
        finally:
            end_time = datetime.now()
            result.parse_time = (end_time - start_time).total_seconds()
        
        return result
    
    def _preprocess_expression(self, expr: str) -> str:
        """Preprocesa la expresión antes del parsing."""
        # Eliminar espacios extra
        expr = re.sub(r'\s+', ' ', expr.strip())
        
        # Reemplazar símbolos griegos (palabras completas o seguidas de _)
        for name, symbol in GREEK_MAP.items():
            pattern = r'(?<!\w)' + re.escape(name) + r'(?=\b|_)'
            expr = re.sub(pattern, symbol, expr)
        
        # Reemplazar constantes matemáticas (palabras completas o seguidas de _)
        for name, symbol in MATH_CONSTANTS.items():
            pattern = r'(?<!\w)' + re.escape(name) + r'(?=\b|_)'
            expr = re.sub(pattern, symbol, expr)
        
        # Reemplazar símbolos comunes
        replacements = {
            '**': '^',  # Python-style exponentiation
            '≤': '<=', '≥': '>=', '≠': '!=',
            '∞': 'inf', '∑': 'sum', '∏': 'prod',
            '∫': 'integral', '∂': 'partial',
            '√': 'sqrt', '∛': 'cbrt',
            '→': '->',  # Flecha derecha
        }
        
        for old, new in replacements.items():
            expr = expr.replace(old, new)
        
        # Manejo especial para funciones complejas
        
        # Límites: lim(x->0, f(x)) -> lim_x_to_0(f(x))
        expr = re.sub(r'lim\s*\(\s*(\w+)\s*->\s*([^,]+)\s*,\s*(.+)\)', r'lim_\1_to_\2(\3)', expr)
        # Alias: limit(x->0, f(x)) -> lim_x_to_0(f(x))
        expr = re.sub(r'limit\s*\(\s*(\w+)\s*->\s*([^,]+)\s*,\s*(.+)\)', r'lim_\1_to_\2(\3)', expr)
        
        # Sumatorias: sum(i=1,n,expr) -> sum_i_from_1_to_n(expr)
        expr = re.sub(r'sum\s*\(\s*(\w+)\s*=\s*([^,]+)\s*,\s*([^,]+)\s*,\s*(.+)\)', r'sum_\1_from_\2_to_\3(\4)', expr)
        # Productos: prod(i=1,n,expr) -> prod_i_from_1_to_n(expr)
        expr = re.sub(r'prod\s*\(\s*(\w+)\s*=\s*([^,]+)\s*,\s*([^,]+)\s*,\s*(.+)\)', r'prod_\1_from_\2_to_\3(\4)', expr)
        
        # Casos: dejar cases(...) para que Lark lo parsee según la gramática
        
        return expr
    
    def get_suggestions(self, expression: str) -> List[str]:
        """Obtiene sugerencias para expresiones incorrectas."""
        suggestions = []
        
        # Sugerencias comunes
        common_fixes = {
            'senx': 'sin(x)', 'cosx': 'cos(x)', 'tanx': 'tan(x)',
            'logx': 'log(x)', 'lnx': 'ln(x)', 'expx': 'exp(x)',
            'sqrtx': 'sqrt(x)', 'absx': 'abs(x)',
        }
        
        expr_lower = expression.lower().replace(' ', '')
        for wrong, correct in common_fixes.items():
            if wrong in expr_lower:
                suggestions.append(f"¿Quisiste decir '{correct}'?")
        
        # Verificar paréntesis desbalanceados
        if expression.count('(') != expression.count(')'):
            suggestions.append("Verifica que los paréntesis estén balanceados")
        
        # Verificar multiplicación implícita mal formada
        if re.search(r'\d[a-zA-Z]', expression):
            suggestions.append("Considera usar multiplicación explícita: '2*x' en lugar de '2x'")
        
        return suggestions

