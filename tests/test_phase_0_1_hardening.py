"""Phase 0.1 regression tests.

These tests use the pinned GenLayer standard library directly, with only the
external web/LLM/transfer boundaries supplied by the test VM. Contract storage,
decorators, nondeterministic entry points, and lifecycle methods are real.
"""

from __future__ import annotations

import hashlib
import importlib.util
import io
import json
import os
import sys
import tempfile
import types
import zipfile
from datetime import datetime, timezone
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
_SDK_TMP: tempfile.TemporaryDirectory[str] | None = None
_ACTIVE: "DirectRuntime | None" = None
_GL = None
_MESSAGE = None
_CONTRACT = None
_STORAGE_DESC = None


def _ensure_sdk() -> None:
    """Load the current SDK zip cached by GenVM tooling if needed."""
    global _SDK_TMP
    if importlib.util.find_spec("genlayer") is not None:
        return
    candidates = []
    env_path = os.environ.get("FAULTPACT_SDK_PATH")
    if env_path:
        candidates.append(Path(env_path))
    candidates.append(Path("/tmp/faultpact-sdk-v06"))
    candidates.extend(
        Path("/root/.cache/gltest-direct/trees-v2").glob(
            "*/runners/py-lib-genlayer-std/*/*.zip"
        )
    )
    for candidate in candidates:
        if candidate.is_dir() and (candidate / "genlayer").exists():
            sys.path.insert(0, str(candidate))
            return
        if candidate.is_file() and candidate.suffix == ".zip":
            _SDK_TMP = tempfile.TemporaryDirectory(prefix="faultpact-sdk-")
            with zipfile.ZipFile(candidate) as archive:
                archive.extractall(_SDK_TMP.name)
            sys.path.insert(0, _SDK_TMP.name)
            return
    raise RuntimeError(
        "Current GenLayer SDK not found; set FAULTPACT_SDK_PATH or run the "
        "GenVM SDK setup command before pytest."
    )


