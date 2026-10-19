from __future__ import annotations

import base64
import unittest
from pathlib import Path

from app import adb_qr_generate


class AdbQrGenerationTests(unittest.IsolatedAsyncioTestCase):
    async def test_generates_embeddable_qr_image_without_native_pillow(self) -> None:
        # Given: the Python 3.10 runtime used by the desktop launcher.

        # When: a new ADB pairing QR session is generated.
        result = await adb_qr_generate()

        # Then: the response contains a self-contained, browser-renderable QR image.
        image_data_url = result["qr_image"]
        self.assertTrue(image_data_url.startswith("data:image/svg+xml;base64,"))
        encoded_image = image_data_url.split(",", maxsplit=1)[1]
        decoded_image = base64.b64decode(encoded_image)
        self.assertIn(b"<svg", decoded_image)
        self.assertIn(b'id="qr-path"', decoded_image)


class AdbQrMarkupTests(unittest.TestCase):
    def test_modal_is_hidden_until_user_starts_qr_pairing(self) -> None:
        # Given: the desktop page before the user opens ADB pairing.
        html = (Path(__file__).resolve().parents[1] / "static" / "index.html").read_text(
            encoding="utf-8"
        )

        # When: the initial ADB QR modal markup is inspected.
        modal_markup = html[html.index('<div id="adb-qr-modal"') :][:300]

        # Then: the overlay cannot intercept clicks while it is closed.
        self.assertIn("display:none", modal_markup)


if __name__ == "__main__":
    unittest.main()
