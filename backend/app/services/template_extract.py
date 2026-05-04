"""Template extraction helpers."""

from __future__ import annotations

from typing import Any, Dict, List, Tuple

from app.services import template_service as _legacy

STYLE_BROWSER_CATEGORY_ORDER = [
    "titles",
    "headings",
    "body",
    "lists",
    "tables",
    "code",
    "captions",
    "other",
]

_MONOSPACE_HINTS = (
    "cascadia",
    "consolas",
    "courier",
    "courier new",
    "fira code",
    "jetbrains mono",
    "lucida console",
    "menlo",
    "monaco",
    "source code",
)

_CATEGORY_DESCRIPTIONS = {
    "titles": "Estilo detectado para portadas, títulos y subtítulos.",
    "headings": "Estilo detectado para encabezados jerárquicos.",
    "body": "Estilo detectado para párrafos de cuerpo o texto corrido.",
    "lists": "Estilo detectado para listas o numeraciones.",
    "tables": "Estilo detectado para tablas.",
    "code": "Estilo detectado para contenido monoespaciado o código.",
    "captions": "Estilo detectado para leyendas de figuras o tablas.",
    "other": "Estilo detectado sin clasificación preferente.",
}

SEMANTIC_STYLE_SLOT_ORDER = [
    "body",
    "heading_1",
    "heading_2",
    "heading_3",
    "heading_4",
    "heading_5",
    "heading_6",
    "list_bullet",
    "list_number",
    "caption",
    "code",
    "table_default",
]

_SEMANTIC_STYLE_SLOT_SPECS = {
    "body": {"category": "body", "style_type": "paragraph"},
    "heading_1": {"category": "headings", "style_type": "paragraph"},
    "heading_2": {"category": "headings", "style_type": "paragraph"},
    "heading_3": {"category": "headings", "style_type": "paragraph"},
    "heading_4": {"category": "headings", "style_type": "paragraph"},
    "heading_5": {"category": "headings", "style_type": "paragraph"},
    "heading_6": {"category": "headings", "style_type": "paragraph"},
    "list_bullet": {"category": "lists", "style_type": "paragraph"},
    "list_number": {"category": "lists", "style_type": "paragraph"},
    "caption": {"category": "captions", "style_type": "paragraph"},
    "code": {"category": "code", "style_type": "paragraph"},
    "table_default": {"category": "tables", "style_type": "table"},
}


def extract_styles_from_docx(docx_bytes: bytes) -> Dict[str, Any]:
    # Keep extraction core in legacy service while coverage logic is owned here.
    return _legacy.extract_styles_from_docx(docx_bytes)


def _clean_text(value: Any) -> str:
    return str(value).strip() if value not in (None, "") else ""


def _style_display_name(style: Dict[str, Any]) -> str:
    return (
        _clean_text(style.get("display_name"))
        or _clean_text(style.get("name"))
        or _clean_text(style.get("style_id"))
        or "Style"
    )


def _style_name_tokens(style: Dict[str, Any]) -> List[str]:
    tokens = []
    for key in ("style_id", "display_name", "name", "base_style"):
        text = _clean_text(style.get(key))
        if text:
            tokens.append(text.lower())
    return tokens


def _parse_int(value: Any) -> int | None:
    if value in (None, ""):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _selection_key_base(value: Any) -> str:
    text = _clean_text(value)
    if not text:
        return ""
    return text.split("#", 1)[0]


def _outline_level(style: Dict[str, Any]) -> int | None:
    paragraph_props = style.get("resolved_paragraph_format") or style.get("xml_paragraph_format") or {}
    if not isinstance(paragraph_props, dict):
        return None
    return _parse_int(paragraph_props.get("outline_level"))


def _list_format(style: Dict[str, Any]) -> str:
    list_info = style.get("list_info") or {}
    if not isinstance(list_info, dict):
        return ""
    return _clean_text(list_info.get("list_format")).lower()