class DirectRuntime:
    """Small current-SDK VM boundary for contract-level regression tests."""

    def __init__(self) -> None:
        global _ACTIVE, _GL, _MESSAGE, _CONTRACT, _STORAGE_DESC
        _ensure_sdk()

        self.fds: dict[int, bytes] = {}
        self.next_fd = 100
        self.web: dict[str, tuple[int, bytes]] = {}
        self.prompt_response: dict | str | None = None
        self.prompts: list[str] = []
        self.transfers: list[tuple[object, int]] = []
        self.fail_transfer = False
        self.now = 1_700_000_000
        self.sender = self.address(1)
        self.origin = self.sender
        self.value = 0
        self.contract_address = self.address(9)
        self.balances: dict[bytes, int] = {}

        wasi = types.ModuleType("_genlayer_wasi")
        wasi.FAKE_VM = False
        wasi.storage_read = self._storage_read
        wasi.storage_write = self._storage_write
        wasi.get_balance = self._get_balance
        wasi.get_self_balance = self._get_self_balance
        wasi.gl_call = self._gl_call
        sys.modules["_genlayer_wasi"] = wasi
        _ACTIVE = self

        import genlayer as gl

        _GL = gl
        import genlayer._internal.on_chain.gl_call as gl_call

        gl_call._imp_raw = self._gl_call
        old_is_vm = gl.IS_IN_VM
        gl.IS_IN_VM = False
        import genlayer.message as message

        gl.IS_IN_VM = old_is_vm
        _MESSAGE = message
        from genlayer.types import Address, Lazy
        from genlayer.storage import Root
        from genlayer.storage._internal.generate import _BuilderCtx, _storage_build
        from genlayer.storage.core import InmemManager, ROOT_SLOT_ID

        self.Address = Address
        self.Lazy = Lazy
        self.manager = InmemManager()
        self.root = Root
        self.root.MANAGER = self.manager
        self.storage_root = ROOT_SLOT_ID
        self._set_message()

        if _CONTRACT is None:
            contract_path = ROOT / "contracts" / "FaultPact.py"
            spec = importlib.util.spec_from_file_location(
                "faultpact_phase_0_1_contract", contract_path
            )
            if spec is None or spec.loader is None:
                raise RuntimeError("cannot load contract")
            module = importlib.util.module_from_spec(spec)
            sys.modules[spec.name] = module
            spec.loader.exec_module(module)
            _CONTRACT = module.FaultPact
            _STORAGE_DESC = _storage_build(_BuilderCtx.empty(), _CONTRACT)

        slot = self.manager.get_store_slot(self.storage_root)
        instance = _STORAGE_DESC.get(slot, 0)
        init = _STORAGE_DESC.cls.__init__
        original = getattr(init, "__gl_original_init__", None)
        if original is not None:
            init = original
        init(
            instance,
            self.address(2),
            self.address(3),
            0,
            1,
            5,
            7,
            60,
            60,
            60,
            2,
            60,
            3600,
        )
        self.contract = instance
        self._set_message()

        # Direct mode executes the real leader function and records the
        # validator closure. Tests that need disagreement exercise the exact
        # comparator separately, while live certification uses GenVM consensus.
        from genlayer import vm

        def run_nondet(leader, validator, /, **_kwargs):
            result = leader()
            self.validator_calls.append((result, leader, validator))
            return result

        def run_nondet_unsafe(leader, validator, /):
            return run_nondet(leader, validator)

        self.validator_calls: list[tuple[object, object, object]] = []
        run_nondet.lazy = lambda leader, validator, **kwargs: Lazy(
            lambda: run_nondet(leader, validator, **kwargs)
        )
        run_nondet_unsafe.lazy = lambda leader, validator: Lazy(
            lambda: run_nondet_unsafe(leader, validator)
        )
        vm.run_nondet = run_nondet
        vm.run_nondet_unsafe = run_nondet_unsafe

    def address(self, value: int):
        if not hasattr(self, "Address"):
            from genlayer.types import Address

            return Address(bytes([value]) * 20)
        return self.Address(bytes([value]) * 20)

    def _set_message(self) -> None:
        assert _MESSAGE is not None
        stamp = datetime.fromtimestamp(self.now, timezone.utc).isoformat().replace(
            "+00:00", "Z"
        )
        _MESSAGE.contract_address = self.contract_address
        _MESSAGE.sender_address = self.sender
        _MESSAGE.origin_address = self.origin
        _MESSAGE.value = self.value
        _MESSAGE.chain_id = 61997
        _MESSAGE.raw = {
            "datetime": stamp,
            "sender_address": self.sender,
            "origin_address": self.origin,
            "contract_address": self.contract_address,
            "value": self.value,
            "chain_id": 61997,
        }

    def tx(self, method: str, *args, sender=None, value=0, origin=None):
        if sender is not None:
            self.sender = sender
        self.origin = self.sender if origin is None else origin
        self.value = value
        self._set_message()
        return getattr(self.contract, method)(*args)

    def view(self, method: str, *args):
        return self.tx(method, *args)

    def warp(self, timestamp: int) -> None:
        self.now = timestamp
        self._set_message()

    def advance(self, seconds: int) -> None:
        self.warp(self.now + seconds)

    def _queue(self, payload: bytes) -> int:
        fd = self.next_fd
        self.next_fd += 1
        self.fds[fd] = payload
        return fd

    def fdopen(self, fd: int, mode="r", *args, **kwargs):
        if fd in self.fds:
            return io.BytesIO(self.fds.pop(fd))
        return self._real_fdopen(fd, mode, *args, **kwargs)

    def _storage_read(self, slot, off, buf, /) -> None:
        buf[:] = self.manager.do_read(slot, off, len(buf))

    def _storage_write(self, slot, off, what, /) -> None:
        self.manager.do_write(slot, off, what)

    def _get_balance(self, address, /) -> int:
        return self.balances.get(bytes(address), 0)

    def _get_self_balance(self) -> int:
        return self.balances.get(self.contract_address.as_bytes, 0)

    def _gl_call(self, encoded, /) -> int:
        import genlayer.calldata as calldata

        request = calldata.decode(encoded)
        if "GetTimestamp" in request:
            return self._queue(calldata.encode(self.now))
        if "WebRequest" in request:
            url = request["WebRequest"]["url"]
            status, body = self.web.get(url, (404, b""))
            response = {"ok": {"response": {"status": status, "headers": {}, "body": body}}}
            return self._queue(calldata.encode(response))
        if "ExecPrompt" in request:
            prompt = request["ExecPrompt"]["prompt"]
            self.prompts.append(prompt)
            response = self.prompt_response
            if callable(response):
                response = response(prompt)
            if response is None:
                response = {}
            if isinstance(response, dict):
                response = json.dumps(response, sort_keys=True)
            return self._queue(calldata.encode({"ok": response}))
        if "EmitExternalMessage" in request:
            msg = request["EmitExternalMessage"]
            value = int(msg["value"])
            target = msg["address"]
            if self.fail_transfer:
                raise RuntimeError("simulated external transfer failure")
            self.transfers.append((target, value))
            self.balances[self.contract_address.as_bytes] = (
                self.balances.get(self.contract_address.as_bytes, 0) - value
            )
            self.balances[target.as_bytes] = self.balances.get(target.as_bytes, 0) + value
            return self._queue(calldata.encode({"ok": None}))
        return self._queue(calldata.encode({"ok": None}))

    def install_fdopen(self) -> None:
        self._real_fdopen = os.fdopen
        os.fdopen = self.fdopen


@pytest.fixture
def fp(monkeypatch):
    runtime = DirectRuntime()
    runtime.install_fdopen()
    yield runtime
    monkeypatch.setattr(os, "fdopen", runtime._real_fdopen)


