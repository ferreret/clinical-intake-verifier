"""OCR engines with positions, for the text pipeline of clinical-intake-verifier.

Each engine reads the pages of a PDF and returns its lines of text with their boxes; the
package writes them as ``<id>.ocr.json`` (``schema/ocr.schema.json``), which the extractor's
text pipeline reads with ``npm run extract -- --provider local-text --ocr-dir``. The engines
run outside the demo's container, on the development machine, as the local model does.
"""

__version__ = "0.1.0"