def _style_status(style: Dict[str, Any]) -> str:
    if not isinstance(style, dict):
        return "missing"
    if style.get("type") == "table":
        return "defined"

    explicit_font = style.get("xml_font") or {}
    explicit_paragraph = style.get("xml_paragraph_format") or {}
    explicit_table = style.get("xml_table_format") or {}
    explicit_cell = style.get("xml_cell_format") or {}
    explicit_variants = style.get("xml_table_variants") or {}
    has_explicit = any(
        isinstance(block, dict) and any(value not in (None, "", [], {}) for value in block.values())
        for block in (explicit_font, explicit_paragraph, explicit_table, explicit_cell, explicit_variants)
    )
    return "defined" if has_explicit else "inherited"


def _is_monospace_style(style: Dict[str, Any]) -> bool:
    font_sources = (
        style.get("resolved_font") or {},
        style.get("xml_font") or {},
        style.get("font") or {},
    )
    font_names = []
    for font in font_sources:
        if not isinstance(font, dict):
            continue
        for key in ("font_name", "name"):
            text = _clean_text(font.get(key))
            if text:
                font_names.append(text.lower())
    return any(any(hint in font_name for hint in _MONOSPACE_HINTS) for font_name in font_names)


def _caption_style_refs(extracted: Dict[str, Any]) -> Tuple[set[str], set[str]]:
    ids: set[str] = set()
    names: set[str] = set()
    for caption in extracted.get("document_captions", []) or []:
        if not isinstance(caption, dict):
            continue
        style_id = _clean_text(caption.get("style_id"))
        style_name = _clean_text(caption.get("style_name"))
        if style_id:
            ids.add(style_id.lower())
        if style_name:
            names.add(style_name.lower())
    return ids, names


def _classify_style(style: Dict[str, Any], caption_style_ids: set[str], caption_style_names: set[str]) -> str:
    style_type = _clean_text(style.get("type")).lower()
    tokens = _style_name_tokens(style)
    joined = " ".join(tokens)
    outline = _outline_level(style)
    list_info = style.get("list_info")
    style_id = _clean_text(style.get("style_id")).lower()
    display_name = _style_display_name(style).lower()

    if style_type == "table":
        return "tables"
    if style_id in caption_style_ids or display_name in caption_style_names or "caption" in joined:
        return "captions"
    if style_id in {"title", "subtitle"} or display_name in {"title", "subtitle"}:
        return "titles"
    if style_id.startswith("heading") or display_name.startswith("heading ") or outline is not None:
        return "headings"
    if isinstance(list_info, dict) and list_info:
        return "lists"
    if "list " in joined:
        return "lists"
    if "code" in joined or "source" in joined or "preformatted" in joined or _is_monospace_style(style):
        return "code"
    if style_type == "paragraph":
        return "body"
    return "other"


def _score_browser_style(category: str, style: Dict[str, Any]) -> int:
    style_id = _clean_text(style.get("style_id")).lower()
    display_name = _style_display_name(style).lower()
    outline = _outline_level(style)
    list_info = style.get("list_info") or {}
    score = 0

    if style.get("priority"):
        score += 20

    if category == "titles":
        if style_id == "title" or display_name == "title":
            score += 120
        elif style_id == "subtitle" or display_name == "subtitle":
            score += 110
    elif category == "headings":
        if style_id.startswith("heading"):
            numeric = _parse_int(style_id.replace("heading", "")) or 9
            score += 120 - numeric
        elif display_name.startswith("heading "):
            numeric = _parse_int(display_name.replace("heading ", "")) or 9
            score += 110 - numeric
        elif outline is not None:
            score += 90 - min(outline, 9)
    elif category == "body":
        if style_id == "normal" or display_name == "normal":
            score += 120
        elif style_id == "quote" or display_name == "quote":
            score += 100
        elif style.get("type") == "paragraph":
            score += 80
    elif category == "lists":
        list_format = _clean_text(list_info.get("list_format")).lower()
        if "bullet" in style_id or "bullet" in display_name or list_format == "bullet":
            score += 120
        elif "number" in style_id or "number" in display_name or list_format in {
            "decimal",
            "lowerletter",
            "upperletter",
            "lowerroman",
            "upperroman",
        }:
            score += 110
        else:
            score += 90
    elif category == "tables":
        if style_id == "tablegrid" or display_name == "table grid":
            score += 120
        else:
            score += 90
    elif category == "code":
        if style_id == "code" or display_name == "code":
            score += 120
        elif _is_monospace_style(style):
            score += 100
        else:
            score += 80
    elif category == "captions":
        if style_id == "caption" or display_name == "caption":
            score += 120
        else:
            score += 90
    else:
        score += 50

    if _style_status(style) == "defined":
        score += 5
    return score


