"""Regression checks for art preservation and repeat boundaries (requirements-tile-atlas.txt)."""
import unittest
from pathlib import Path
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1] / 'src/assets/backgrounds/island'


class OceanAssetsTest(unittest.TestCase):
    def test_original_rgb_and_land_survive_in_both_times(self):
        for time in ('day', 'night'):
            with self.subTest(time=time):
                old = np.asarray(Image.open(ROOT / f'base/{time}.png').convert('RGB'))
                new = np.asarray(Image.open(ROOT / f'ocean/home-{time}.png'))
                self.assertEqual(new.shape, (1024, 1536, 4))
                self.assertTrue(np.array_equal(old, new[:, :, :3]))
                self.assertEqual(int(new[400, 700, 3]), 255)
                self.assertEqual(int(new[0, 0, 3]), 0)
                self.assertEqual(int(new[1000, 800, 3]), 0)

    def test_repeat_edges_have_no_color_jump(self):
        for time in ('day', 'night'):
            with self.subTest(time=time):
                im = np.asarray(Image.open(ROOT / f'ocean/{time}.png'), dtype=float)
                self.assertLess(np.abs(im[:, 0] - im[:, -1]).mean(), 3)
                self.assertLess(np.abs(im[0] - im[-1]).mean(), 3)


if __name__ == '__main__':
    unittest.main()