def _hash(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()


def _probe(
    service_id: int,
    start: int,
    end: int,
    *,
    p95=300,
    region="us-east",
    probe="p",
    confirmed=True,
    fault_domain="PROVIDER",
) -> bytes:
    return json.dumps(
        {
            "schema": "faultpact-probe-v1",
            "service_id": service_id,
            "region": region,
            "observed_start": start,
            "observed_end": end,
            "availability_ppm": 999000,
            "p95_latency_ms": p95,
            "error_rate_ppm": 1000,
            "block_lag": None,
            "chain_level_failure": False,
            "fault_domain": fault_domain,
            "incident_confirmed": confirmed,
            "probe_id": probe,
            "sequence": 1,
        },
        sort_keys=True,
        separators=(",", ":"),
    ).encode()


def _resolution(start: int, end: int, ids: list[int], *, status="INCIDENT_CONFIRMED", p95=300):
    material = status != "INCONCLUSIVE"
    confirmed = status == "INCIDENT_CONFIRMED"
    support = {
        "fact_status": ids if material else [],
        "fault_domain": ids if material else [],
        "scope": ids if material else [],
        "incident_interval": ids if material else [],
        "availability": [],
        "p95_latency": ids if confirmed else [],
        "error_rate": [],
        "block_lag": [],
        "chain_level_failure": ids if material else [],
    }
    return {
        "fact_status": status,
        "fault_domain": "PROVIDER" if confirmed else "UNKNOWN",
        "scope": "us-east" if material else "",
        "incident_start": start if material else 0,
        "incident_end": end if material else 0,
        "observed_availability_ppm": 0,
        "availability_known": False,
        "observed_p95_latency_ms": p95 if confirmed else 0,
        "p95_known": confirmed,
        "observed_error_rate_ppm": 0,
        "error_rate_known": False,
        "observed_block_lag": 0,
        "block_lag_known": False,
        "chain_level_failure": False,
        "evidence_sufficiency": "SUFFICIENT" if material else "INSUFFICIENT",
        "reason_code": "TEST",
        "reasoning_summary": "test",
        "usable_evidence_ids": ids,
        "unusable_evidence_ids": [],
        "fact_support": support,
    }


def _assert_reverts(call, code: str) -> None:
    with pytest.raises(Exception) as caught:
        call()
    assert code in str(caught.value) or code in repr(caught.value)


def _setup_pacts(fp, thresholds=(150,), scope="us-east") -> tuple[int, int, list[int]]:
    owner = fp.address(1)
    provider_id = fp.tx("register_provider", "Provider", "", "", sender=owner)
    service_id = fp.tx("create_service", provider_id, "API", "Payments", "", "", sender=owner)
    pacts = []
    for threshold in thresholds:
        pact_id = fp.tx(
            "create_pact_draft",
            service_id,
            0,
            threshold,
            0,
            0,
            scope,
            10,
            120,
            60,
            3600,
            1,
            1000,
            0,
            0,
            10000,
            "",
            "",
            sender=owner,
        )
        fp.tx("publish_pact", pact_id, sender=owner)
        pacts.append(pact_id)
    fp.tx("deposit_capital", provider_id, sender=owner, value=1000 * len(pacts))
    for pact_id in pacts:
        fp.tx("allocate_capital", pact_id, 1000, sender=owner)
    return provider_id, service_id, pacts


def _open_incident(fp, service_id: int, *, start=None, end=None, sender=None) -> int:
    sender = sender or fp.address(8)
    start = fp.now - 100 if start is None else start
    end = fp.now - 10 if end is None else end
    return fp.tx(
        "open_incident",
        service_id,
        start,
        end,
        "provider outage",
        "",
        "",
        sender=sender,
        value=5,
    )


def _authorize_two(fp) -> tuple[object, object]:
    a = fp.address(4)
    b = fp.address(5)
    fp.tx("authorize_reporter", a, sender=fp.address(1))
    fp.tx("authorize_reporter", b, sender=fp.address(1))
    return a, b


def _add_probe(
    fp,
    incident_id: int,
    service_id: int,
    reporter,
    *,
    p95=300,
    region="us-east",
    probe="p",
    confirmed=True,
    fault_domain="PROVIDER",
) -> int:
    body = _probe(
        service_id,
        fp.now - 100,
        fp.now - 10,
        p95=p95,
        region=region,
        probe=probe,
        confirmed=confirmed,
        fault_domain=fault_domain,
    )
    uri = "https://probe.test/" + probe
    fp.web[uri] = (200, body)
    return fp.tx(
        "submit_evidence",
        incident_id,
        "PROBE_REPORT",
        uri,
        _hash(body),
        "probe measurement",
        sender=reporter,
    )


def _resolve(fp, incident_id: int, response: dict) -> None:
    fp.prompt_response = response
    fp.advance(61)
    fp.tx("resolve_incident", incident_id, sender=fp.address(8))


def test_F01_ARBITRARY_USER_EVIDENCE_CANNOT_ALONE_TRIGGER_PAYOUT(fp):
    _, service, _ = _setup_pacts(fp)
    incident = _open_incident(fp, service)
    body = _probe(service, fp.now - 100, fp.now - 10)
    uri = "https://attacker.test/fabricated"
    fp.web[uri] = (200, body)
    eid = fp.tx("submit_evidence", incident, "PROBE_REPORT", uri, _hash(body), "fake", sender=fp.address(8))
    response = _resolution(fp.now - 100, fp.now - 10, [eid])
    _assert_reverts(lambda: _resolve(fp, incident, response), "ERR_FACT_SUPPORT")


def test_F01_ONLY_AUTHORIZED_REPORTER_COUNTS_AS_AUTHORITATIVE(fp):
    _, service, _ = _setup_pacts(fp)
    incident = _open_incident(fp, service)
    authorized, _ = _authorize_two(fp)
    supplemental = _add_probe(fp, incident, service, fp.address(8), probe="supp")
    authoritative = _add_probe(fp, incident, service, authorized, probe="auth")
    assert fp.view("get_evidence", supplemental)["provenance"] == "SUPPLEMENTAL"
    assert fp.view("get_evidence", authoritative)["provenance"] == "AUTHORITATIVE"
    fp.tx("revoke_reporter", authorized, sender=fp.address(1))
    assert fp.view("get_evidence", authoritative)["provenance"] == "AUTHORITATIVE"
    later = _add_probe(fp, incident, service, authorized, probe="revoked")
    assert fp.view("get_evidence", later)["provenance"] == "SUPPLEMENTAL"


def test_F01_UNIQUE_REPORTER_QUORUM(fp):
    _, service, _ = _setup_pacts(fp)
    incident = _open_incident(fp, service)
    a, _ = _authorize_two(fp)
    first = _add_probe(fp, incident, service, a, probe="one")
    second = _add_probe(fp, incident, service, a, probe="two")
    response = _resolution(fp.now - 100, fp.now - 10, [first, second])
    _assert_reverts(lambda: _resolve(fp, incident, response), "ERR_AUTHORITY_QUORUM")


def test_F01_FACT_SUPPORT_IDS_REQUIRED(fp):
    _, service, _ = _setup_pacts(fp)
    incident = _open_incident(fp, service)
    a, b = _authorize_two(fp)
    first = _add_probe(fp, incident, service, a, probe="support-a")
    second = _add_probe(fp, incident, service, b, probe="support-b")
    response = _resolution(fp.now - 100, fp.now - 10, [first, second])
    response["fact_support"] = {key: [] for key in response["fact_support"]}
    _assert_reverts(lambda: _resolve(fp, incident, response), "ERR_FACT_SUPPORT")


def test_F01_HALLUCINATED_SUPPORT_ID_REJECTED(fp):
    _, service, _ = _setup_pacts(fp)
    incident = _open_incident(fp, service)
    a, b = _authorize_two(fp)
    first = _add_probe(fp, incident, service, a, probe="real-a")
    second = _add_probe(fp, incident, service, b, probe="real-b")
    response = _resolution(fp.now - 100, fp.now - 10, [first, second])
    response["fact_support"]["p95_latency"] = [999999]
    _assert_reverts(lambda: _resolve(fp, incident, response), "ERR_FACT_SUPPORT")


def test_F02_HASH_MISMATCH_BODY_NOT_IN_PROMPT(fp):
    _, service, _ = _setup_pacts(fp)
    incident = _open_incident(fp, service)
    a, b = _authorize_two(fp)
    first = _add_probe(fp, incident, service, a, probe="valid-a")
    bad_uri = "https://probe.test/mutated"
    bad_body = b"HASH-MISMATCH-POISON"
    fp.web[bad_uri] = (200, bad_body)
    bad = fp.tx("submit_evidence", incident, "PROBE_REPORT", bad_uri, _hash(b"old-body"), "attacker instruction", sender=b)
    second = _add_probe(fp, incident, service, b, probe="valid-b")
    response = _resolution(fp.now - 100, fp.now - 10, [first, second])
    _resolve(fp, incident, response)
    prompt = fp.prompts[-1]
    assert "HASH_MISMATCH" in prompt
    assert "HASH-MISMATCH-POISON" not in prompt
    assert "attacker instruction" not in prompt


def test_F02_FAILED_DESCRIPTION_NOT_FACT_INPUT(fp):
    _, service, _ = _setup_pacts(fp)
    incident = _open_incident(fp, service)
    a, b = _authorize_two(fp)
    first = _add_probe(fp, incident, service, a, probe="good-a")
    unreachable = "https://probe.test/unreachable"
    fp.web[unreachable] = (503, b"secret attacker text")
    failed = fp.tx("submit_evidence", incident, "PROBE_REPORT", unreachable, _hash(b"secret attacker text"), "failed description", sender=b)
    second = _add_probe(fp, incident, service, b, probe="good-b")
    _resolve(fp, incident, _resolution(fp.now - 100, fp.now - 10, [first, second]))
    prompt = fp.prompts[-1]
    assert "FETCH_FAILED" in prompt
    assert "failed description" not in prompt
    assert "secret attacker text" not in prompt


def test_F02_INVALID_EVIDENCE_CANNOT_SUPPORT_METRIC(fp):
    _, service, _ = _setup_pacts(fp)
    incident = _open_incident(fp, service)
    a, b = _authorize_two(fp)
    first = _add_probe(fp, incident, service, a, probe="metric-good")
    bad_uri = "https://probe.test/bad-metric"
    fp.web[bad_uri] = (200, b"not-json")
    bad = fp.tx("submit_evidence", incident, "PROBE_REPORT", bad_uri, _hash(b"not-json"), "bad metric", sender=b)
    response = _resolution(fp.now - 100, fp.now - 10, [first, bad])
    response["fact_support"]["p95_latency"] = [bad]
    _assert_reverts(lambda: _resolve(fp, incident, response), "ERR_FACT_SUPPORT")


def test_F03_EXACT_TIME_CONSENSUS_REQUIRED(fp):
    base = {"fact_status": "INCIDENT_CONFIRMED", "fault_domain": "PROVIDER", "scope": "us-east", "incident_start": 1, "incident_end": 2, "duration_seconds": 1, "fact_support_json": "{}"}
    other = dict(base, incident_start=2, incident_end=3, duration_seconds=1)
    assert fp.contract._decision_fields_match(base, base)
    assert not fp.contract._decision_fields_match(base, other)


def test_F03_DURATION_DERIVED_FROM_INTERVAL(fp):
    _, service, _ = _setup_pacts(fp)
    incident = _open_incident(fp, service)
    ctx = fp.contract._build_resolution_context(incident, False)
    data = _resolution(ctx["observed_start"], ctx["observed_end"], [])
    data["fact_status"] = "INCONCLUSIVE"
    data["scope"] = ""
    data["incident_start"] = ctx["observed_start"]
    data["incident_end"] = ctx["observed_end"]
    data["observed_availability_ppm"] = None
    data["observed_p95_latency_ms"] = None
    data["observed_error_rate_ppm"] = None
    data["observed_block_lag"] = None
    data["availability_known"] = False
    data["p95_known"] = False
    data["error_rate_known"] = False
    data["block_lag_known"] = False
    validated = fp.contract._validate_resolution_schema(data, ctx)
    assert validated["duration_seconds"] == validated["incident_end"] - validated["incident_start"]


def test_F03_COVERAGE_BOUNDARY_DISAGREEMENT_REJECTED(fp):
    base = {"fact_status": "INCIDENT_CONFIRMED", "fault_domain": "PROVIDER", "scope": "us-east", "incident_start": 100, "incident_end": 200, "duration_seconds": 100, "fact_support_json": "{}"}
    assert not fp.contract._decision_fields_match(base, dict(base, incident_end=201, duration_seconds=101))


def test_F04_SUPPLEMENTAL_SLOT_EXHAUSTION_DOES_NOT_BLOCK_AUTHORITATIVE_EVIDENCE(fp):
    _, service, _ = _setup_pacts(fp)
    incident = _open_incident(fp, service)
    a, _ = _authorize_two(fp)
    for index in range(4):
        body = b"supplemental-" + str(index).encode()
        uri = "https://supp.test/" + str(index)
        fp.web[uri] = (200, body)
        fp.tx("submit_evidence", incident, "CUSTOMER_LOG", uri, _hash(body), "supp", sender=fp.address(8))
    assert _add_probe(fp, incident, service, a, probe="auth-after-spam") > 0


def test_F04_PER_SUBMITTER_LIMIT(fp):
    _, service, _ = _setup_pacts(fp)
    incident = _open_incident(fp, service)
    for index in range(4):
        body = b"limited-" + str(index).encode()
        uri = "https://limit.test/" + str(index)
        fp.web[uri] = (200, body)
        fp.tx("submit_evidence", incident, "CUSTOMER_LOG", uri, _hash(body), "supp", sender=fp.address(8))
    body = b"fifth"
    fp.web["https://limit.test/5"] = (200, body)
    _assert_reverts(
        lambda: fp.tx("submit_evidence", incident, "CUSTOMER_LOG", "https://limit.test/5", _hash(body), "supp", sender=fp.address(8)),
        "ERR_SUBMITTER_EVIDENCE_CAP",
    )


def test_F04_PROMPT_SIZE_BOUNDED(fp):
    _, service, _ = _setup_pacts(fp)
    incident = _open_incident(fp, service)
    a, b = _authorize_two(fp)
    first = _add_probe(fp, incident, service, a, probe="size-a")
    second = _add_probe(fp, incident, service, b, probe="size-b")
    for index in range(4):
        body = (b"x" * 4096) + str(index).encode()
        uri = "https://size.test/" + str(index)
        fp.web[uri] = (200, body)
        fp.tx("submit_evidence", incident, "CUSTOMER_LOG", uri, _hash(body), "y" * 512, sender=fp.address(8 + index))
    _resolve(fp, incident, _resolution(fp.now - 100, fp.now - 10, [first, second]))
    assert len(fp.prompts[-1].encode()) <= 24576 + 8192
    assert len([item for item in fp.contract._select_evidence_for_adjudication(fp.contract._collect_evidence_mem(incident)) if not item["authoritative"]]) <= 4


def test_F05_PERMISSIONLESS_INCONCLUSIVE_TIMEOUT(fp):
    _, service, pacts = _setup_pacts(fp)
    buyer = fp.address(8)
    coverage = fp.tx("buy_coverage", pacts[0], 100, 600, 0, sender=buyer, value=0)
    fp.advance(100)
    incident = _open_incident(fp, service, sender=buyer)
    claim = fp.tx("file_claim", coverage, incident, sender=buyer)
    deadline = fp.view("get_incident", incident)["resolution_deadline"]
    fp.warp(deadline)
    fp.tx("finalize_inconclusive_timeout", incident, sender=fp.address(7))
    assert fp.view("get_incident_resolution", incident)["fact_status"] == "INCONCLUSIVE"
    assert fp.view("get_claim", claim)["status"] == "INELIGIBLE"


def test_F05_PENDING_CLAIM_RELEASE_AFTER_TIMEOUT(fp):
    _, service, pacts = _setup_pacts(fp)
    buyer = fp.address(8)
    coverage = fp.tx("buy_coverage", pacts[0], 100, 600, 0, sender=buyer, value=0)
    fp.advance(100)
    incident = _open_incident(fp, service, sender=buyer)
    fp.tx("file_claim", coverage, incident, sender=buyer)
    fp.warp(fp.view("get_incident", incident)["resolution_deadline"])
    fp.tx("finalize_inconclusive_timeout", incident, sender=fp.address(7))
    end = fp.view("get_coverage", coverage)["claim_deadline_ts"]
    fp.warp(end)
    fp.tx("release_earned_premium", coverage, sender=buyer)
    assert fp.view("get_provider_vault", 1)["reserved_capital"] == 0


def test_F05_CHALLENGE_TIMEOUT_RELEASES_PENDING_CLAIM(fp):
    _, service, pacts = _setup_pacts(fp)
    buyer = fp.address(8)
    coverage = fp.tx("buy_coverage", pacts[0], 100, 600, 0, sender=buyer, value=0)
    fp.advance(100)
    incident = _open_incident(fp, service, sender=buyer)
    claim = fp.tx("file_claim", coverage, incident, sender=buyer)
    a, b = _authorize_two(fp)
    first = _add_probe(fp, incident, service, a, probe="challenge-timeout-a")
    second = _add_probe(fp, incident, service, b, probe="challenge-timeout-b")
    _resolve(fp, incident, _resolution(fp.now - 100, fp.now - 10, [first, second]))
    fp.tx("challenge_incident", incident, "timeout challenge", "", "", sender=buyer, value=7)
    fp.warp(fp.view("get_incident", incident)["resolution_deadline"])
    fp.tx("finalize_inconclusive_timeout", incident, sender=fp.address(7))
    assert fp.view("get_incident_resolution", incident)["fact_status"] == "INCONCLUSIVE"
    assert fp.view("get_claim", claim)["status"] == "INELIGIBLE"
    assert fp.view("get_challenge", incident)["resolved"] is True


def test_F06_NO_DOUBLE_WITHDRAWAL(fp):
    fp.contract.credits[fp.address(1)] = 10
    fp.balances[fp.contract_address.as_bytes] = 10
    fp.tx("withdraw_credit", 10, sender=fp.address(1))
    _assert_reverts(lambda: fp.tx("withdraw_credit", 1, sender=fp.address(1)), "ERR_INSUFFICIENT_CREDIT")
    assert len(fp.transfers) == 1
    assert fp.view("get_claimable_balance", fp.address(1)) == 0


def test_F06_TRANSFER_FAILURE_BEHAVIOR(fp):
    fp.contract.credits[fp.address(1)] = 10
    fp.fail_transfer = True
    _assert_reverts(lambda: fp.tx("withdraw_credit", 10, sender=fp.address(1)), "simulated external transfer failure")
    # The contract's documented limitation is self-only EOA withdrawal; the
    # runtime has no child-transfer acknowledgement or recovery callback.
    assert fp.view("get_claimable_balance", fp.address(1)) == 0


def test_F07_FUTURE_INCIDENT_REJECTED(fp):
    _, service, _ = _setup_pacts(fp)
    _assert_reverts(lambda: _open_incident(fp, service, start=fp.now, end=fp.now + 1), "ERR_FUTURE_INCIDENT")


def test_F07_OVERSIZED_INCIDENT_WINDOW_REJECTED(fp):
    _, service, _ = _setup_pacts(fp)
    _assert_reverts(lambda: _open_incident(fp, service, start=fp.now - 3602, end=fp.now - 1), "ERR_INCIDENT_SPAN")


def test_F08_CHALLENGE_BOND_SNAPSHOT(fp):
    _, service, _ = _setup_pacts(fp)
    incident = _open_incident(fp, service)
    old_bond = fp.view("get_incident", incident)["challenge_bond"]
    fp.tx("set_bonds", 5, 99, sender=fp.address(1))
    assert fp.view("get_protocol_config")["challenge_bond"] == 99
    assert fp.view("get_incident", incident)["challenge_bond"] == old_bond


def test_F09_SCOPE_NORMALIZATION(fp):
    _, service, _ = _setup_pacts(fp, scope=" US-EAST ")
    assert fp.view("get_pact_terms", 1)["region_scope"] == "us-east"
    ctx = {"observed_start": 1, "observed_end": 3, "evidence_ids": [], "service_id": 1, "max_incident_span": 10}
    data = _resolution(1, 3, [], status="INCONCLUSIVE")
    data["scope"] = ""
    data["incident_start"] = 1
    data["incident_end"] = 3
    assert fp.contract._validate_resolution_schema(data, ctx)["scope"] == ""


def test_F09_SCOPE_DERIVED_FROM_AUTHORITATIVE_EVIDENCE(fp):
    _, service, _ = _setup_pacts(fp)
    incident = _open_incident(fp, service)
    a, b = _authorize_two(fp)
    first = _add_probe(fp, incident, service, a, probe="scope-a")
    second = _add_probe(fp, incident, service, b, probe="scope-b")
    response = _resolution(fp.now - 100, fp.now - 10, [first, second])
    response["scope"] = "us-east (model explanation)"
    _resolve(fp, incident, response)
    assert fp.view("get_incident_resolution", incident)["scope"] == "us-east"


def test_F09_EMPTY_SCOPE_REJECTED(fp):
    owner = fp.address(1)
    provider = fp.tx("register_provider", "P", "", "", sender=owner)
    service = fp.tx("create_service", provider, "API", "S", "", "", sender=owner)
    args = (service, 0, 150, 0, 0, "", 10, 120, 60, 3600, 1, 1000, 0, 0, 10000, "", "")
    _assert_reverts(lambda: fp.tx("create_pact_draft", *args, sender=owner), "ERR_EMPTY_SCOPE")


def test_F10_MAINTENANCE_POLICY_ENFORCED_OR_DISABLED(fp):
    _setup_pacts(fp)
    assert "maintenance_exclusion" not in fp.view("get_pact_terms", 1)
    assert fp.view("get_protocol_config")["maintenance_policy"] == "DISABLED_V1"


def test_F11_NO_DEAD_PENDING_COVERAGE_API(fp):
    assert not hasattr(fp.contract, "cancel_pending_coverage")


def test_F12_PPM_BOUNDS(fp):
    owner = fp.address(1)
    provider = fp.tx("register_provider", "P", "", "", sender=owner)
    service = fp.tx("create_service", provider, "API", "S", "", "", sender=owner)
    args = (service, 1_000_001, 150, 0, 0, "global", 10, 120, 60, 3600, 1, 1000, 0, 0, 10000, "", "")
    _assert_reverts(lambda: fp.tx("create_pact_draft", *args, sender=owner), "ERR_AVAILABILITY_THRESHOLD")
    args = (service, 0, 150, 1_000_001, 0, "global", 10, 120, 60, 3600, 1, 1000, 0, 0, 10000, "", "")
    _assert_reverts(lambda: fp.tx("create_pact_draft", *args, sender=owner), "ERR_ERROR_RATE_THRESHOLD")


def test_F12_PROVIDER_STATS_NO_INCIDENT(fp):
    _, service, _ = _setup_pacts(fp)
    incident = _open_incident(fp, service)
    a, b = _authorize_two(fp)
    first = _add_probe(fp, incident, service, a, probe="no-incident-a", confirmed=False, fault_domain="UNKNOWN")
    second = _add_probe(fp, incident, service, b, probe="no-incident-b", confirmed=False, fault_domain="UNKNOWN")
    fp.prompt_response = _resolution(fp.now - 100, fp.now - 10, [first, second], status="NO_INCIDENT")
    fp.advance(61)
    fp.tx("resolve_incident", incident, sender=fp.address(8))
    fp.advance(61)
    fp.tx("finalize_incident", incident, sender=fp.address(7))
    stats = fp.view("get_provider_stats", 1)
    assert stats["provider_fault_incidents"] == 0
    assert stats["inconclusive_incidents"] == 0


def test_F12_RETIRED_SERVICE_CANNOT_PUBLISH_NEW_PACT(fp):
    owner = fp.address(1)
    provider = fp.tx("register_provider", "P", "", "", sender=owner)
    service = fp.tx("create_service", provider, "API", "S", "", "", sender=owner)
    fp.tx("retire_service", service, sender=owner)
    args = (service, 0, 150, 0, 0, "global", 10, 120, 60, 3600, 1, 1000, 0, 0, 10000, "", "")
    _assert_reverts(lambda: fp.tx("create_pact_draft", *args, sender=owner), "ERR_SERVICE_RETIRED")


def test_HASH_IMMUTABILITY(fp):
    owner = fp.address(1)
    value = "a" * 64
    provider = fp.tx("register_provider", "P", "", value, sender=owner)
    assert fp.view("get_provider", provider)["metadata_hash"] == value


def test_PENDING_CLAIM_RESERVE_LOCK(fp):
    _, service, pacts = _setup_pacts(fp)
    buyer = fp.address(8)
    coverage = fp.tx("buy_coverage", pacts[0], 100, 600, 0, sender=buyer, value=0)
    assert fp.view("get_provider_vault", 1)["reserved_capital"] == 100
    _assert_reverts(lambda: fp.tx("deallocate_capital", pacts[0], 901, sender=fp.address(1)), "ERR_ALLOCATED_RESERVED")
    assert fp.view("get_coverage", coverage)["open_claims"] == 0


def test_DIFFERENT_PACT_THRESHOLDS(fp):
    _, service, pacts = _setup_pacts(fp, thresholds=(150, 500))
    incident = _open_incident(fp, service)
    ctx = fp.contract._build_resolution_context(incident, False)
    response = _resolution(ctx["observed_start"], ctx["observed_end"], [], status="INCONCLUSIVE")
    # The deterministic clause engine sees the same facts under both frozen terms.
    response["fact_status"] = "INCIDENT_CONFIRMED"
    response["fault_domain"] = "PROVIDER"
    response["scope"] = "us-east"
    response["p95_known"] = True
    response["observed_p95_latency_ms"] = 300
    response["evidence_sufficiency"] = "SUFFICIENT"
    res = fp.contract.resolutions.get(999)
    assert res is None
    # Use the exact storage record types rather than a test-only calculator.
    terms_a = fp.contract.pact_terms[pacts[0]]
    terms_b = fp.contract.pact_terms[pacts[1]]
    assert "P95_LATENCY" in fp.contract._matched_clauses(terms_a, types.SimpleNamespace(p95_known=True, observed_p95_latency_ms=300, availability_known=False, error_rate_known=False, block_lag_known=False))
    assert "P95_LATENCY" not in fp.contract._matched_clauses(terms_b, types.SimpleNamespace(p95_known=True, observed_p95_latency_ms=300, availability_known=False, error_rate_known=False, block_lag_known=False))


def test_NO_DOUBLE_SETTLEMENT(fp):
    _, service, _ = _setup_pacts(fp)
    incident = _open_incident(fp, service)
    fp.prompt_response = _resolution(fp.now - 100, fp.now - 10, [], status="INCONCLUSIVE")
    fp.prompt_response["incident_start"] = fp.now - 100
    fp.prompt_response["incident_end"] = fp.now - 10
    fp.advance(61)
    fp.tx("resolve_incident", incident, sender=fp.address(8))
    fp.advance(61)
    fp.tx("finalize_incident", incident, sender=fp.address(7))
    _assert_reverts(lambda: fp.tx("finalize_incident", incident, sender=fp.address(7)), "ERR_ALREADY_FINALIZED")


def test_NO_DOUBLE_PREMIUM_RELEASE(fp):
    _, service, pacts = _setup_pacts(fp)
    buyer = fp.address(8)
    coverage = fp.tx("buy_coverage", pacts[0], 100, 60, 0, sender=buyer, value=0)
    fp.warp(fp.view("get_coverage", coverage)["claim_deadline_ts"])
    fp.tx("release_earned_premium", coverage, sender=buyer)
    before = fp.view("get_provider_vault", 1)
    fp.tx("release_earned_premium", coverage, sender=buyer)
    assert fp.view("get_provider_vault", 1) == before
    assert fp.view("get_coverage", coverage)["reserve_released"] is True


def test_PACT_IMMUTABILITY(fp):
    _, _, _ = _setup_pacts(fp)
    before = fp.view("get_pact_terms", 1)
    _assert_reverts(lambda: fp.tx("update_pact_draft", 1, 0, 500, 0, 0, "us-east", 10, 120, 60, 3600, 1, 1000, 0, 0, 10000, "", "", sender=fp.address(1)), "ERR_NOT_DRAFT")
    assert fp.view("get_pact_terms", 1) == before


def test_REVISION_ISOLATION(fp):
    owner = fp.address(1)
    provider, service, pacts = _setup_pacts(fp)
    revision = fp.tx("create_pact_revision", pacts[0], 0, 500, 0, 0, "us-east", 10, 120, 60, 3600, 1, 1000, 0, 0, 10000, "", "", sender=owner)
    assert fp.view("get_pact_terms", pacts[0])["p95_latency_ms"] == 150
    assert fp.view("get_pact_terms", revision)["p95_latency_ms"] == 500
    assert provider == 1 and service == 1


def test_PAUSE_RECOVERY_PATHS(fp):
    _, service, pacts = _setup_pacts(fp)
    fp.tx("pause_new_sales", sender=fp.address(1))
    fp.tx("resume_new_sales", sender=fp.address(1))
    fp.tx("pause_service", service, sender=fp.address(1))
    fp.tx("resume_service", service, sender=fp.address(1))
    fp.tx("pause_pact_sales", pacts[0], sender=fp.address(1))
    fp.tx("resume_pact_sales", pacts[0], sender=fp.address(1))