def _make_selection_key(
    *,
    category: str,
    style: Dict[str, Any],
    collisions: Dict[str, int],
) -> str:
    base_key = f"{category}|{_clean_text(style.get('style_id'))}|{_style_display_name(style)}"
    collisions[base_key] = collisions.get(base_key, 0) + 1
    occurrence = collisions[base_key]
    return base_key if occurrence == 1 else f"{base_key}#{occurrence}"


def _option_style(option: Dict[str, Any]) -> Dict[str, Any]:
    style = option.get("style")
    return style if isinstance(style, dict) else {}


def _option_style_id(option: Dict[str, Any]) -> str:
    style = _option_style(option)
    return _clean_text(style.get("style_id") or option.get("style_id"))


def _option_style_name(option: Dict[str, Any]) -> str:
    style = _option_style(option)
    return (
        _clean_text(style.get("name"))
        or _clean_text(option.get("name"))
        or _clean_text(style.get("display_name"))
        or _clean_text(option.get("display_name"))
    )


def _option_display_name(option: Dict[str, Any]) -> str:
    style = _option_style(option)
    return (
        _clean_text(option.get("display_name"))
        or _clean_text(style.get("display_name"))
        or _option_style_name(option)
    )


def _option_base_key(category: str, option: Dict[str, Any]) -> str:
    return f"{category}|{_option_style_id(option)}|{_option_display_name(option)}"


def _entry_to_semantic_slot(slot_name: str, option: Dict[str, Any] | None) -> Dict[str, Any]:
    spec = _SEMANTIC_STYLE_SLOT_SPECS[slot_name]
    if not isinstance(option, dict):
        return {
            "slot_name": slot_name,
            "category": spec["category"],
            "selection_key": None,
            "style_id": None,
            "style_name": None,
            "display_name": None,
            "style_type": spec["style_type"],
        }

    style = _option_style(option)
    return {
        "slot_name": slot_name,
        "category": spec["category"],
        "selection_key": _clean_text(option.get("selection_key")) or _option_base_key(spec["category"], option),
        "style_id": _option_style_id(option) or None,
        "style_name": _option_style_name(option) or None,
        "display_name": _option_display_name(option) or None,
        "style_type": _clean_text(style.get("type") or option.get("style_type")) or spec["style_type"],
    }


def _match_previous_slot_option(
    slot_name: str,
    options: List[Dict[str, Any]],
    previous_slot: Dict[str, Any] | None,
) -> Dict[str, Any] | None:
    if not isinstance(previous_slot, dict):
        return None

    spec = _SEMANTIC_STYLE_SLOT_SPECS[slot_name]
    requested_selection_key = _clean_text(previous_slot.get("selection_key"))
    if requested_selection_key:
        for option in options:
            if _clean_text(option.get("selection_key")) == requested_selection_key:
                return option
        requested_base = _selection_key_base(requested_selection_key)
        if requested_base:
            for option in options:
                if _option_base_key(spec["category"], option) == requested_base:
                    return option

    requested_style_id = _clean_text(previous_slot.get("style_id")).lower()
    if requested_style_id:
        for option in options:
            if _option_style_id(option).lower() == requested_style_id:
                return option

    requested_style_name = _clean_text(previous_slot.get("style_name")).lower()
    if requested_style_name:
        for option in options:
            if _option_style_name(option).lower() == requested_style_name:
                return option
        for option in options:
            if _option_display_name(option).lower() == requested_style_name:
                return option

    return None


def _pick_best_option(options: List[Dict[str, Any]], scorer) -> Dict[str, Any] | None:
    if not options:
        return None
    best_option = None
    best_score = None
    for option in options:
        score = scorer(option)
        if best_score is None or score > best_score:
            best_option = option
            best_score = score
    return best_option


