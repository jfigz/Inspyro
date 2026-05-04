import os
import sys
import unittest


sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core import state


class TestTemplatePreviewState(unittest.IsolatedAsyncioTestCase):
    async def asyncTearDown(self):
        await state.clear_preview_state_for_kernel("kernel-preview-state")
        await state.clear_preview_state_for_kernel("kernel-preview-prune")

    async def test_complete_preview_request_removes_completed_entry(self):
        key = await state.register_preview_request(
            "kernel-preview-state",
            "preview-key",
            "req-1",
            fallback="style:Normal",
        )

        self.assertTrue(await state.is_preview_request_current(key, "req-1"))
        self.assertTrue(await state.complete_preview_request(key, "req-1"))
        self.assertFalse(await state.is_preview_request_current(key, "req-1"))

    async def test_cancel_preview_by_request_id_removes_matching_entries(self):
        await state.register_preview_request(
            "kernel-preview-state",
            "preview-a",
            "req-cancel",
            fallback="style:A",
        )
        await state.register_preview_request(
            "kernel-preview-state",
            "preview-b",
            "req-cancel",
            fallback="style:B",
        )

        cancelled = await state.cancel_preview_by_request_id("kernel-preview-state", "req-cancel")

        self.assertEqual(cancelled, 2)
        remaining = [key for key in state._preview_latest_request if key[0] == "kernel-preview-state"]
        self.assertEqual(remaining, [])

    async def test_register_preview_request_prunes_per_kernel(self):
        max_entries = state._PREVIEW_TRACK_MAX_PER_KERNEL
        total_requests = max_entries + 24

        for index in range(total_requests):
            await state.register_preview_request(
                "kernel-preview-prune",
                f"preview-{index}",
                f"req-{index}",
                fallback=f"style:{index}",
            )

        kernel_entries = [key for key in state._preview_latest_request if key[0] == "kernel-preview-prune"]

        self.assertLessEqual(len(kernel_entries), max_entries)
        self.assertIn(("kernel-preview-prune", f"preview-{total_requests - 1}"), kernel_entries)


if __name__ == "__main__":
    unittest.main()
