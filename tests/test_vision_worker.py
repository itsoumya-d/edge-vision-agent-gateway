from __future__ import annotations

from dataclasses import replace

from vision_worker import AuditLedger, BBox, Detection, ZoneHysteresisTracker


def test_zone_hysteresis_suppresses_flicker_and_confirms_sustained_entry() -> None:
    tracker = ZoneHysteresisTracker(
        zone_id="loading-bay-1",
        zone_box=BBox(0.0, 0.0, 100.0, 100.0),
        min_iou=0.25,
        min_confidence=0.6,
        confirm_frames=3,
    )
    inside = Detection(track_id="trk-1", label="forklift", confidence=0.92, bbox=BBox(10.0, 10.0, 80.0, 80.0))

    # Frames 1-2: single/double frame detections do not alert yet
    assert tracker.process_frame(1, [inside]) == []
    assert tracker.process_frame(2, [inside]) == []

    # Frame 3: confirmed entry
    events_3 = tracker.process_frame(3, [inside])
    assert len(events_3) == 1
    assert events_3[0].event_type == "ZONE_ENTER_CONFIRMED"
    assert events_3[0].dwell_frames == 3

    # Transient single-frame noise is ignored on disappearance/re-entry
    noise = Detection(track_id="trk-noise", label="shadow", confidence=0.85, bbox=BBox(10.0, 10.0, 80.0, 80.0))
    events_4 = tracker.process_frame(4, [noise])
    assert [e.event_type for e in events_4] == ["ZONE_EXIT"]
    assert events_4[0].track_id == "trk-1"


def test_audit_ledger_detects_tampering() -> None:
    ledger = AuditLedger()
    ledger.append("ZONE_ENTER_CONFIRMED", {"zone": "bay-1", "track_id": "trk-1"})
    ledger.append("MCP_TOOL_CALLED", {"tool": "dispatch_alert", "seq": 1})
    assert ledger.verify_chain() is True

    # Tamper record 0 payload cleanly without fixing hash
    tampered = replace(ledger._records[0], payload={"zone": "bay-99", "track_id": "trk-1"})
    ledger._records[0] = tampered
    assert ledger.verify_chain() is False