def _default_slot_option(slot_name: str, options: List[Dict[str, Any]]) -> Dict[str, Any] | None:
    if not options:
        return None

    def _body_score(option: Dict[str, Any]) -> int:
        style = _option_style(option)
        style_id = _option_style_id(option).lower()
        display_name = _option_display_name(option).lower()
        score = int(option.get("score") or 0)
        if style_id == "bodytext" or display_name == "body text":
            return 500 + score
        if style_id == "normal" or display_name == "normal":
            return 400 + score
        if _outline_level(style) is not None or _list_format(style):
            return 100 + score
        return 300 + score

    def _heading_score(option: Dict[str, Any], level: int) -> int:
        style = _option_style(option)
        style_id = _option_style_id(option).lower()
        display_name = _option_display_name(option).lower()
        score = int(option.get("score") or 0)
        if style_id == f"heading{level}" or display_name == f"heading {level}":
            return 500 + score
        outline_level = _outline_level(style)
        if outline_level is not None:
            return 400 - (abs((outline_level + 1) - level) * 25) + score
        parsed_level = _parse_int(style_id.replace("heading", "")) if style_id.startswith("heading") else None
        if parsed_level is not None:
            return 300 - (abs(parsed_level - level) * 25) + score
        return 200 + score

    def _list_score(option: Dict[str, Any], ordered: bool) -> int:
        style = _option_style(option)
        style_id = _option_style_id(option).lower()
        display_name = _option_display_name(option).lower()
        list_format = _list_format(style)
        score = int(option.get("score") or 0)
        if ordered:
            if "number" in style_id or "number" in display_name:
                return 500 + score
            if list_format in {"decimal", "lowerletter", "upperletter", "lowerroman", "upperroman"}:
                return 450 + score
        else:
            if "bullet" in style_id or "bullet" in display_name:
                return 500 + score
            if list_format == "bullet":
                return 450 + score
        return 200 + score

    def _exact_name_score(option: Dict[str, Any], *, preferred_style_id: str, preferred_name: str) -> int:
        style_id = _option_style_id(option).lower()
        display_name = _option_display_name(option).lower()
        score = int(option.get("score") or 0)
        if style_id == preferred_style_id or display_name == preferred_name:
            return 500 + score
        return 300 + score

    if slot_name == "body":
        return _pick_best_option(options, _body_score)
    if slot_name.startswith("heading_"):
        level = _parse_int(slot_name.split("_", 1)[1]) or 1
        return _pick_best_option(options, lambda option: _heading_score(option, level))
    if slot_name == "list_bullet":
        return _pick_best_option(options, lambda option: _list_score(option, ordered=False))
    if slot_name == "list_number":
        return _pick_best_option(options, lambda option: _list_score(option, ordered=True))
    if slot_name == "caption":
        return _pick_best_option(
            options,
            lambda option: _exact_name_score(option, preferred_style_id="caption", preferred_name="caption"),
        )
    if slot_name == "code":
        return _pick_best_option(
            options,
            lambda option: _exact_name_score(option, preferred_style_id="code", preferred_name="code"),
        )
    if slot_name == "table_default":
        return _pick_best_option(
            options,
            lambda option: _exact_name_score(option, preferred_style_id="tablegrid", preferred_name="table grid"),
        )
    return options[0]


def build_semantic_style_slots(
    extracted: Dict[str, Any],
    previous_slots: Dict[str, Any] | None = None,
) -> Dict[str, Dict[str, Any]]:
    browser = extracted.get("style_browser")
    if not isinstance(browser, dict):
        browser = build_style_browser(extracted)
    categories = browser.get("categories") or {}
    previous = previous_slots if isinstance(previous_slots, dict) else {}

    slots: Dict[str, Dict[str, Any]] = {}
    for slot_name in SEMANTIC_STYLE_SLOT_ORDER:
        spec = _SEMANTIC_STYLE_SLOT_SPECS[slot_name]
        options = list(categories.get(spec["category"]) or [])
        resolved = _match_previous_slot_option(slot_name, options, previous.get(slot_name))
        if resolved is None:
            resolved = _default_slot_option(slot_name, options)
        slots[slot_name] = _entry_to_semantic_slot(slot_name, resolved)
    return slots


