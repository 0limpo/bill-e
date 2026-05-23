"""
test_free_tier.py

Standalone tests for the unified free-tier counter. No real Redis or
Postgres — uses an in-memory fake. Run with:

    python backend/test_free_tier.py
"""

import json
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))

import free_tier  # noqa: E402


# ---------------------------------------------------------------------------
# Fake Redis (just enough for free_tier.py)
# ---------------------------------------------------------------------------

class FakeRedis:
    def __init__(self):
        self.store = {}

    def get(self, key):
        return self.store.get(key)

    def set(self, key, value):
        self.store[key] = value


# ---------------------------------------------------------------------------
# Test harness
# ---------------------------------------------------------------------------

passes = 0
failures = 0
failed_names = []


def scenario(name):
    def decorator(fn):
        global passes, failures
        try:
            fn()
            passes += 1
            print(f"  PASS  {name}")
        except Exception as e:
            failures += 1
            failed_names.append(name)
            print(f"  FAIL  {name}")
            print(f"        {e}")
        return fn
    return decorator


def assert_eq(actual, expected, label):
    if actual != expected:
        raise AssertionError(f"{label}: expected {expected!r}, got {actual!r}")


# Force the premium check to always return False so tests don't need
# Postgres. Individual tests that want premium-true patch this in.
free_tier._is_premium_user = lambda redis_client, user_id: False  # type: ignore


print("\n=== Free tier counter tests ===\n")


# --- S1 ---
@scenario("S1 · empty state: 0 used, limit remaining")
def s1():
    r = FakeRedis()
    s = free_tier.get_status(r, user_id="u1")
    assert_eq(s["sessions_used"], 0, "used")
    assert_eq(s["free_remaining"], free_tier.FREE_SESSIONS_LIMIT, "remaining")
    assert_eq(s["sessions_limit"], free_tier.FREE_SESSIONS_LIMIT, "limit")
    assert_eq(s["is_premium"], False, "premium")
    assert_eq(s["identity"], "user", "identity")


# --- S2 ---
@scenario("S2 · record once: 1 used, limit-1 remaining")
def s2():
    r = FakeRedis()
    out = free_tier.record_session_use(r, "sess-a", user_id="u1")
    assert_eq(out["allowed"], True, "allowed")
    assert_eq(out["sessions_used"], 1, "used")
    assert_eq(out["free_remaining"], free_tier.FREE_SESSIONS_LIMIT - 1, "remaining")
    assert_eq(out.get("recorded"), True, "recorded flag")


# --- S3 ---
@scenario("S3 · idempotent: same session twice = 1 used")
def s3():
    r = FakeRedis()
    free_tier.record_session_use(r, "sess-a", user_id="u1")
    out = free_tier.record_session_use(r, "sess-a", user_id="u1")
    assert_eq(out["allowed"], True, "allowed")
    assert_eq(out["sessions_used"], 1, "used after 2nd call")
    assert_eq(out.get("already_counted"), True, "already_counted flag")


# --- S4 ---
@scenario("S4 · hit limit: session beyond cap blocked (monkeypatched limit=3)")
def s4():
    original_limit = free_tier.FREE_SESSIONS_LIMIT
    free_tier.FREE_SESSIONS_LIMIT = 3
    try:
        r = FakeRedis()
        for i in range(3):
            out = free_tier.record_session_use(r, f"s{i}", user_id="u1")
            assert_eq(out["allowed"], True, f"session {i} allowed")
        out_extra = free_tier.record_session_use(r, "s3", user_id="u1")
        assert_eq(out_extra["allowed"], False, "4th blocked")
        assert_eq(out_extra["free_remaining"], 0, "remaining = 0")
        assert_eq(out_extra.get("reason"), "limit_reached", "reason")
        # The blocked session must NOT be in the list.
        final = free_tier.get_status(r, user_id="u1")
        assert_eq(final["sessions_used"], 3, "list size still 3")
    finally:
        free_tier.FREE_SESSIONS_LIMIT = original_limit


# --- S5 ---
@scenario("S5 · no identity: rejected")
def s5():
    r = FakeRedis()
    out = free_tier.record_session_use(r, "sess-a")
    assert_eq(out["allowed"], False, "rejected")
    assert_eq(out.get("reason"), "no_identity", "reason")


# --- S6 ---
@scenario("S6 · device identity: separate counter from user")
def s6():
    r = FakeRedis()
    free_tier.record_session_use(r, "sess-a", device_id="dev1")
    free_tier.record_session_use(r, "sess-b", device_id="dev1")
    su = free_tier.get_status(r, user_id="u1")
    sd = free_tier.get_status(r, device_id="dev1")
    assert_eq(su["sessions_used"], 0, "user counter untouched")
    assert_eq(sd["sessions_used"], 2, "device counter has 2")


# --- S7 ---
@scenario("S7 · merge device into user (no overlap)")
def s7():
    r = FakeRedis()
    free_tier.record_session_use(r, "d1", device_id="dev1")
    free_tier.record_session_use(r, "d2", device_id="dev1")
    free_tier.record_session_use(r, "u1", user_id="u1")
    out = free_tier.merge_device_into_user(r, user_id="u1", device_id="dev1")
    assert_eq(out["sessions_used"], 3, "merged count")
    assert_eq(out.get("merged_from_device"), 2, "added from device")


