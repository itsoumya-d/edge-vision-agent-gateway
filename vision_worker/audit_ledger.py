"""Hash-chained tamper-evident inference and tool execution audit ledger."""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class AuditRecord:
    seq: int
    prev_hash: str
    event_type: str
    payload: dict[str, Any]
    record_hash: str


class AuditLedger:
    def __init__(self) -> None:
        self._records: list[AuditRecord] = []

    def append(self, event_type: str, payload: dict[str, Any]) -> AuditRecord:
        prev_hash = self._records[-1].record_hash if self._records else "GENESIS"
        seq = len(self._records) + 1
        canonical = json.dumps(
            {"seq": seq, "prev_hash": prev_hash, "event_type": event_type, "payload": payload},
            sort_keys=True,
        ).encode("utf-8")
        digest = hashlib.sha256(canonical).hexdigest()
        rec = AuditRecord(
            seq=seq,
            prev_hash=prev_hash,
            event_type=event_type,
            payload=payload,
            record_hash=digest,
        )
        self._records.append(rec)
        return rec

    def verify_chain(self) -> bool:
        expected_prev = "GENESIS"
        for rec in self._records:
            if rec.prev_hash != expected_prev:
                return False
            canonical = json.dumps(
                {"seq": rec.seq, "prev_hash": rec.prev_hash, "event_type": rec.event_type, "payload": rec.payload},
                sort_keys=True,
            ).encode("utf-8")
            if hashlib.sha256(canonical).hexdigest() != rec.record_hash:
                return False
            expected_prev = rec.record_hash
        return True