def build_style_browser(extracted: Dict[str, Any]) -> Dict[str, Any]:
    categories: Dict[str, List[Dict[str, Any]]] = {
        category: [] for category in STYLE_BROWSER_CATEGORY_ORDER
    }
    collisions: Dict[str, int] = {}
    caption_style_ids, caption_style_names = _caption_style_refs(extracted)

    for style in extracted.get("styles", []) or []:
        if not isinstance(style, dict):
            continue

        category = _classify_style(style, caption_style_ids, caption_style_names)
        entry = {
            "name": _clean_text(style.get("name")) or _style_display_name(style),
            "display_name": _style_display_name(style),
            "status": _style_status(style),
            "description": _CATEGORY_DESCRIPTIONS.get(category, _CATEGORY_DESCRIPTIONS["other"]),
            "category": category,
            "style_type": _clean_text(style.get("type")) or "paragraph",
            "selection_key": _make_selection_key(category=category, style=style, collisions=collisions),
            "score": _score_browser_style(category, style),
            "style": style,
        }
        categories.setdefault(category, []).append(entry)

    for category, items in categories.items():
        items.sort(
            key=lambda item: (
                -int(item.get("score") or 0),
                _clean_text(item.get("display_name")).lower(),
                _clean_text(item.get("selection_key")).lower(),
            )
        )

    auto_selected = {
        category: items[0]["selection_key"]
        for category, items in categories.items()
        if items
    }
    counts = {
        category: len(categories.get(category, []))
        for category in STYLE_BROWSER_CATEGORY_ORDER
    }

    return {
        "categories": categories,
        "category_order": list(STYLE_BROWSER_CATEGORY_ORDER),
        "auto_selected": auto_selected,
        "counts": counts,
    }


def get_style_coverage(extracted: Dict[str, Any]) -> Dict[str, Any]:
    """Analyze style coverage for required DOCX styles."""
    style_map = {s["name"]: s for s in extracted.get("styles", []) if isinstance(s, dict) and s.get("name")}
    style_id_map = {
        s.get("style_id"): s
        for s in extracted.get("styles", [])
        if isinstance(s, dict) and s.get("style_id")
    }

    coverage: Dict[str, Dict[str, Any]] = {}
    categories: Dict[str, List[Dict[str, Any]]] = {}

    for category, styles in _legacy.REQUIRED_STYLES.items():
        categories[category] = []

        for style_name, meta in styles.items():
            matched_style = None
            if style_name in style_map:
                matched_style = style_map[style_name]
            else:
                style_id = _legacy.REQUIRED_STYLE_IDS.get(style_name)
                if style_id and style_id in style_id_map:
                    matched_style = style_id_map[style_id]

            if matched_style:
                style = matched_style
                status = _style_status(style)
                style_info = {
                    "name": style_name,
                    "display_name": style.get("display_name") or style.get("name"),
                    "status": status,
                    "description": meta["description"],
                    "category": category,
                    "style_type": style.get("type"),
                    "style": style,
                }
            else:
                status = "missing"
                fallback_type = "table" if category == "tables" else "paragraph"
                style_info = {
                    "name": style_name,
                    "display_name": None,
                    "status": status,
                    "description": meta["description"],
                    "category": category,
                    "style_type": fallback_type,
                    "style": None,
                }

            coverage[style_name] = style_info
            categories[category].append(style_info)

    summary = {
        "defined": sum(1 for style_info in coverage.values() if style_info["status"] == "defined"),
        "inherited": sum(1 for style_info in coverage.values() if style_info["status"] == "inherited"),
        "missing": sum(1 for style_info in coverage.values() if style_info["status"] == "missing"),
        "total": len(coverage),
    }

    return {
        "coverage": coverage,
        "categories": categories,
        "summary": summary,
    }


def enrich_template_metadata(
    extracted: Dict[str, Any],
    previous_slots: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    if not isinstance(extracted, dict):
        return extracted
    extracted["style_coverage"] = get_style_coverage(extracted)
    extracted["style_browser"] = build_style_browser(extracted)
    resolved_previous_slots = previous_slots
    if resolved_previous_slots is None:
        existing_slots = extracted.get(_legacy.SEMANTIC_STYLE_SLOTS_KEY)
        resolved_previous_slots = existing_slots if isinstance(existing_slots, dict) else None
    extracted[_legacy.SEMANTIC_STYLE_SLOTS_KEY] = build_semantic_style_slots(
        extracted,
        previous_slots=resolved_previous_slots,
    )
    return extracted