# --- S8 ---
@scenario("S8 · merge with overlap: no double count")
def s8():
    r = FakeRedis()
    free_tier.record_session_use(r, "shared", device_id="dev1")
    free_tier.record_session_use(r, "shared", user_id="u1")
    free_tier.record_session_use(r, "device-only", device_id="dev1")
    out = free_tier.merge_device_into_user(r, user_id="u1", device_id="dev1")
    # Union: {shared, device-only} = 2
    assert_eq(out["sessions_used"], 2, "deduped count")
    assert_eq(out.get("merged_from_device"), 1, "only device-only added")


# --- S9 ---
@scenario("S9 · merge preserves device list (re-login loophole)")
def s9():
    r = FakeRedis()
    free_tier.record_session_use(r, "d1", device_id="dev1")
    free_tier.record_session_use(r, "d2", device_id="dev1")
    free_tier.merge_device_into_user(r, user_id="u1", device_id="dev1")
    # After merge, the device list is intact — a new anonymous user on
    # the same device picks up from 2, not 0.
    sd = free_tier.get_status(r, device_id="dev1")
    assert_eq(sd["sessions_used"], 2, "device list preserved")


# --- S10 ---
@scenario("S10 · premium user: limit not enforced")
def s10():
    r = FakeRedis()
    free_tier._is_premium_user = lambda redis_client, user_id: True  # type: ignore
    try:
        for i in range(7):
            out = free_tier.record_session_use(r, f"p{i}", user_id="premium-u")
            assert_eq(out["allowed"], True, f"session {i} allowed")
            assert_eq(out["is_premium"], True, f"session {i} is_premium")
        # All 7 stored — list grows even for premium so analytics work.
        final = free_tier.get_status(r, user_id="premium-u")
        assert_eq(final["sessions_used"], 7, "7 recorded")
    finally:
        free_tier._is_premium_user = lambda redis_client, user_id: False  # type: ignore


# --- S11 ---
@scenario("S11 · user_id wins over device_id when both present")
def s11():
    r = FakeRedis()
    free_tier.record_session_use(r, "dev-only", device_id="dev1")
    out = free_tier.record_session_use(r, "u-only", user_id="u1", device_id="dev1")
    # The new session went into the user list, not the device list.
    assert_eq(out["sessions_used"], 1, "user list count")
    sd = free_tier.get_status(r, device_id="dev1")
    assert_eq(sd["sessions_used"], 1, "device list untouched (still just dev-only)")


# --- S12 ---
@scenario("S12 · session TTL constant and cap is anti-abuse (500)")
def s12():
    # Sanity: 24h in seconds.
    assert_eq(free_tier.SESSION_TTL_SECONDS, 86400, "24h TTL")
    assert_eq(free_tier.FREE_SESSIONS_LIMIT, 500, "anti-abuse cap 500")


# --- S13 check_can_join ---
@scenario("S13 · check_can_join: under cap allows new session")
def s13():
    r = FakeRedis()
    for i in range(3):
        free_tier.record_session_use(r, f"s{i}", user_id="u1")
    out = free_tier.check_can_join(r, "s-new", user_id="u1")
    assert_eq(out["allowed"], True, "allowed")
    assert_eq(out["sessions_used"], 3, "no increment (read-only)")


@scenario("S14 · check_can_join: at cap blocks new session (monkeypatched limit=3)")
def s14():
    original_limit = free_tier.FREE_SESSIONS_LIMIT
    free_tier.FREE_SESSIONS_LIMIT = 3
    try:
        r = FakeRedis()
        for i in range(3):
            free_tier.record_session_use(r, f"s{i}", user_id="u1")
        out = free_tier.check_can_join(r, "s-new", user_id="u1")
        assert_eq(out["allowed"], False, "blocked")
        assert_eq(out.get("reason"), "limit_reached", "reason")
    finally:
        free_tier.FREE_SESSIONS_LIMIT = original_limit


@scenario("S15 · check_can_join: at cap allows returning session (monkeypatched limit=3)")
def s15():
    original_limit = free_tier.FREE_SESSIONS_LIMIT
    free_tier.FREE_SESSIONS_LIMIT = 3
    try:
        r = FakeRedis()
        for i in range(3):
            free_tier.record_session_use(r, f"s{i}", user_id="u1")
        # Re-join one of those same sessions.
        out = free_tier.check_can_join(r, "s2", user_id="u1")
        assert_eq(out["allowed"], True, "returning session allowed")
        assert_eq(out.get("already_counted"), True, "already_counted flag")
    finally:
        free_tier.FREE_SESSIONS_LIMIT = original_limit


@scenario("S16 · check_can_join: premium bypasses cap")
def s16():
    r = FakeRedis()
    free_tier._is_premium_user = lambda redis_client, user_id: True  # type: ignore
    try:
        for i in range(5):
            free_tier.record_session_use(r, f"s{i}", user_id="premium")
        out = free_tier.check_can_join(r, "s-new", user_id="premium")
        assert_eq(out["allowed"], True, "premium allowed")
        assert_eq(out["is_premium"], True, "is_premium")
    finally:
        free_tier._is_premium_user = lambda redis_client, user_id: False  # type: ignore


