import os
import sys
import unittest
from concurrent.futures import ThreadPoolExecutor


sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services.template import preview as template_preview


class TestTemplatePreviewCacheThreadsafe(unittest.TestCase):
    def setUp(self):
        template_preview.clear_preview_cache()

    def tearDown(self):
        template_preview.clear_preview_cache()

    def test_concurrent_set_get_clear_is_safe_and_bounded(self):
        errors = []
        worker_count = 6
        iterations = 300
        kernel_ids = [f"kernel-{idx}" for idx in range(4)]

        def writer(worker_idx: int) -> None:
            try:
                for i in range(iterations):
                    kernel_id = kernel_ids[(worker_idx + i) % len(kernel_ids)]
                    preview_key = f"preview-{worker_idx}-{i}"
                    payload = f"b64-{worker_idx}-{i}"
                    template_preview.set_preview_cache(preview_key, payload, kernel_id)
                    _ = template_preview.get_preview_cache(preview_key, kernel_id)
            except Exception as exc:  # pragma: no cover - defensive capture
                errors.append(exc)

        def clearer() -> None:
            try:
                for i in range(iterations):
                    if i % 5 == 0:
                        template_preview.clear_preview_cache()
                    else:
                        kernel_id = kernel_ids[i % len(kernel_ids)]
                        template_preview.clear_preview_cache(kernel_id)
            except Exception as exc:  # pragma: no cover - defensive capture
                errors.append(exc)

        with ThreadPoolExecutor(max_workers=worker_count + 2) as pool:
            futures = [pool.submit(writer, idx) for idx in range(worker_count)]
            futures.extend([pool.submit(clearer), pool.submit(clearer)])
            for future in futures:
                future.result(timeout=10)

        self.assertFalse(errors, f"Unexpected concurrent cache errors: {errors}")
        self.assertLessEqual(len(template_preview._preview_cache), template_preview.PREVIEW_CACHE_MAX)


if __name__ == "__main__":
    unittest.main()
