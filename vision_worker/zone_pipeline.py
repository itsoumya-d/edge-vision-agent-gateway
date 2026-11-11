"""Sliding-window spatial zone occupancy & dwell-time hysteresis filter."""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class BBox:
    x1: float
    y1: float
    x2: float
    y2: float

    @property
    def area(self) -> float:
        return max(0.0, self.x2 - self.x1) * max(0.0, self.y2 - self.y1)


@dataclass(frozen=True)
class Detection:
    track_id: str
    label: str
    confidence: float
    bbox: BBox


@dataclass(frozen=True)
class ZoneEvent:
    zone_id: str
    track_id: str
    event_type: str  # "ZONE_ENTER_CONFIRMED" | "ZONE_EXIT"
    frame_index: int
    dwell_frames: int


def iou(a: BBox, b: BBox) -> float:
    ix1 = max(a.x1, b.x1)
    iy1 = max(a.y1, b.y1)
    ix2 = min(a.x2, b.x2)
    iy2 = min(a.y2, b.y2)
    inter = max(0.0, ix2 - ix1) * max(0.0, iy2 - iy1)
    union = a.area + b.area - inter
    return 0.0 if union <= 0.0 else inter / union


class ZoneHysteresisTracker:
    """Requires N consecutive overlapping frames before confirming entry to eliminate flicker."""

    def __init__(
        self,
        zone_id: str,
        zone_box: BBox,
        min_iou: float = 0.25,
        min_confidence: float = 0.6,
        confirm_frames: int = 3,
    ) -> None:
        self.zone_id = zone_id
        self.zone_box = zone_box
        self.min_iou = min_iou
        self.min_confidence = min_confidence
        self.confirm_frames = confirm_frames
        self._streak: dict[str, int] = {}
        self._active: set[str] = set()

    def process_frame(self, frame_index: int, detections: list[Detection]) -> list[ZoneEvent]:
        events: list[ZoneEvent] = []
        present_this_frame: set[str] = set()

        for det in detections:
            if det.confidence < self.min_confidence:
                continue
            if iou(det.bbox, self.zone_box) >= self.min_iou:
                present_this_frame.add(det.track_id)
                streak = self._streak.get(det.track_id, 0) + 1
                self._streak[det.track_id] = streak
                if streak == self.confirm_frames and det.track_id not in self._active:
                    self._active.add(det.track_id)
                    events.append(
                        ZoneEvent(
                            zone_id=self.zone_id,
                            track_id=det.track_id,
                            event_type="ZONE_ENTER_CONFIRMED",
                            frame_index=frame_index,
                            dwell_frames=streak,
                        )
                    )

        departed = [tid for tid in list(self._streak.keys()) if tid not in present_this_frame]
        for tid in departed:
            dwell = self._streak.pop(tid)
            if tid in self._active:
                self._active.remove(tid)
                events.append(
                    ZoneEvent(
                        zone_id=self.zone_id,
                        track_id=tid,
                        event_type="ZONE_EXIT",
                        frame_index=frame_index,
                        dwell_frames=dwell,
                    )
                )

        return events
