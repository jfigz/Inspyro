Source notes for vendored math resources.

- `backend/latex2mathml/` vendors the MIT-licensed `latex2mathml` package
  (version `3.79.0`) so the DOCX math pipeline is self-contained at runtime.
- `mml2omml.xsl` is vendored from the TEI Stylesheets project:
  `https://raw.githubusercontent.com/TEIC/Stylesheets/dev/docx/to/mml2omml.xsl`
- `mml2omml_wrapper.xsl` is a local wrapper that imports the TEI stylesheet and
  guarantees a single `<m:oMath>` root node for the DOCX builder pipeline.
- Retrieved for Inspyro on 2026-03-29 to remove any runtime dependency on
  a local Microsoft Office installation for MathML -> OMML conversion.
