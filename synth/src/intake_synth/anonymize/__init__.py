"""Anonymization of real request scans: replace patient and physician data with fictitious data.

The real documents never enter the repository (CLAUDE.md, rule 1); this package only holds the
tools. A plan per document lists the regions to cover and what to write in each (``plan``); the
extractor's boxes propose a first plan (``propose``); a person reviews it in a local page
(``review``); the plan is painted onto the page images and an image-only PDF is rebuilt, so that
nothing of the original is left underneath (``paint``). The fictitious values are drawn per
document and keep the original's format (``identity``).
"""
