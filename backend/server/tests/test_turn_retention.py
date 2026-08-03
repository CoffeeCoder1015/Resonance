import threading
import unittest

from fastapi import HTTPException

from resonance_backend import app as app_module


class MutableClock:
    def __init__(self) -> None:
        self.value = 0.0

    def __call__(self) -> float:
        return self.value

    def advance(self, seconds: float) -> None:
        self.value += seconds


def turn(turn_id: str, status: str = "responding") -> dict[str, str]:
    return {"id": turn_id, "status": status, "transcript": "text"}


class TurnRetentionTests(unittest.TestCase):
    def test_completed_and_failed_turns_expire_but_responding_turns_do_not(self) -> None:
        clock = MutableClock()
        store = app_module.TurnStore(max_turns=4, completed_ttl_seconds=10, clock=clock)
        store.create(turn("active"))
        store.create(turn("completed"))
        store.create(turn("failed"))
        store.set_terminal("completed", status="completed", response="done")
        store.set_terminal("failed", status="failed", error="nope")

        clock.advance(11)

        self.assertEqual(store["active"]["status"], "responding")
        self.assertIsNone(store.get("completed"))
        self.assertIsNone(store.get("failed"))

    def test_capacity_evicts_oldest_terminal_but_never_an_active_turn(self) -> None:
        clock = MutableClock()
        store = app_module.TurnStore(max_turns=2, completed_ttl_seconds=100, clock=clock)
        store.create(turn("active"))
        store.create(turn("old"))
        store.set_terminal("old", status="completed", response="done")
        clock.advance(1)

        store.create(turn("new"))

        self.assertEqual(set(store), {"active", "new"})

    def test_capacity_rejects_a_new_turn_when_all_retained_turns_are_active(self) -> None:
        store = app_module.TurnStore(max_turns=2, completed_ttl_seconds=100)
        store.create(turn("first"))
        store.create(turn("second"))

        with self.assertRaises(app_module.TurnCapacityError):
            store.create(turn("third"))

        self.assertEqual(set(store), {"first", "second"})

    def test_get_turn_returns_404_after_terminal_turn_expiry(self) -> None:
        clock = MutableClock()
        store = app_module.TurnStore(max_turns=2, completed_ttl_seconds=10, clock=clock)
        store.create(turn("expired"))
        store.set_terminal("expired", status="completed", response="done")
        previous_store = app_module.turns
        app_module.turns = store
        try:
            clock.advance(10)
            with self.assertRaises(HTTPException) as context:
                app_module.get_turn("expired")
        finally:
            app_module.turns = previous_store

        self.assertEqual(context.exception.status_code, 404)

    def test_simultaneous_terminal_updates_and_reads_are_safe(self) -> None:
        store = app_module.TurnStore(max_turns=32, completed_ttl_seconds=100)
        for index in range(16):
            store.create(turn(f"turn-{index}"))

        failures: list[Exception] = []
        start = threading.Barrier(3)

        def complete_turns() -> None:
            try:
                start.wait()
                for index in range(16):
                    store.set_terminal(
                        f"turn-{index}", status="completed", response="done"
                    )
            except Exception as error:  # pragma: no cover - asserted below
                failures.append(error)

        def read_turns() -> None:
            try:
                start.wait()
                for _ in range(16):
                    for index in range(16):
                        store.get(f"turn-{index}")
            except Exception as error:  # pragma: no cover - asserted below
                failures.append(error)

        completer = threading.Thread(target=complete_turns)
        reader = threading.Thread(target=read_turns)
        completer.start()
        reader.start()
        start.wait()
        completer.join()
        reader.join()

        self.assertEqual(failures, [])
        self.assertTrue(all(store[f"turn-{index}"]["status"] == "completed" for index in range(16)))


if __name__ == "__main__":
    unittest.main()
