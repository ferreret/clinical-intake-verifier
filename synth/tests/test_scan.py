"""The box transform must follow the pixels through the scanner simulation."""

from __future__ import annotations

import numpy as np
import pytest
from PIL import Image, ImageDraw

from intake_synth.generate.scan import (
    PageGeometry,
    ScanParams,
    map_point,
    scan_image,
    transform_box,
)


def _params(rotation: float, offset: tuple[int, int]) -> tuple[ScanParams, PageGeometry]:
    g = PageGeometry(rotation_deg=rotation, offset_px=offset)
    p = ScanParams(
        dpi=72,
        blur=0.0,
        noise=0.0,
        jpeg_quality=95,
        grayscale=True,
        brightness=1.0,
        contrast=1.0,
        lamp=0.0,
        pages=(g,),
    )
    return p, g


@pytest.mark.parametrize(
    "rotation,offset",
    [
        (0.0, (0, 0)),
        (2.0, (0, 0)),
        (-1.5, (0, 0)),
        (0.0, (9, -6)),
        (1.2, (-7, 5)),
        (-2.5, (10, 10)),
    ],
)
def test_transformed_box_tracks_the_ink(rotation, offset):
    w, h = 600, 800
    img = Image.new("RGB", (w, h), (255, 255, 255))
    box = (120.0, 200.0, 330.0, 240.0)
    # ImageDraw.rectangle fills both end pixels; subtract one so the ink is exactly `box`.
    ImageDraw.Draw(img).rectangle((box[0], box[1], box[2] - 1, box[3] - 1), fill=(0, 0, 0))

    p, g = _params(rotation, offset)
    out = np.asarray(scan_image(img, p, g, np.random.default_rng(0)))
    dark = out < 128
    ys, xs = np.nonzero(dark)
    ink = (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)

    nb = transform_box(box, w, h, g, px_per_unit=1.0)
    # The mapped box must contain all the ink ...
    assert nb[0] <= ink[0] + 1 and nb[1] <= ink[1] + 1
    assert nb[2] >= ink[2] - 1 and nb[3] >= ink[3] - 1
    # ... and be tight: envelope of a rotated rectangle grows a little, never a lot.
    assert nb[2] - nb[0] <= (ink[2] - ink[0]) + 4
    assert nb[3] - nb[1] <= (ink[3] - ink[1]) + 4


def test_map_point_identity_without_transform():
    _, g = _params(0.0, (0, 0))
    assert map_point(10.0, 20.0, 600, 800, g, 1.0) == (10.0, 20.0)


def test_offset_is_converted_to_target_units():
    _, g = _params(0.0, (10, -20))
    # 200 dpi: 10 px == 3.6 pt
    x, y = map_point(0.0, 0.0, 595.0, 842.0, g, px_per_unit=200 / 72)
    assert x == pytest.approx(3.6) and y == pytest.approx(-7.2)


def test_public_params_list_one_entry_per_page():
    p = ScanParams(
        dpi=200,
        blur=0.5,
        noise=0.01,
        jpeg_quality=60,
        grayscale=False,
        brightness=1.0,
        contrast=1.0,
        lamp=0.0,
        pages=(PageGeometry(0.5, (1, 2)), PageGeometry(-0.7, (-3, 4))),
    )
    pub = p.public()
    assert [pg["number"] for pg in pub["pages"]] == [1, 2]
    assert pub["pages"][1]["offset_px"] == [-3, 4]