@scenario("S17 · check_can_join does NOT increment counter")
def s17():
    r = FakeRedis()
    for i in range(3):
        free_tier.record_session_use(r, f"s{i}", user_id="u1")
    # Call check_can_join 5 times for a new session id — still 3 used.
    for _ in range(5):
        free_tier.check_can_join(r, "s-new", user_id="u1")
    final = free_tier.get_status(r, user_id="u1")
    assert_eq(final["sessions_used"], 3, "check is read-only")


# --- S18..S20: finalize_session charges every participant ---

# FakeRedis from free_tier needs setex/ttl for collaborative_session use.
class FakeRedisFull(FakeRedis):
    def setex(self, key, ttl, value):
        self.store[key] = value
    def ttl(self, key):
        return 3600 if key in self.store else -2


@scenario("S18 · finalize charges host via session-level identity")
def s18():
    import json as _json
    import collaborative_session as cs

    r = FakeRedisFull()
    session_data = {
        "session_id": "sess-A",
        "owner_token": "tok",
        "owner_phone": "",
        "owner_device_id": "host-device",
        "user_id": None,
        "status": cs.SessionStatus.ASSIGNING.value,
        "items": [{"id": "i1", "name": "x", "price": 100, "quantity": 1}],
        "charges": [],
        "participants": [
            {"id": "h1", "name": "Host", "phone": "", "role": "owner", "joined_at": "now"},
        ],
        "assignments": {"i1": [{"participant_id": "h1", "quantity": 1}]},
        "total": 100, "subtotal": 100, "tip": 0,
    }
    r.setex("session:sess-A", 3600, _json.dumps(session_data))
    res = cs.finalize_session(r, "sess-A", "tok")
    assert_eq(res.get("success"), True, "finalize succeeded")
    status = free_tier.get_status(r, device_id="host-device")
    assert_eq(status["sessions_used"], 1, "host charged at finalize")


@scenario("S19 · finalize charges editor via stored device_id (joined but no p3)")
def s19():
    import json as _json
    import collaborative_session as cs

    r = FakeRedisFull()
    session_data = {
        "session_id": "sess-B",
        "owner_token": "tok",
        "owner_phone": "",
        "owner_device_id": "host-device",
        "user_id": None,
        "status": cs.SessionStatus.ASSIGNING.value,
        "items": [{"id": "i1", "name": "x", "price": 100, "quantity": 1}],
        "charges": [],
        "participants": [
            {"id": "h1", "name": "Host", "phone": "", "role": "owner", "joined_at": "now"},
            # Editor joined, NEVER reached p3 (no enter-share call) — still
            # should be charged at finalize because they were a participant.
            {"id": "e1", "name": "Edi", "phone": "", "role": "editor",
             "joined_at": "now", "device_id": "editor-device"},
        ],
        "assignments": {"i1": [{"participant_id": "h1", "quantity": 1}]},
        "total": 100, "subtotal": 100, "tip": 0,
    }
    r.setex("session:sess-B", 3600, _json.dumps(session_data))
    cs.finalize_session(r, "sess-B", "tok")
    editor_status = free_tier.get_status(r, device_id="editor-device")
    assert_eq(editor_status["sessions_used"], 1, "editor charged even without p3 visit")


@scenario("S20 · finalize is idempotent with enter-share")
def s20():
    import json as _json
    import collaborative_session as cs

    r = FakeRedisFull()
    session_data = {
        "session_id": "sess-C",
        "owner_token": "tok",
        "owner_phone": "",
        "owner_device_id": "host-device",
        "user_id": None,
        "status": cs.SessionStatus.ASSIGNING.value,
        "items": [{"id": "i1", "name": "x", "price": 100, "quantity": 1}],
        "charges": [],
        "participants": [
            {"id": "h1", "name": "Host", "phone": "", "role": "owner", "joined_at": "now"},
            {"id": "e1", "name": "Edi", "phone": "", "role": "editor",
             "joined_at": "now", "device_id": "editor-device"},
        ],
        "assignments": {"i1": [{"participant_id": "h1", "quantity": 1}]},
        "total": 100, "subtotal": 100, "tip": 0,
    }
    r.setex("session:sess-C", 3600, _json.dumps(session_data))
    # Simulate the editor's enter-share BEFORE finalize.
    free_tier.record_session_use(r, "sess-C", device_id="editor-device")
    # Then host finalizes — should NOT double-count.
    cs.finalize_session(r, "sess-C", "tok")
    editor_status = free_tier.get_status(r, device_id="editor-device")
    assert_eq(editor_status["sessions_used"], 1, "single count despite two paths")


# ---------------------------------------------------------------------------

print(f"\n=== Result: {passes} passed, {failures} failed ===\n")
if failures > 0:
    print("Failed scenarios:")
    for n in failed_names:
        print(f"  - {n}")
    sys.exit(1)
